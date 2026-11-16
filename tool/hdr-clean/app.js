"use strict";

const HDR_KIND = {
  ultrahdr_gainmap: "Ultra HDR gain map", iso_21496_1: "ISO 21496-1 gain map", iso_21496_1_tmap: "ISO 21496-1 (tmap)",
  apple_gainmap: "Apple HDR gain map", gainmap_unknown_flavor: "gain map", pq: "HDR10 (PQ)", hlg: "HLG",
  cicp: "cICP 색 정보",
};
const MIME = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heif: "image/heif" };

const $ = (s) => document.querySelector(s);
const worker = new Worker("worker.js?v=20261116");
const pending = new Map();
let seq = 0;
let engineReady = false;
const queue = [];
const files = [];

function call(msg, transfer) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id }, transfer || []);
  });
}

worker.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === "ready") {
    engineReady = true;
    $("#engine").classList.add("ok");
    $("#engine-text").textContent = "처리 엔진 준비됨. 사진을 넣으면 바로 처리합니다.";
    $("#version").textContent = `엔진 ${m.version}`;
    pump();
    return;
  }
  if (m.type === "boot-failed") {
    $("#engine").classList.add("bad");
    $("#engine-text").textContent = "처리 엔진을 불러오지 못했습니다: " + m.error + " (네트워크를 확인하고 새로고침하세요)";
    return;
  }
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  if (m.ok) p.resolve(m); else p.reject(new Error(m.error));
};
worker.onerror = (e) => {
  $("#engine").classList.add("bad");
  $("#engine-text").textContent = "처리 엔진 오류: " + (e.message || "worker 시작 실패");
};

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}

function fmtBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(2) + " MB";
}

function hdrLabels(report) {
  const kinds = [].concat((report && report.hdr && report.hdr.kind) || []);
  return kinds.filter((k) => !/^no_/.test(k)).map((k) => HDR_KIND[k] || k);
}

function addFiles(list) {
  if (!list.length) return;
  $("#bar").hidden = false;
  for (const f of list) {
    const entry = { name: f.name, size: f.size, file: f, status: "queued" };
    entry.li = el("li", { class: "item" });
    files.push(entry);
    queue.push(entry);
    $("#list").append(entry.li);
    render(entry);
  }
  updateSummary();
  pump();
}

let busy = false;
async function pump() {
  if (busy || !engineReady || !queue.length) return;
  busy = true;
  try {
    await call({ type: "reserve", names: queue.map((f) => f.name) });
    while (queue.length) {
      const entry = queue.shift();
      entry.status = "working";
      render(entry);
      try {
        const bytes = await entry.file.arrayBuffer();
        const opts = $("#opt-text").checked
          ? { categories: ["c2pa", "software-tags", "xmp-tool", "xmp-provenance-ref", "text-mention"] } : {};
        const r = await call({ type: "process", bytes, name: entry.name, options: opts }, [bytes]);
        entry.result = r.report;
        entry.status = r.report.status;
        entry.out = r.out;
      } catch (err) {
        entry.status = "failed";
        entry.result = { error: { code: "browser", message: String(err.message || err) } };
      }
      entry.file = null;
      render(entry);
      updateSummary();
    }
  } finally {
    busy = false;
  }
}

function render(entry) {
  const li = entry.li;
  li.replaceChildren();
  const r = entry.result || {};
  const rep = r.report || {};
  const input = rep.input || rep;
  const chips = [];
  const statusText = {
    queued: ["대기", ""], working: ["처리 중", "busy"], success: ["완료", "ok"],
    nothing_to_do: ["지울 라벨 없음", "plain"], failed: ["실패", "bad"],
  }[entry.status] || [entry.status, ""];
  chips.push(el("span", { class: "chip " + statusText[1] }, statusText[0]));
  for (const h of hdrLabels(input)) chips.push(el("span", { class: "chip hdr" }, h));
  if ((input.providers || []).length) chips.push(el("span", { class: "chip ai" }, "편집 라벨 있음"));

  const head = el("div", { class: "item-head" },
    el("div", { class: "name" }, el("strong", {}, entry.name), el("span", { class: "muted" }, " " + fmtBytes(entry.size))),
    el("div", { class: "chips" }, chips));
  li.append(head);

  if (entry.status === "success" && entry.out) {
    const fmt = rep.output && rep.output.format;
    const blob = new Blob([entry.out], { type: MIME[fmt] || "application/octet-stream" });
    if (!entry.url) entry.url = URL.createObjectURL(blob);
    const removed = (rep.found || []).filter((it) => (rep.processed || []).includes(it.id));
    const pix = rep.checks && rep.checks.decoded_pixels;
    const pixText = pix && pix.status === "identical"
      ? "처리 전후 픽셀 decode 결과 동일" + (pix.image_2 ? " (gain map 포함)" : "")
      : (pix && pix.reason ? "픽셀 비교 생략: " + pix.reason : "");
    li.append(el("div", { class: "item-body" },
      fmt !== "heif" ? el("img", { class: "thumb", src: entry.url, alt: "", loading: "lazy" }) : null,
      el("div", { class: "detail" },
        el("div", { class: "row" }, el("span", { class: "k" }, "지운 것"),
          el("ul", {}, removed.map((it) => el("li", {}, it.label + (it.value ? ": " + it.value : ""))))),
        (rep.retained_for_hdr || []).length ? el("div", { class: "row" }, el("span", { class: "k" }, "HDR 위해 유지"),
          el("ul", {}, rep.retained_for_hdr.map((s) => el("li", {}, s)))) : null,
        pixText ? el("div", { class: "row" }, el("span", { class: "k" }, "검증"), el("span", {}, pixText)) : null,
        (rep.remaining_identifiers || []).length ? el("div", { class: "row warn" }, el("span", { class: "k" }, "남은 라벨"),
          el("ul", {}, rep.remaining_identifiers.map((e) => el("li", {}, `${e.field}: ${e.value}`)))) : null,
        el("div", { class: "actions" },
          el("a", { class: "button primary", href: entry.url, download: r.output_name }, "결과 받기 (" + r.output_name + ")"),
          el("span", { class: "muted" }, fmtBytes(entry.out.byteLength))))));
  } else if (entry.status === "nothing_to_do") {
    li.append(el("p", { class: "note" }, "지울 C2PA 편집 라벨을 찾지 못했습니다. 원본을 그대로 쓰면 됩니다."
      + ((input.unanalyzed || []).length ? " 일부 구조는 해석하지 못했습니다: " + input.unanalyzed.join("; ") : "")));
  } else if (entry.status === "failed") {
    const e = r.error || {};
    li.append(el("p", { class: "note bad" }, "처리하지 못했습니다. 원본은 바뀌지 않았습니다. " + (e.message || e.code || "")));
  }
}

function updateSummary() {
  const c = { success: 0, nothing_to_do: 0, failed: 0, pending: 0 };
  for (const f of files) {
    if (f.status in c) c[f.status]++; else c.pending++;
  }
  $("#summary").textContent = `${files.length}개 중 완료 ${c.success}, 라벨 없음 ${c.nothing_to_do}, 실패 ${c.failed}`
    + (c.pending ? `, 처리 중 ${c.pending}` : "");
  $("#zip-all").disabled = !c.success || c.pending > 0;
}

$("#file-input").addEventListener("change", (e) => {
  addFiles([...e.target.files]);
  e.target.value = "";
});
const drop = $("#drop");
for (const t of ["dragenter", "dragover"]) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); });
for (const t of ["dragleave", "drop"]) drop.addEventListener(t, () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => { e.preventDefault(); addFiles([...e.dataTransfer.files]); });
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

$("#zip-all").addEventListener("click", async () => {
  const done = files.filter((f) => f.status === "success" && f.out);
  const btn = $("#zip-all");
  btn.disabled = true;
  try {
    const entries = done.map((f) => ({ name: f.name, output_name: f.result.output_name }));
    const r = await call({ type: "zip", entries, buffers: done.map((f) => f.out.slice().buffer) });
    const url = URL.createObjectURL(new Blob([r.out], { type: "application/zip" }));
    const a = el("a", { href: url, download: "hdr-cleaned.zip" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    alert("ZIP을 만들지 못했습니다: " + (err.message || err));
  } finally {
    updateSummary();
  }
});

$("#clear").addEventListener("click", () => {
  if (busy || queue.length) return;
  if (engineReady) call({ type: "reset" });
  for (const f of files) if (f.url) URL.revokeObjectURL(f.url);
  files.length = 0;
  $("#list").replaceChildren();
  $("#bar").hidden = true;
});
