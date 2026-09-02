"""
Keel's warm engine: one long-lived process inside AWS's Glue image that holds a live
SparkSession and GlueContext, and runs a script we hand it per request.

Spark costs ~6 s to start and ~4 s to reach its first action. Paying that once per preview is
what makes the local loop feel like a cloud round trip; paying it once per *session* is what
makes it feel like a REPL. Nothing here is Keel-specific beyond the protocol: POST a script,
get back what it printed.
"""
import contextlib
import io
import json
import os
import sys
import time
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer

WORKSPACE = os.environ.get("KEEL_WORKSPACE", "/home/hadoop/workspace")
sys.path.insert(0, WORKSPACE)

_ctx = None
_started = time.time()


def glue():
    """The one GlueContext. Created on the first request, not at boot, so a health check is instant."""
    global _ctx
    if _ctx is None:
        from awsglue.context import GlueContext
        from pyspark.context import SparkContext
        _ctx = GlueContext(SparkContext.getOrCreate())
    return _ctx


def run(req):
    cwd = req.get("cwd")
    if cwd:
        os.chdir(cwd)
        if cwd not in sys.path:
            sys.path.insert(0, cwd)
    # job.py changes between requests; a cached module would silently run the previous DAG.
    for name in [m for m in list(sys.modules) if m == "job" or m.startswith("job.") or m == "keel_local"]:
        del sys.modules[name]
    import importlib
    importlib.invalidate_caches()
    out = io.StringIO()
    t0 = time.time()
    scope = {"__name__": "__keel__", "__file__": os.path.join(cwd or WORKSPACE, "<keel>"), "glueContext": glue()}
    with contextlib.redirect_stdout(out):
        exec(compile(req["script"], "<keel>", "exec"), scope)  # noqa: S102 - the script is ours
    return {"stdout": out.getvalue(), "ms": int((time.time() - t0) * 1000)}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):  # noqa: N802
        self.reply({"ok": True, "spark": _ctx is not None, "uptime": int(time.time() - _started)})

    def do_POST(self):  # noqa: N802
        body = self.rfile.read(int(self.headers.get("content-length") or 0))
        try:
            req = json.loads(body or b"{}")
        except ValueError as e:
            self.reply({"error": "bad request: %s" % e}, 400)
            return
        try:
            self.reply(run(req))
        except Exception:  # noqa: BLE001 - every failure is a result, not a crash
            self.reply({"error": traceback.format_exc()[-8000:]})

    def reply(self, obj, code=200):
        payload = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass  # the daemon owns the logs


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8088), Handler).serve_forever()
