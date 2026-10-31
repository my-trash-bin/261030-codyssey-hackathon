#!/usr/bin/env python3
"""Manage isolated web/engine pairs with the existing PID ownership rules."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
from server import ROOT, ServerManager


class Component(ServerManager):
    def __init__(self, mode, component, root=ROOT):
        binary = "safehandoff-engine" if component == "engine" else "safehandoff-web"
        super().__init__(root, Path(root) / "bin" / binary)
        self.mode, self.component = mode, component
        self.directory = self.root / ".local/run" / mode / component
        self.pid_path = self.directory / "server_pid"
        self.state_path = self.directory / "server.json"
        self.log_path = self.directory / "server.log"
        self.port = (8091 if mode == "demo" else 8092) if component == "engine" else (8081 if mode == "demo" else 8082)

    def configuration(self, config):
        # Still validate the selected JSON before restart stops a running pair.
        path, _, _, _ = super().configuration(config)
        host = "127.0.0.1" if self.component == "engine" else "0.0.0.0"
        return path, f"{host}:{self.port}", "127.0.0.1", self.port

    def launch_args(self, path, fixture):
        if self.component == "engine":
            return [str(self.binary), "--mode", self.mode, "--config", str(path),
                    "--listen", f"127.0.0.1:{self.port}"]
        engine_port = 8091 if self.mode == "demo" else 8092
        return [str(self.binary), "--listen", f"0.0.0.0:{self.port}",
                "--engine", f"http://127.0.0.1:{engine_port}"]

    def save_state(self, pid, config, fixture, listen):
        state = super().save_state(pid, config, fixture, listen)
        state["mode"] = self.mode
        temporary = self.state_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(state, indent=2) + "\n")
        temporary.replace(self.state_path)
        return state


def operate(mode, action, config="config.json", component=None, follow=False):
    engine, web = Component(mode, "engine"), Component(mode, "web")
    # Serialize pair-level operations as well as each individual component.
    pair = ServerManager()
    pair.directory = ROOT / ".local/run" / mode
    with pair.locked():
        if action in ("start", "restart"):
            for item in (engine, web):
                item.configuration(config)
                if not item.binary.is_file():
                    raise RuntimeError("실행 파일이 없습니다; just build-lab을 실행하세요")
        if action in ("stop", "restart"):
            web.stop()
            engine.stop()
        if action in ("start", "restart"):
            existed = engine.active() is not None
            engine.start(config)
            try:
                web.start(config)
            except BaseException:
                if not existed:
                    engine.stop()
                raise
            print(f"{mode} 화면: http://127.0.0.1:{web.port}/")
        elif action == "status":
            for item in (engine, web):
                print(f"{mode}/{item.component}:")
                item.status()
        elif action == "logs":
            selected = engine if component == "engine" else web
            # Release pair lock before following a log indefinitely.
            return selected.log_path
    return None


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["demo", "live"])
    parser.add_argument("action", choices=["start", "stop", "restart", "status", "logs"])
    parser.add_argument("--config", default="config.json")
    parser.add_argument("--component", choices=["web", "engine"], default="web")
    parser.add_argument("--follow", action="store_true")
    args = parser.parse_args()
    try:
        path = operate(args.mode, args.action, args.config, args.component, args.follow)
        if path:
            if not path.exists():
                print("아직 로그가 없습니다")
            else:
                cmd = ["tail", "-n", "100"] + (["-F"] if args.follow else []) + [str(path)]
                subprocess.run(cmd, check=False)
    except KeyboardInterrupt:
        return 0
    except (RuntimeError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
