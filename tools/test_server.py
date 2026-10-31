import contextlib
import io
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest

from server import ServerManager


FAKE_SERVER = '''#!/usr/bin/env python3
import argparse, json
from http.server import BaseHTTPRequestHandler, HTTPServer
parser = argparse.ArgumentParser()
parser.add_argument('--config')
args, rest = parser.parse_known_args()
listen = json.load(open(args.config))['server']['listen']
host, port = listen.rsplit(':', 1)
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{}')
    def log_message(self, *args):
        pass
print('fake server ready', flush=True)
HTTPServer((host, int(port)), Handler).serve_forever()
'''


class ServerLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="safehandoff-manager-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.binary = self.root / "safehandoff"
        self.binary.write_text(FAKE_SERVER)
        self.binary.chmod(0o700)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        (self.root / "config.json").write_text(json.dumps({"server": {"listen": f"127.0.0.1:{port}"}}))
        self.manager = ServerManager(self.root, self.binary)
        self.output = io.StringIO()
        self.capture = contextlib.redirect_stdout(self.output)
        self.capture.__enter__()
        self.addCleanup(self.capture.__exit__, None, None, None)
        self.addCleanup(self.manager.stop)

    def test_start_duplicate_status_restart_logs_and_stop(self):
        first = self.manager.start()
        self.assertEqual(self.manager.start()["pid"], first["pid"])
        self.assertEqual(self.manager.status()["pid"], first["pid"])
        self.assertEqual(self.manager.pid_path.read_text().strip(), str(first["pid"]))
        second = self.manager.restart(fixture=True)
        self.assertNotEqual(first["pid"], second["pid"])
        self.assertEqual(second["mode"], "fixture")
        self.manager.logs()
        self.assertIn("fake server ready", self.output.getvalue())
        self.manager.stop()
        self.assertIsNone(self.manager.status())
        self.assertFalse(self.manager.pid_path.exists())
        self.assertFalse(self.manager.state_path.exists())
        self.assertTrue(self.manager.log_path.exists())

    def test_stale_identity_never_signals_an_unrelated_process(self):
        unrelated = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        try:
            with self.manager.locked():
                state = self.manager.save_state(unrelated.pid, self.root / "config.json", False, "127.0.0.1:1")
                state["identity"] = "different-start-identity"
                self.manager.state_path.write_text(json.dumps(state))
            self.manager.stop()
            self.assertIsNone(unrelated.poll())
            self.assertFalse(self.manager.pid_path.exists())
            with self.assertRaisesRegex(RuntimeError, "프로세스가 아닙니다"):
                self.manager.adopt(unrelated.pid)
        finally:
            unrelated.terminate()
            unrelated.wait(timeout=5)

    def test_failed_start_cleans_pid_and_records_log(self):
        self.binary.write_text("#!/usr/bin/env python3\nprint('startup failed', flush=True)\nraise SystemExit(2)\n")
        with self.assertRaises(RuntimeError):
            self.manager.start(timeout=2)
        self.assertFalse(self.manager.pid_path.exists())
        self.assertFalse(self.manager.state_path.exists())
        self.assertIn("startup failed", self.manager.log_path.read_text())

    def test_invalid_restart_configuration_does_not_stop_running_server(self):
        state = self.manager.start()
        (self.root / "bad.json").write_text("not-json")
        with self.assertRaises(RuntimeError):
            self.manager.restart("bad.json")
        self.assertEqual(self.manager.status()["pid"], state["pid"])

    def test_busy_port_is_not_adopted_or_stopped(self):
        server = self.manager.start()
        another = ServerManager(self.root, self.binary)
        another.directory = self.root / "another-run"
        another.pid_path = another.directory / "server_pid"
        another.state_path = another.directory / "server.json"
        another.log_path = another.directory / "server.log"
        with self.assertRaisesRegex(RuntimeError, "포트가 이미 사용 중"):
            another.start()
        self.assertEqual(self.manager.status()["pid"], server["pid"])


if __name__ == "__main__":
    unittest.main()
