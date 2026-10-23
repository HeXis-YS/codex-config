#!/usr/bin/env python3
"""Check update_plan exposure and execution with the real CLI and a local API fixture.

Run from any directory with Python 3.11+ and Codex installed. No model service is
called. Unique logs go to .codex/runs/; isolated CLI state is removed on exit.
This does not test model planning quality or recovery after compaction.
"""

import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile
from threading import Thread
import tomllib


def tool_names(tools):
    for tool in tools:
        if "name" in tool:
            yield tool["name"]
        yield from tool_names(tool.get("tools", []))


def check_case(base, enabled, cli, catalog, model, log):
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append(request)
            log.write(f"Request {len(requests)}: {self.path}; "
                      f"tools={list(tool_names(request.get('tools', [])))}\n")
            if enabled and len(requests) == 1:
                item = {"type": "function_call", "id": "fc_plan", "call_id": "call_plan",
                        "name": "update_plan", "arguments": json.dumps({
                            "plan": [{"step": "Verify local plan fixture", "status": "completed"}]
                        })}
            else:
                item = {"type": "message", "id": "msg_done", "role": "assistant",
                        "status": "completed", "content": [
                            {"type": "output_text", "text": "Fixture complete.", "annotations": []}
                        ]}
            response_id = f"resp_{len(requests)}"
            events = [
                {"type": "response.created", "response": {"id": response_id}},
                {"type": "response.output_item.added", "output_index": 0, "item": item},
                {"type": "response.output_item.done", "output_index": 0, "item": item},
                {"type": "response.completed", "response": {
                    "id": response_id, "status": "completed", "output": [item],
                    "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
                }},
            ]
            payload = "".join(f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"
                              for event in events).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    home, workspace = base / "home", base / "workspace"
    codex_dir = home / ".codex"
    codex_dir.mkdir(parents=True)
    workspace.mkdir()
    server = HTTPServer(("127.0.0.1", 0), Handler)
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        (codex_dir / "config.toml").write_text(
            f'model = {json.dumps(model)}\nmodel_provider = "fixture"\n'
            f'model_catalog_json = {json.dumps(str(catalog))}\n'
            'approval_policy = "never"\nproject_root_markers = []\n'
            '[features]\nmemories = false\n'
            f'[tools.update_plan]\nenabled = {str(enabled).lower()}\n'
            '[model_providers.fixture]\nname = "Local validation fixture"\n'
            f'base_url = "http://127.0.0.1:{server.server_port}/v1"\n'
            'wire_api = "responses"\n'
        )
        env = {"PATH": os.environ["PATH"], "HOME": str(home),
               "CODEX_HOME": str(codex_dir), "XDG_CONFIG_HOME": str(home / ".config"),
               "RUST_LOG": "error"}
        command = [cli, "exec", "--strict-config", "--ephemeral", "--skip-git-repo-check",
                   "--sandbox", "read-only", "--json", "--cd", str(workspace),
                   "Complete the local validation fixture."]
        log.write(f"Case enabled={enabled}; command={command!r}\n")
        log.flush()
        result = subprocess.run(command, env=env, stdin=subprocess.DEVNULL,
                                capture_output=True, text=True, timeout=45)
        log.write(result.stdout + result.stderr + f"\nExit: {result.returncode}\n")
        if result.returncode or not requests:
            raise RuntimeError(f"CLI fixture failed with update_plan enabled={enabled}")
        exposed = "update_plan" in set(tool_names(requests[0].get("tools", [])))
        if exposed != enabled:
            raise RuntimeError(f"Unexpected update_plan exposure: {exposed}")
        if enabled:
            outputs = [item for request in requests[1:] for item in request.get("input", [])
                       if item.get("type") == "function_call_output"
                       and item.get("call_id") == "call_plan"]
            log.write(f"Plan tool outputs: {outputs!r}\n")
            if not any("Plan updated" in str(item.get("output")) for item in outputs):
                raise RuntimeError("No successful update_plan result returned to the API")
        log.write(f"PASS: update_plan enabled={enabled}\n")
    finally:
        server.shutdown()
        worker.join()
        server.server_close()


def main():
    root = Path(__file__).resolve().parent.parent
    cli = shutil.which("codex")
    if not cli:
        raise SystemExit("Codex is required")
    config = (root / "config.toml").read_bytes()
    if tomllib.loads(config.decode()).get("tools", {}).get("update_plan", {}).get("enabled") is not True:
        raise SystemExit("Repository config does not enable update_plan")
    catalog = root / "models/deepseek.json"
    model = json.loads(catalog.read_text())["models"][0]["slug"]
    run_dir = root / ".codex/runs"
    run_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", prefix="plan-tool-", suffix=".log",
                                     dir=run_dir, delete=False) as log:
        print(f"Log: {log.name}", flush=True)
        log.write(f"Environment: {platform.platform()}\nEntry: python3 scripts/verify-plan-tool.py\n"
                  f"Config SHA256: {hashlib.sha256(config).hexdigest()}\n"
                  f"Catalog SHA256: {hashlib.sha256(catalog.read_bytes()).hexdigest()}\n"
                  f"Entry SHA256: {hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}\n")
        log.flush()
        for command in (["git", "rev-parse", "HEAD"], [cli, "--version"]):
            subprocess.run(command, cwd=root, stdout=log, stderr=subprocess.STDOUT, check=True)
        try:
            with tempfile.TemporaryDirectory(prefix="plan-tool-", dir=run_dir) as temporary:
                for enabled in (False, True):
                    check_case(Path(temporary) / str(enabled), enabled, cli, catalog, model, log)
            log.write("PASS: isolated state removed; no model endpoint used\n")
        except Exception as error:
            log.write(f"FAIL: {error}\n")
            raise
    print("PASS: real CLI honors update_plan toggle and executes a plan update")


if __name__ == "__main__":
    main()
