"""Loopback-only HTTP server for the local ELISA application."""

from __future__ import annotations

import argparse
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from threading import Timer
from urllib.parse import urlparse
from urllib.request import urlopen
import webbrowser

from .analysis import analyze
from .importer import ImportErrorDetail, import_workbook
from .model import layout_status_warnings, normalize_layout, reusable_layout
from .report import curve_plot_bytes, workbook_bytes

WEB = Path(__file__).resolve().parent.parent / "web"
MAX_BODY = 30_000_000


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, data: bytes, content_type: str, filename: str | None = None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(data)

    def _json(self, status: int, value):
        self._send(status, json.dumps(value, allow_nan=False).encode("utf-8"), "application/json; charset=utf-8")

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            return self._json(200, {"status": "ok"})
        files = {"/": ("index.html", "text/html; charset=utf-8"),
                 "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                 "/style.css": ("style.css", "text/css; charset=utf-8")}
        if path in files:
            name, mime = files[path]
            return self._send(200, (WEB / name).read_bytes(), mime)
        self._json(404, {"error": "Not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                return self._json(413, {"error": "Request too large or empty."})
            payload = json.loads(self.rfile.read(length))
            if path == "/api/import":
                encoded = payload["data_base64"]
                content = base64.b64decode(encoded, validate=True)
                return self._json(200, import_workbook(content, payload.get("filename", "plate.xlsx"), payload.get("sheet_name")))
            if path == "/api/analyze":
                result = analyze(payload["imported"], payload["layout"])
                result["plots"] = {c["curve_id"]: curve_plot_bytes(c, result["well_results"], "svg").decode("utf-8")
                                   for c in result["curves"]}
                return self._json(200, result)
            if path == "/api/report":
                result = analyze(payload["imported"], payload["layout"])
                layout, _ = normalize_layout(payload["layout"])
                return self._send(200, workbook_bytes(result, layout),
                                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "elisa_analysis.xlsx")
            if path == "/api/layout":
                layout = reusable_layout(payload["layout"], payload["imported"]["wells"])
                return self._json(200, layout)
            if path == "/api/validate-layout":
                layout, errors = normalize_layout(payload["layout"])
                return self._json(200, {"layout": layout, "errors": errors,
                                        "warnings": layout_status_warnings(payload["imported"]["wells"], payload["layout"])})
            self._json(404, {"error": "Not found"})
        except (ImportErrorDetail, ValueError, KeyError, TypeError) as exc:
            self._json(400, {"error": str(exc)})
        except Exception as exc:
            self.log_error("Unhandled request error: %s", exc)
            self._json(500, {"error": f"Analysis failed: {exc}"})


def main():
    parser = argparse.ArgumentParser(description="ELISA Analysis Tool")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open-browser", action="store_true", help="Open the application in the default browser")
    args = parser.parse_args()
    url = f"http://127.0.0.1:{args.port}/"
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError:
        if args.open_browser:
            try:
                with urlopen(url + "health", timeout=2) as response:
                    if json.load(response).get("status") == "ok":
                        print(f"ELISA tool is already running: {url}", flush=True)
                        webbrowser.open(url)
                        return
            except Exception:
                pass
        raise
    print(f"ELISA Analysis Tool: {url}", flush=True)
    if args.open_browser:
        Timer(0.3, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
