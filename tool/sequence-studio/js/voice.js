const BASE = new URL("../audio/", import.meta.url);
const WARM_LIMIT = 4;

let clips = {};
let loading = null;
const warm = new Map();

export function voiceKey(text) {
  let a = 0xdeadbeef ^ text.length;
  let b = 0x41c6ce57 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 2654435761);
    b = Math.imul(b ^ c, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return ((b >>> 0).toString(16).padStart(8, "0") + (a >>> 0).toString(16).padStart(8, "0")).slice(0, 12);
}

export function loadClips() {
  loading ||= fetch(new URL("index.json", BASE))
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}))
    .then((map) => (clips = map || {}));
  return loading;
}

export const hasClips = () => Object.keys(clips).length > 0;

export function clipFor(text) {
  const key = voiceKey(text);
  return clips[key] ? { src: new URL(`${key}.mp3`, BASE).href, seconds: clips[key] } : null;
}

export function preload(text) {
  const src = text && clipFor(text)?.src;
  if (!src || warm.has(src)) return;
  const el = new Audio();
  el.preload = "auto";
  el.src = src;
  warm.set(src, el);
  while (warm.size > WARM_LIMIT) warm.delete(warm.keys().next().value);
}

export function takeClip(src) {
  const el = warm.get(src) || new Audio(src);
  warm.delete(src);
  return el;
}
