const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
importScripts(PYODIDE + "pyodide.js");

const MODULES = [
  "__init__", "batch", "bmff", "c2pa", "cbor", "crop", "engine", "errors", "exif", "geometry", "jpeg",
  "jpeg_build", "jpeg_doc", "jumbf", "model", "mpf", "pixels", "png", "providers", "verify", "webp", "xmp",
];
const APP = "/home/pyodide/app";

let runner = null;

async function source(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(path + ": HTTP " + res.status);
  return res.text();
}

async function boot() {
  const py = await loadPyodide({ indexURL: PYODIDE });
  await py.loadPackage("pillow");
  py.FS.mkdirTree(APP + "/hdrclean");
  const files = await Promise.all([
    source("py/runner.py").then((text) => [APP + "/runner.py", text]),
    ...MODULES.map((m) => source(`py/hdrclean/${m}.py`).then((text) => [`${APP}/hdrclean/${m}.py`, text])),
  ]);
  for (const [path, text] of files) py.FS.writeFile(path, text);
  py.runPython(`import sys; sys.path.insert(0, "${APP}")`);
  runner = py.pyimport("runner");
  return runner.version();
}

const ready = boot();

function toBytes(proxy) {
  if (proxy === undefined || proxy === null) return null;
  const view = proxy.getBuffer("u8");
  try {
    return new Uint8Array(view.data);
  } finally {
    view.release();
    proxy.destroy();
  }
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    await ready;
    if (msg.type === "init") {
      self.postMessage({ id: msg.id, ok: true, version: runner.version() });
    } else if (msg.type === "reset") {
      runner.reset();
      self.postMessage({ id: msg.id, ok: true });
    } else if (msg.type === "reserve") {
      runner.reserve(JSON.stringify(msg.names));
      self.postMessage({ id: msg.id, ok: true });
    } else if (msg.type === "process") {
      const result = runner.process(new Uint8Array(msg.bytes), msg.name, JSON.stringify(msg.options || {}));
      const out = toBytes(result.get(0));
      const report = JSON.parse(result.get(1));
      result.destroy();
      self.postMessage({ id: msg.id, ok: true, report, out }, out ? [out.buffer] : []);
    } else if (msg.type === "zip") {
      const zipped = toBytes(runner.make_zip(JSON.stringify(msg.entries), ...msg.buffers.map((b) => new Uint8Array(b))));
      self.postMessage({ id: msg.id, ok: true, out: zipped }, [zipped.buffer]);
    }
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};

ready.then(
  (v) => self.postMessage({ type: "ready", version: v }),
  (err) => self.postMessage({ type: "boot-failed", error: String(err && err.message ? err.message : err) }),
);
