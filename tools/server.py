#!/usr/bin/env python3
"""Manage this checkout's detached SafeHandoff process, not arbitrary port owners."""

import argparse
from collections import deque
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def process_identity(pid):
    if not isinstance(pid, int) or pid <= 1:
        return None
    try:
        stat = Path(f"/proc/{pid}/stat")
        if stat.exists():
            fields = stat.read_text().rsplit(")", 1)[1].split()
            return None if fields[0] == "Z" else fields[19]
        os.kill(pid, 0)
        result = subprocess.run(
            ["ps", "-p", str(pid), "-o", "lstart=", "-o", "comm="],
            capture_output=True, text=True, check=False,
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except (ProcessLookupError, FileNotFoundError):
        return None


def terminate_managed(pid, identity):
    if hasattr(os, "pidfd_open") and hasattr(signal, "pidfd_send_signal"):
        descriptor = os.pidfd_open(pid)
        try:
            if process_identity(pid) == identity:
                signal.pidfd_send_signal(descriptor, signal.SIGTERM)
        finally:
            os.close(descriptor)
    elif process_identity(pid) == identity:
        os.kill(pid, signal.SIGTERM)


class ServerManager:
    def __init__(self, root=ROOT, binary=None):
        self.root = Path(root).resolve()
        self.binary = Path(binary or self.root / "bin/safehandoff").resolve()
        self.directory = self.root / ".local/run"
        self.pid_path = self.directory / "server_pid"
        self.state_path = self.directory / "server.json"
        self.log_path = self.directory / "server.log"
        self.children = {}

    @contextmanager
    def locked(self):
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        with (self.directory / "server.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            yield

    def read_state(self):
        try:
            state = json.loads(self.state_path.read_text())
            pid = int(self.pid_path.read_text().strip())
        except FileNotFoundError:
            return None
        except (ValueError, TypeError):
            raise RuntimeError("서버 관리 파일이 손상됐습니다; .local/run을 확인하세요") from None
        if (state.get("pid") != pid or state.get("root") != str(self.root)
                or state.get("binary") != str(self.binary) or not state.get("identity")):
            raise RuntimeError("서버 관리 파일의 소유 정보가 일치하지 않습니다")
        return state

    def active(self):
        state = self.read_state()
        return state if state and process_identity(state["pid"]) == state["identity"] else None

    def clear_state(self):
        self.pid_path.unlink(missing_ok=True)
        self.state_path.unlink(missing_ok=True)

    def save_state(self, pid, config, fixture, listen):
        identity = process_identity(pid)
        if identity is None:
            raise RuntimeError("서버가 시작 직후 종료됐습니다; just logs로 확인하세요")
        state = {
            "pid": pid, "identity": identity, "root": str(self.root),
            "binary": str(self.binary), "config": str(config),
            "mode": "fixture" if fixture else "live", "listen": listen,
        }
        temporary = self.state_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(state, indent=2) + "\n")
        temporary.replace(self.state_path)
        self.pid_path.write_text(str(pid) + "\n")
        return state

    def configuration(self, config):
        path = Path(config)
        if not path.is_absolute():
            path = self.root / path
        try:
            data = json.loads(path.read_text())
        except FileNotFoundError:
            data = {}
        except (ValueError, OSError):
            raise RuntimeError("설정 파일을 읽거나 해석할 수 없습니다") from None
        listen = data.get("server", {}).get("listen", "127.0.0.1:8080")
        try:
            host, port = listen.rsplit(":", 1)
            host, port = host.strip("[]"), int(port)
            if not host or not 0 < port <= 65535:
                raise ValueError()
        except (ValueError, AttributeError):
            raise RuntimeError("server.listen은 IP:port 형식이어야 합니다") from None
        connect = "127.0.0.1" if host == "0.0.0.0" else "::1" if host == "::" else host
        return path.resolve(), listen, connect, port

    def launch_args(self, path, fixture):
        args = [str(self.binary), "--config", str(path)]
        if fixture:
            args += ["--fixture", "--data-dir", str(self.root / "var/fixture")]
        return args

    def start(self, config="config.json", fixture=False, timeout=10):
        with self.locked():
            return self._start(config, fixture, timeout)

    def _start(self, config, fixture, timeout):
        existing = self.active()
        if existing:
            print(f"이미 실행 중: PID {existing['pid']} ({existing['mode']})")
            return existing
        self.clear_state()
        if not self.binary.is_file():
            raise RuntimeError("서버 실행 파일이 없습니다; just build를 먼저 실행하세요")
        path, listen, host, port = self.configuration(config)
        try:
            with socket.create_connection((host, port), timeout=0.5):
                raise RuntimeError("설정 포트가 이미 사용 중입니다; 관리 밖 프로세스는 종료하지 않습니다")
        except (ConnectionError, TimeoutError, OSError):
            pass
        args = self.launch_args(path, fixture)
        with self.log_path.open("ab") as log:
            process = subprocess.Popen(
                args, cwd=self.root, stdin=subprocess.DEVNULL,
                stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
            )
        self.children[process.pid] = process
        try:
            state = self.save_state(process.pid, path, fixture, listen)
            url_host = f"[{host}]" if ":" in host else host
            url = f"http://{url_host}:{port}/health"
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError("서버가 시작에 실패했습니다; just logs로 확인하세요")
                try:
                    with opener.open(url, timeout=0.5) as response:
                        if response.status == 200:
                            time.sleep(0.1)
                            if process.poll() is None:
                                print(f"시작됨: PID {process.pid} ({state['mode']}), listen={listen}")
                                print(f"로그: {self.log_path}")
                                return state
                except (urllib.error.URLError, TimeoutError):
                    pass
                time.sleep(0.1)
            raise RuntimeError("서버 시작 확인 시간 초과; just logs로 확인하세요")
        except BaseException:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    # Keep ownership records so a later stop can finish shutdown.
                    raise RuntimeError("서버가 종료 중입니다; just status로 확인하세요") from None
            self.clear_state()
            self.children.pop(process.pid, None)
            raise

    def stop(self, timeout=15):
        with self.locked():
            return self._stop(timeout)

    def _stop(self, timeout):
        state = self.active()
        if state is None:
            self.clear_state()
            print("관리 중인 서버가 없습니다")
            return
        pid, identity = state["pid"], state["identity"]
        try:
            terminate_managed(pid, identity)
        except ProcessLookupError:
            pass
        deadline = time.monotonic() + timeout
        while process_identity(pid) == identity and time.monotonic() < deadline:
            time.sleep(0.1)
        if process_identity(pid) == identity:
            raise RuntimeError("정상 종료 대기 시간 초과; 상태 파일을 보존했습니다. just logs로 확인하세요")
        self.clear_state()
        child = self.children.pop(pid, None)
        if child is not None:
            child.wait(timeout=1)
        print(f"종료됨: PID {pid}")

    def restart(self, config="config.json", fixture=False):
        # Validate the new configuration before stopping a healthy server.
        self.configuration(config)
        if not self.binary.is_file():
            raise RuntimeError("서버 실행 파일이 없습니다; just build를 먼저 실행하세요")
        with self.locked():
            self._stop(15)
            return self._start(config, fixture, 10)

    def status(self):
        with self.locked():
            state = self.active()
            if state:
                print(f"실행 중: PID {state['pid']} ({state['mode']}), listen={state['listen']}")
            else:
                self.clear_state()
                print("관리 중인 서버가 없습니다")
            return state

    def adopt(self, pid, config="config.json"):
        # One-time migration of a server started manually from this checkout.
        with self.locked():
            if self.active():
                raise RuntimeError("이미 관리 중인 서버가 있습니다")
            try:
                executable = os.readlink(f"/proc/{pid}/exe").removesuffix(" (deleted)")
                cwd = Path(os.readlink(f"/proc/{pid}/cwd")).resolve()
            except OSError:
                raise RuntimeError("실행 파일과 작업 디렉터리를 확인할 수 없습니다") from None
            if executable != str(self.binary) or cwd != self.root:
                raise RuntimeError("이 저장소에서 실행한 SafeHandoff 프로세스가 아닙니다")
            path, listen, _, _ = self.configuration(config)
            state = self.save_state(pid, path, False, listen)
            print(f"관리 등록됨: PID {pid}")
            return state

    def logs(self, follow=False):
        if not self.log_path.exists():
            print("아직 서버 로그가 없습니다")
        elif follow:
            subprocess.run(["tail", "-n", "100", "-F", str(self.log_path)], check=False)
        else:
            with self.log_path.open(errors="replace") as log:
                print("".join(deque(log, maxlen=100)), end="")


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["start", "stop", "restart", "status", "logs", "adopt"])
    parser.add_argument("--config", default="config.json")
    parser.add_argument("--fixture", action="store_true")
    parser.add_argument("--follow", action="store_true")
    parser.add_argument("--pid", type=int)
    args = parser.parse_args()
    manager = ServerManager()
    try:
        if args.action in ["start", "restart"]:
            getattr(manager, args.action)(args.config, args.fixture)
        elif args.action == "adopt":
            if args.pid is None:
                parser.error("adopt에는 --pid가 필요합니다")
            manager.adopt(args.pid, args.config)
        elif args.action == "logs":
            manager.logs(args.follow)
        else:
            getattr(manager, args.action)()
    except (RuntimeError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
