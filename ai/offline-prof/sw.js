const VERSION = "mop-v4";
const SHARED = "mop-shared";
const FONTS = "mop-fonts";
const FONT_FILES = [
  "https://fastly.jsdelivr.net/gh/projectnoonnu/2408-5@1.0/HakgyoansimNadeuriTTF-B.woff2",
];

const SHELL = [
  "./",
  "../../shared.css",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/css/style.css",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/apple-touch-icon.png",
  "./src/main.js",
  "./src/config.js",
  "./src/db.js",
  "./src/nav.js",
  "./src/qa.js",
  "./src/search.js",
  "./src/state.js",
  "./src/translate.js",
  "./src/util.js",
  "./src/llm/engine.js",
  "./src/llm/prompts.js",
  "./src/pdf/extract.js",
  "./src/views/ask.js",
  "./src/views/library.js",
  "./src/views/read.js",
  "./src/views/setup.js",
  "./vendor/pdfjs/pdf.min.mjs",
  "./vendor/pdfjs/pdf.worker.min.mjs",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL))
      .then(() => caches.open(FONTS).then((cache) => cache.addAll(FONT_FILES)).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("mop-v") && key !== VERSION) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

function isolated(response) {
  if (!response || response.type === "opaque" || response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "credentialless");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const offline = () => new Response("오프라인이에요. 인터넷이 될 때 한 번 열어 주세요.", {
  status: 503,
  headers: { "Content-Type": "text/plain; charset=utf-8" },
});

async function fromApp(request) {
  const cache = await caches.open(VERSION);
  const key = request.mode === "navigate" ? "./index.html" : request;
  const cached = await cache.match(key, { ignoreSearch: request.mode === "navigate" });
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(key, response.clone());
      return response;
    })
    .catch(() => null);
  return isolated(cached || (await network) || offline());
}

async function fromFonts(request) {
  const cache = await caches.open(FONTS);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

async function receiveShare(request) {
  try {
    const file = (await request.formData()).get("pdf");
    if (file) {
      const cache = await caches.open(SHARED);
      await cache.put("./shared-pdf", new Response(file, {
        headers: { "X-Name": encodeURIComponent(file.name || "shared.pdf") },
      }));
    }
  } catch {}
  return Response.redirect("./?shared=1", 303);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname.endsWith("/share-target")) {
    event.respondWith(receiveShare(request));
  } else if (request.method !== "GET") {
    return;
  } else if (url.origin === location.origin) {
    event.respondWith(fromApp(request));
  } else if (url.hostname === "fastly.jsdelivr.net") {
    event.respondWith(fromFonts(request));
  }
});
