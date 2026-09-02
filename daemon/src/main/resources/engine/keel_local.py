"""
Local sources for a Glue script: every read comes from a file next to the job, every write goes
to `out/`, and no AWS call leaves the machine.

The Glue container cannot serve `create_dynamic_frame.from_catalog` — it calls `getCatalogSource`
on the Java side, which needs the real Data Catalog. So instead of emulating the catalog we
replace the *reader*: `install()` swaps `glueContext.create_dynamic_frame` and
`glueContext.write_dynamic_frame` for objects that map a node's `transformation_ctx` (which is
its DAG node id) to a sample file. The generated script is untouched, so what runs locally is
the same code that runs in Glue.
"""
import json
import os

_FORMAT_BY_EXT = {".csv": "csv", ".json": "json", ".jsonl": "json", ".parquet": "parquet"}


class MissingSample(Exception):
    """Raised with the node id, so the app can offer to capture or synthesise exactly that one."""


class _Reader:
    def __init__(self, ctx, manifest, base, bookmark=None, consumed=None):
        self._ctx, self._manifest, self._base = ctx, manifest, base
        self._bookmark = bookmark  # node -> [paths already processed by an earlier local run]
        self._consumed = consumed if consumed is not None else {}

    def _read(self, kw):
        ctx = kw.get("transformation_ctx") or kw.get("name_space") or ""
        entry = self._manifest.get(ctx)
        if entry is None:
            raise MissingSample(
                "no local sample for node %r. Capture one from the real source, or generate a "
                "synthetic one from the node's schema, then run again." % ctx)
        path = entry["path"]
        if not os.path.isabs(path):
            path = os.path.join(self._base, path)
        fmt = entry.get("format") or _FORMAT_BY_EXT.get(os.path.splitext(path)[1].lower(), "json")
        spark = self._ctx.spark_session
        if fmt == "csv":
            df = spark.read.option("header", "true").option("inferSchema", "true").csv(path)
        elif fmt == "parquet":
            df = spark.read.parquet(path)
        else:
            df = spark.read.json(path)
        if self._bookmark is not None:
            # A bookmarked source skips what an earlier run already read. This is a simulation of
            # Glue's own bookmark, and it is labelled as one everywhere it shows up — but it
            # reproduces the trap that matters: the second run sees nothing.
            seen = self._bookmark.get(ctx) or []
            self._consumed.setdefault(ctx, []).append(path)
            if path in seen:
                df = df.limit(0)
        from awsglue.dynamicframe import DynamicFrame
        return DynamicFrame.fromDF(df, self._ctx, ctx or "local")

    def from_catalog(self, **kw):
        return self._read(kw)

    def from_options(self, **kw):
        return self._read(kw)

    def from_jdbc_conf(self, **kw):
        return self._read(kw)

    def from_rdd(self, data, name, schema=None, sample_ratio=None):
        from awsglue.dynamicframe import DynamicFrame
        return DynamicFrame.fromDF(self._ctx.spark_session.createDataFrame(data, schema), self._ctx, name)


class _Writer:
    """Targets write real files under `out/<node>/`, so a local run can be inspected like a real one."""

    def __init__(self, ctx, out_dir, written):
        self._ctx, self._out, self._written = ctx, out_dir, written

    def _write(self, kw):
        frame = kw.get("frame")
        ctx = kw.get("transformation_ctx") or "target"
        fmt = kw.get("format") or "json"
        path = os.path.join(self._out, ctx)
        df = frame.toDF()
        writer = df.write.mode("overwrite")
        keys = (kw.get("connection_options") or {}).get("partitionKeys") or \
               (kw.get("additional_options") or {}).get("partitionKeys") or []
        if keys:
            writer = writer.partitionBy(*keys)
        if fmt in ("parquet", "glueparquet"):
            writer.parquet(path)
        elif fmt == "csv":
            writer.option("header", "true").csv(path)
        else:
            writer.json(path)
        self._written.append({"node": ctx, "path": path, "rows": df.count(), "format": fmt})
        return frame

    def from_options(self, **kw):
        return self._write(kw)

    def from_catalog(self, **kw):
        return self._write(kw)

    def from_jdbc_conf(self, **kw):
        return self._write(kw)


def _override(ctx, name, value):
    """`create_dynamic_frame` is a read-only property on GlueContext, so plain assignment fails.

    Give this one instance a private subclass and hang the replacement off that: the real class,
    and every other GlueContext in the process, is left alone.
    """
    try:
        setattr(ctx, name, value)
        return
    except AttributeError:
        pass
    cls = type(ctx)
    if not getattr(cls, "_keel_shim", False):
        cls = type("KeelGlueContext", (cls,), {"_keel_shim": True})
        ctx.__class__ = cls
    setattr(cls, name, property(lambda self, v=value: v))


def watch(glueContext, stats, node, frame):
    """Counts what one node produced, so a local run reports rows in and out per node."""
    df = frame.toDF().cache()
    stats.append({"node": node, "rows": df.count(), "columns": len(df.columns)})
    from awsglue.dynamicframe import DynamicFrame
    return DynamicFrame.fromDF(df, glueContext, node)


def plan(frame):
    """The physical plan, where `PushedFilters` and `PartitionFilters` say what reached the reader."""
    try:
        return frame.toDF()._jdf.queryExecution().executedPlan().toString()[:4000]
    except Exception:  # noqa: BLE001
        return ""


def install(glueContext, manifest, out_dir="out", base=".", bookmark=None, consumed=None):
    """Point every source at a sample and every target at `out_dir`. Returns the list writes land in."""
    if isinstance(manifest, str):
        manifest = json.loads(manifest)
    if isinstance(bookmark, str):
        bookmark = json.loads(bookmark)
    written = []
    os.makedirs(out_dir, exist_ok=True)
    _override(glueContext, "create_dynamic_frame", _Reader(glueContext, manifest, base, bookmark, consumed))
    _override(glueContext, "write_dynamic_frame", _Writer(glueContext, out_dir, written))
    # purging must never reach a real bucket from a local run
    _override(glueContext, "purge_s3_path", lambda *a, **k: None)
    _override(glueContext, "purge_table", lambda *a, **k: None)
    return written
