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
    static_target.__globals__["ARTIFACT_ROOT"] = root
    static_target.__globals__["STATE_FILE"] = state

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
    finally:
        connection.close()
        server.shutdown()
        server.server_close()
PY
remote_path=$("$repo_dir/scripts/lavish-homelab" remote-path "$test_dir/example.html")
[[ "$remote_path" =~ ^/home/avirus/\.local/share/lavish/artifacts/[A-Za-z0-9._-]+/[a-f0-9]{16}/example\.html$ ]]
[[ "$("$repo_dir/scripts/lavish-homelab" alias-for "$test_dir/example.html" --source-markdown "$test_dir/WBJ Payments.md")" == wbj-payments ]]
[[ "$("$repo_dir/scripts/lavish-homelab" alias-for "$test_dir/example.html" --alias "My Review")" == my-review ]]
[[ "$("$repo_dir/scripts/lavish-homelab" alias-for "$test_dir/Pretty Report/index.html")" == pretty-report ]]

echo "lavish-homelab: ok"
