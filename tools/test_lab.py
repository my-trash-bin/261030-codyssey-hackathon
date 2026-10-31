import contextlib
import io
import json
from pathlib import Path
import socket
import tempfile
import unittest
from lab import Component

FAKE = '''#!/usr/bin/env python3
import argparse
from http.server import BaseHTTPRequestHandler, HTTPServer
p=argparse.ArgumentParser();p.add_argument('--listen');args,_=p.parse_known_args()
host,port=args.listen.rsplit(':',1)
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200);self.end_headers();self.wfile.write(b'{}')
    def log_message(self,*args): pass
HTTPServer((host,int(port)),Handler).serve_forever()
'''


class SplitRuntimeTests(unittest.TestCase):
    def test_mode_ownership_and_independent_component_lifecycle(self):
        with tempfile.TemporaryDirectory(prefix="safehandoff-lab-test-") as directory:
            root = Path(directory)
            (root / "bin").mkdir()
            for name in ["safehandoff-web", "safehandoff-engine"]:
                p = root / "bin" / name
                p.write_text(FAKE)
                p.chmod(0o700)
            (root / "config.json").write_text(json.dumps({}))
            demo, live = Component("demo", "engine", root), Component("live", "engine", root)
            self.assertNotEqual(demo.directory, live.directory)
            self.assertNotEqual(demo.port, live.port)
            self.assertNotEqual(demo.launch_args(root / "config.json", False),
                                live.launch_args(root / "config.json", False))
            managers = [demo, live]
            with contextlib.redirect_stdout(io.StringIO()):
                try:
                    for manager in managers:
                        with socket.socket() as sock:
                            sock.bind(("127.0.0.1", 0))
                            manager.port = sock.getsockname()[1]
                        manager.start()
                    first = live.active()["pid"]
                    demo.stop()
                    self.assertEqual(live.active()["pid"], first)
                    self.assertEqual(live.read_state()["mode"], "live")
                finally:
                    for manager in managers:
                        manager.stop()
