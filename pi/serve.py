#!/usr/bin/env python3
"""Walk & Wear, served from the Pi for the bedside device.

Same static files as the public GitHub Pages build — this adds one endpoint the
public build cannot have:

    GET /api/alarm  ->  {"state": "armed (home)" | "armed (away)" | "disarmed" | ...}

Why it exists here and not there: reading Ring's mode needs HOOBS credentials. On
a public page that means shipping a token in client JavaScript, where view-source
is enough to read it. Here the browser never sees one — the server reads HOOBS
itself and returns a single decoded word. Same origin, so no CORS and no mixed
content either.

Credentials are the existing read-only `energy-ro` HOOBS user from
/etc/hoobs-mcp.env. No new secret, and the credential itself is the safety
boundary: this process cannot operate locks or the alarm, only read state.

Stdlib only, so it runs on the Pi's system python3 with no venv — same as docs-hub.
"""

import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent      # repo root: index.html, css/, js/
BIND = os.environ.get("WW_BIND", "100.84.97.17")
PORT = int(os.environ.get("WW_PORT", "8797"))

HOOBS_URL = os.environ.get("HOOBS_URL", "http://127.0.0.1")
HOOBS_USER = os.environ.get("HOOBS_USER", "")
HOOBS_PASS = os.environ.get("HOOBS_PASS", "")
HTTP_TIMEOUT = 8.0

# Ported from pi-services/mcp/hoobs_mcp.py — keep in step.
SECURITY_STATE = {0: "armed (home)", 1: "armed (away)", 2: "armed (night)",
                  3: "disarmed", 4: "TRIGGERED"}

# The browser polls every 15s; without this each open tab would multiply load on
# hoobsd for a value that changes a few times a day.
CACHE_TTL = 10.0

_token = None
_token_lock = threading.Lock()
_cache = {"at": 0.0, "payload": None}
_cache_lock = threading.Lock()

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".json": "application/json",
    ".webmanifest": "application/manifest+json", ".png": "image/png",
    ".svg": "image/svg+xml", ".ico": "image/x-icon",
}


def _request(path, method="GET", body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{HOOBS_URL}{path}", data=data, method=method)
    req.add_header("content-type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
        raw = resp.read().decode("utf-8", "replace")
    return json.loads(raw) if raw else {}


def _logon():
    global _token
    body = _request("/api/auth/logon", "POST",
                    {"username": HOOBS_USER, "password": HOOBS_PASS, "remember": True})
    if not body.get("token"):
        raise RuntimeError("HOOBS logon failed — check /etc/hoobs-mcp.env")
    _token = body["token"]
    return _token


def _get(path):
    """GET a HOOBS path; the token is sent verbatim (no Bearer). Re-login on 401/403."""
    global _token
    with _token_lock:
        if _token is None:
            _logon()
        token = _token
    try:
        return _request(path, headers={"authorization": token})
    except urllib.error.HTTPError as exc:
        if exc.code not in (401, 403):
            raise
        with _token_lock:
            token = _logon()
        return _request(path, headers={"authorization": token})


def alarm_state():
    with _cache_lock:
        if _cache["payload"] is not None and (time.time() - _cache["at"]) < CACHE_TTL:
            return _cache["payload"]
    try:
        state = None
        for room in _get("/api/accessories"):
            for a in room.get("accessories", []):
                if a.get("type") != "security_system":
                    continue
                for c in a.get("characteristics", []):
                    if c.get("type") == "security_system_current_state":
                        state = SECURITY_STATE.get(c.get("value"), "unknown")
        payload = {"ok": True, "state": state or "no alarm found", "at": time.time()}
    except Exception as exc:  # noqa: BLE001
        payload = {"ok": False, "state": "unknown", "error": str(exc)[:160], "at": time.time()}
    with _cache_lock:
        _cache.update(at=time.time(), payload=payload)
    return payload


class Handler(BaseHTTPRequestHandler):
    server_version = "walk-and-wear/1.0"

    def do_GET(self):  # noqa: N802
        path = self.path.split("?", 1)[0]

        if path == "/api/alarm":
            return self._send(200, "application/json", json.dumps(alarm_state()).encode())

        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        target = (ROOT / rel).resolve()
        # Never serve outside the repo, and never serve the Pi-side source or the
        # archived transcript.
        if not str(target).startswith(str(ROOT)) or target.name == "serve.py" \
           or "session-export" in target.parts or not target.is_file():
            return self._send(404, "text/plain; charset=utf-8", b"not found")

        ctype = CONTENT_TYPES.get(target.suffix, "application/octet-stream")
        return self._send(200, ctype, target.read_bytes())

    def _send(self, code, ctype, body):
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # journald has what matters; per-request noise is not useful


if __name__ == "__main__":
    if not HOOBS_USER or not HOOBS_PASS:
        print("warning: HOOBS_USER/HOOBS_PASS unset — /api/alarm will report unknown",
              file=sys.stderr, flush=True)
    print(f"walk-and-wear on http://{BIND}:{PORT} (serving {ROOT})", flush=True)
    ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()
