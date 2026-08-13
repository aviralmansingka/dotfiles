#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "$0")/.." && pwd -P)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
touch "$test_dir/example.html"
mkdir "$test_dir/Pretty Report"
touch "$test_dir/Pretty Report/index.html"

bash -n "$repo_dir/scripts/lavish-homelab"
uv run python - "$repo_dir/scripts/lavish-aliases" <<'PY'
import http.client
import json
import runpy
import sys
import tempfile
import threading
from pathlib import Path

module = runpy.run_path(sys.argv[1])
target_re = module["TARGET_RE"]
static_target = module["static_target"]
artifact_root = module["ARTIFACT_ROOT"]
assert target_re.fullmatch("https://homelab.tail1b3b66.ts.net:8443/session/abc123")
assert target_re.fullmatch("https://homelab.tail1b3b66.ts.net:8443/artifact/abc123/index.html")
assert not target_re.fullmatch("https://example.com/artifact/abc123/index.html")
assert static_target(str(artifact_root / "device/digest/example.html"))
assert not static_target(str(artifact_root / "../example.html"))
assert not static_target(str(artifact_root / "device/digest/example.js"))

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary) / "artifacts"
    artifact = root / "device/digest/example.html"
    artifact.parent.mkdir(parents=True)
    artifact.write_text("<h1>plain artifact</h1>")
    (artifact.parent / "app.css").write_text("body{}")
    state = Path(temporary) / "aliases.json"
    state.write_text(json.dumps({"demo": str(artifact)}))
    contexts = Path(temporary) / "contexts.json"
    contexts.write_text("{}")
    static_target.__globals__["ARTIFACT_ROOT"] = root
    static_target.__globals__["STATE_FILE"] = state
    static_target.__globals__["CONTEXT_FILE"] = contexts

    server = module["ThreadingHTTPServer"](("127.0.0.1", 0), module["RedirectHandler"])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    connection = http.client.HTTPConnection("127.0.0.1", server.server_port)
    try:
        connection.request("GET", "/demo?variant=B")
        response = connection.getresponse()
        assert response.status == 308
        assert response.getheader("Location") == "/demo/?variant=B"
        response.read()

        connection.request("GET", "/demo/?variant=B")
        response = connection.getresponse()
        assert response.status == 200
        assert response.read() == b"<h1>plain artifact</h1>"

        connection.request("HEAD", "/demo/app.css")
        response = connection.getresponse()
        assert response.status == 200
        assert response.getheader("Content-Type") == "text/css"
        assert response.read() == b""

        connection.request("GET", "/demo/../secret")
        response = connection.getresponse()
        assert response.status == 404
        response.read()

        calls = []
        def fake_agent(context, command, question=None):
            calls.append((context, command, question))
            if command == "history":
                return {"messages": [], "agent_status": "idle", "workspace": "Artifact-demo"}
            if command == "check":
                return {
                    "artifact_changed_since_launch": False,
                    "artifact_added_lines": 0,
                    "artifact_removed_lines": 0,
                    "branch": "main",
                    "baseline_commit": "a" * 40,
                    "workspace": "Artifact-demo",
                    "git_status": [],
                }
            return {
                "answer": "A bounded answer",
                "messages": [
                    {"role": "user", "text": question},
                    {"role": "assistant", "text": "A bounded answer"},
                ],
            }

        static_target.__globals__["run_agent"] = fake_agent
        contexts.write_text(json.dumps({"demo": "artifact-context"}))

        connection.request("GET", "/demo/")
        response = connection.getresponse()
        shell = response.read()
        assert response.status == 200
        assert b"Ask about this" in shell and b"Check changes" in shell
        assert b'aria-hidden="true" inert' in shell
        assert b"drawer.inert = !open" in shell
        assert b"join(String.fromCharCode(10))" in shell
        assert b"event.metaKey || event.altKey) return" in shell
        assert b"event.altKey || event.shiftKey" not in shell

        connection.request("GET", "/demo/__artifact/content/")
        response = connection.getresponse()
        assert response.status == 200
        assert response.read() == b"<h1>plain artifact</h1>"

        connection.request("GET", "/demo/__artifact/content/app.css")
        response = connection.getresponse()
        assert response.status == 200
        assert response.read() == b"body{}"

        connection.request("GET", "/demo/__artifact/api/history")
        response = connection.getresponse()
        assert response.status == 200
        assert json.loads(response.read())["workspace"] == "Artifact-demo"

        body = json.dumps({"message": "What is this?"}).encode()
        connection.request(
            "POST",
            "/demo/__artifact/api/chat",
            body=body,
            headers={"Content-Type": "application/json", "Content-Length": str(len(body))},
        )
        response = connection.getresponse()
        assert response.status == 200
        assert json.loads(response.read())["answer"] == "A bounded answer"
        assert calls[-1] == ("artifact-context", "chat", "What is this?")

        connection.request(
            "POST",
            "/demo/__artifact/api/chat",
            body=b"not-json",
            headers={"Content-Type": "application/json", "Content-Length": "8"},
        )
        response = connection.getresponse()
        assert response.status == 400
        response.read()

        connection.request("GET", "/demo/__artifact/api/check")
        response = connection.getresponse()
        assert response.status == 200
        assert json.loads(response.read())["artifact_changed_since_launch"] is False
    finally:
        connection.close()
        server.shutdown()
        server.server_close()

    calls = []
    def fake_run(args, **kwargs):
        calls.append(args)
        return type("Result", (), {"stdout": json.dumps({
            "Web": {f"{module['HOSTNAME']}:443": {"Handlers": {
                "/demo": {"Proxy": f"http://{module['LISTEN_HOST']}:{module['LISTEN_PORT']}/demo"}
            }}}
        })})()

    module["set_alias"].__globals__["subprocess"].run = fake_run
    module["alias_owner"]("demo")
    previous = module["set_alias"]("demo", str(artifact), "replacement-context")
    saved = json.loads(state.read_text())
    assert previous == "artifact-context"
    assert saved == {"demo": {"target": str(artifact), "context": "replacement-context"}}
    assert all(call[:4] == ["tailscale", "serve", "status", "--json"] for call in calls)
PY
grep -F 'rsync -azR --exclude .git/ "./$artifact_dir_relative/"' "$repo_dir/scripts/lavish-homelab" >/dev/null
grep -F '"$(quote_remote "$REMOTE_ALIASES") check $(quote_remote "$alias")"' "$repo_dir/scripts/lavish-homelab" >/dev/null
grep -F 'retire --context $(quote_remote "$previous_context")' "$repo_dir/scripts/lavish-homelab" >/dev/null
grep -F 'publish_alias "$alias" "$target_url"' "$repo_dir/scripts/lavish-homelab" >/dev/null
grep -F 'retire-pending' "$repo_dir/scripts/lavish-homelab" >/dev/null
grep -F 'timeout=700' "$repo_dir/scripts/lavish-aliases" >/dev/null
remote_path=$("$repo_dir/scripts/lavish-homelab" remote-path "$test_dir/example.html")
[[ "$remote_path" =~ ^/home/avirus/\.local/share/lavish/artifacts/[A-Za-z0-9._-]+/[a-f0-9]{16}/example\.html$ ]]
[[ "$("$repo_dir/scripts/lavish-homelab" alias-for "$test_dir/example.html" --source-markdown "$test_dir/WBJ Payments.md")" == wbj-payments ]]
[[ "$("$repo_dir/scripts/lavish-homelab" alias-for "$test_dir/example.html" --alias "My Review")" == my-review ]]
[[ "$("$repo_dir/scripts/lavish-homelab" alias-for "$test_dir/Pretty Report/index.html")" == pretty-report ]]

echo "lavish-homelab: ok"
