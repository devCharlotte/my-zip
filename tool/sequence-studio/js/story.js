import { figureSVG } from "./figure.js";
import { itemSeconds, totalSeconds, doseText, formatMinutes, DISCIPLINES, TOOLS, PHASES } from "./poses.js";

const W = 1080;
const H = 1920;
const PAD = 72;
const SAFE = 250;
const BOTTOM = H - SAFE - 90;
const GAP = 28;
const HEAD = 64;

const FONT = '"HakgyoansimNadeuriTTF-B", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
const INK = "#253044";
const MUTED = "#5f6675";
const ACCENT = "#36699a";
const PHASE_COLORS = { warmup: "#e3c38c", main: "#a796d8", peak: "#d58c9c", cooldown: "#92b39a", rest: "#9cb3cc" };

function cropOf(figure, ratio) {
  const pts = Object.values(figure.j);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const head = figure.j.head;
  xs.push(head[0] - 7, head[0] + 7);
  ys.push(head[1] - 7);
  for (const prop of [].concat(figure.prop || [])) {
    if (prop.at) {
      const r = prop.r || prop.rx || 7;
      xs.push(prop.at[0] - r, prop.at[0] + r);
      ys.push(prop.at[1] - r);
    }
    for (const [x, y] of prop.path || []) {
      xs.push(x);
      ys.push(y);
    }
    if (prop.x != null) xs.push(prop.x, prop.x + (prop.w || 4));
    if (prop.seatY) ys.push(prop.seatY - (prop.back && prop.back !== "none" ? 22 : 2));
    if (prop.topY) ys.push(prop.topY - 2);
  }
  const bottom = Math.min(120, Math.max(...ys, 104) + 6);
  const w = Math.min(120, Math.max(64, Math.max(...xs) - Math.min(...xs) + 10, (bottom - Math.min(...ys) + 8) * ratio));
  const h = w / ratio;
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const x = Math.max(0, Math.min(120 - w, cx - w / 2));
  return [x * 2, Math.max(0, bottom - h) * 2, w * 2, h * 2];
}

function loadFigure(pose) {
  const url = URL.createObjectURL(new Blob([figureSVG(pose.figure, { size: 240 })], { type: "image/svg+xml" }));
  const img = new Image();
  img.src = url;
  return img.decode().then(() => ({ img, url }));
}

async function waitFonts() {
  await document.fonts.load(`700 32px ${FONT}`).catch(() => {});
  await document.fonts.ready;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function clip(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t + "…";
}

function wrap(ctx, text, max, lines) {
  const words = text.split(" ");
  const out = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > max && line) {
      out.push(line);
      line = word;
    } else line = test;
  }
  out.push(line);
  if (out.length > lines) out.splice(lines - 1, out.length, clip(ctx, out.slice(lines - 1).join(" "), max));
  return out;
}

function entriesOf(items, byId) {
  const list = [];
  items.forEach((item, i) => {
    if (item.phase !== items[i - 1]?.phase) {
      let sec = 0;
      for (let j = i; j < items.length && items[j].phase === item.phase; j++) sec += itemSeconds(items[j], byId.get(items[j].id));
      list.push({ head: true, phase: item.phase, sec });
    }
    list.push({ item, pose: byId.get(item.id), n: i + 1 });
  });
  return list;
}

function paginate(entries, cols, row, height) {
  const pages = [];
  let page = [];
  let col = 0;
  let y = 0;
  let phase = null;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const h = e.head ? HEAD : row + 14;
    const need = e.head ? h + row + 14 : h;
    if (y + need > height) {
      col += 1;
      y = 0;
      if (col >= cols) {
        pages.push(page);
        page = [];
        col = 0;
        if (!e.head && phase) {
          page.push({ ...phase, more: true, col, y });
          y += HEAD;
        }
      }
    }
    if (e.head) phase = e;
    page.push({ ...e, col, y });
    y += h;
  }
  pages.push(page);
  return pages;
}

const MIN_ROW = 88;

function bestRow(entries, cols, height) {
  for (let row = cols === 1 ? 190 : 170; row >= (cols === 1 ? 110 : MIN_ROW); row -= 5) {
    if (paginate(entries, cols, row, height).length === 1) return row;
  }
  return 0;
}

function split(entries, count) {
  const per = Math.ceil(entries.filter((e) => !e.head).length / count);
  const chunks = [[]];
  let items = 0;
  let phase = null;
  for (const e of entries) {
    let chunk = chunks.at(-1);
    if (!e.head && items === per) {
      const tail = chunk.at(-1)?.head ? chunk.pop() : null;
      chunk = [];
      chunks.push(chunk);
      items = 0;
      if (tail) chunk.push(tail);
      else if (phase) chunk.push({ ...phase, more: true });
    }
    if (e.head) phase = e;
    else items += 1;
    chunk.push(e);
  }
  return chunks;
}

function chooseLayout(entries, height) {
  for (const cols of [1, 2]) {
    const row = bestRow(entries, cols, height);
    if (row) return { cols, row, pages: paginate(entries, cols, row, height) };
  }
  const chunks = split(entries, paginate(entries, 2, MIN_ROW, height).length);
  const rows = chunks.map((c) => bestRow(c, 2, height));
  if (rows.includes(0)) return { cols: 2, row: MIN_ROW, pages: paginate(entries, 2, MIN_ROW, height) };
  const row = Math.min(...rows);
  return { cols: 2, row, pages: chunks.map((c) => paginate(c, 2, row, height)[0]) };
}

function background(ctx) {
  const base = ctx.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, "#fff7ec");
  base.addColorStop(0.48, "#eef8ff");
  base.addColorStop(1, "#f8f0ff");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  const glow = (x, y, r, color) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  glow(W * 0.12, H * 0.08, 700, "rgba(255, 211, 235, 0.62)");
  glow(W * 0.88, H * 0.1, 640, "rgba(139, 215, 255, 0.48)");
  glow(W * 0.5, H, 760, "rgba(199, 183, 255, 0.34)");
}

function pill(ctx, x, y, text, fill, color, size = 30) {
  ctx.font = `700 ${size}px ${FONT}`;
  const w = ctx.measureText(text).width + size * 1.2;
  const h = size * 1.7;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + size * 0.6, y + h / 2 + 1);
  ctx.textBaseline = "alphabetic";
  return w;
}

function drawHeader(ctx, seq, items, byId) {
  const total = totalSeconds(items, byId);
  const date = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  const kinds = [...new Set(items.map((it) => byId.get(it.id).discipline))];
  const tools = [...new Set(items.map((it) => byId.get(it.id).tool))];

  pill(ctx, PAD, SAFE, "오늘의 수업", "rgba(255, 255, 255, 0.72)", MUTED);

  let size = 92;
  ctx.font = `700 ${size}px ${FONT}`;
  let lines = wrap(ctx, seq.title || "이름 없는 시퀀스", W - PAD * 2, 2);
  if (lines.length > 1) {
    size = 76;
    ctx.font = `700 ${size}px ${FONT}`;
    lines = wrap(ctx, seq.title || "이름 없는 시퀀스", W - PAD * 2, 2);
  }
  ctx.fillStyle = INK;
  const titleY = SAFE + 50 + size * 1.25;
  lines.forEach((line, i) => ctx.fillText(line, PAD, titleY + i * size * 1.2));
  let y = titleY + (lines.length - 1) * size * 1.2 + 64;

  ctx.font = `700 36px ${FONT}`;
  ctx.fillStyle = MUTED;
  ctx.fillText(`${date}, 약 ${formatMinutes(total)}, 자세 ${items.length}개`, PAD, y);
  y += 34;

  let x = PAD;
  for (const k of kinds) x += pill(ctx, x, y, DISCIPLINES[k] || k, "rgba(255, 255, 255, 0.78)", ACCENT) + 10;
  for (const t of tools) {
    ctx.font = `700 30px ${FONT}`;
    if (x + ctx.measureText(TOOLS[t]).width + 40 > W - PAD) {
      x = PAD;
      y += 62;
    }
    x += pill(ctx, x, y, TOOLS[t] || t, t === "ring" ? "#ffe3f1" : t === "circle" ? "#dff1fd" : "#fff3df", t === "ring" ? "#a1466a" : t === "circle" ? "#2f6189" : "#7d6440") + 10;
  }
  y += 78;

  const sums = {};
  items.forEach((it) => (sums[it.phase] = (sums[it.phase] || 0) + itemSeconds(it, byId.get(it.id))));
  const work = Object.values(sums).reduce((a, b) => a + b, 0);
  let bx = PAD;
  const bw = W - PAD * 2;
  Object.keys(PHASES).filter((p) => sums[p]).forEach((p) => {
    const w = (sums[p] / work) * bw;
    roundRect(ctx, bx, y, Math.max(w - 4, 4), 16, 8);
    ctx.fillStyle = PHASE_COLORS[p];
    ctx.fill();
    bx += w;
  });
  return y + 76;
}

function drawEntry(ctx, e, top, cols, row, figures) {
  const colW = cols === 1 ? W - PAD * 2 : (W - PAD * 2 - GAP) / 2;
  const x = PAD + e.col * (colW + GAP);
  const y = top + e.y;

  if (e.head) {
    const w = pill(ctx, x, y + 4, `${PHASES[e.phase]}${e.more ? " 이어서" : ""}`, PHASE_COLORS[e.phase], INK, 28);
    if (e.more) return;
    ctx.font = `700 28px ${FONT}`;
    ctx.fillStyle = MUTED;
    ctx.fillText(formatMinutes(e.sec), x + w + 14, y + 39);
    return;
  }

  roundRect(ctx, x, y, colW, row, 26);
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.fill();
  ctx.strokeStyle = "rgba(120, 144, 180, 0.22)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const ratio = cols === 1 ? 1.3 : 1.05;
  const figH = row - 20;
  const figW = Math.round(figH * ratio);
  roundRect(ctx, x + 10, y + 10, figW, figH, 20);
  ctx.fillStyle = e.pose.discipline === "pilates" ? "#eef8f6" : "#f3f6fd";
  ctx.fill();
  ctx.drawImage(figures.get(e.pose.id).img, ...cropOf(e.pose.figure, ratio), x + 14, y + 14, figW - 8, figH - 8);

  const tx = x + figW + 28;
  const tw = colW - figW - 44;
  const nameSize = Math.round(Math.min(46, Math.max(32, row * 0.3)));
  const small = Math.round(nameSize * 0.78);
  ctx.font = `700 ${Math.round(nameSize * 0.7)}px ${FONT}`;
  const num = String(e.n).padStart(2, "0");
  const numW = ctx.measureText(num).width + 12;
  let size = nameSize;
  ctx.font = `700 ${size}px ${FONT}`;
  while (size > nameSize * 0.85 && ctx.measureText(e.pose.name).width > tw - numW) ctx.font = `700 ${--size}px ${FONT}`;
  const names = wrap(ctx, e.pose.name, tw - numW, row >= size * 2.4 + small * 1.3 + 20 ? 2 : 1);
  const showEn = e.pose.en && names.length === 1 && row >= size * 1.3 + small * 2.6 + 24;
  const height = size * (names.length * 1.2 + 0.1) + small * (showEn ? 2.6 : 1.3);
  let base = y + (row - height) / 2 + size;

  ctx.fillStyle = "#8aa0b8";
  ctx.font = `700 ${Math.round(nameSize * 0.7)}px ${FONT}`;
  ctx.fillText(num, tx, base);
  ctx.fillStyle = INK;
  ctx.font = `700 ${size}px ${FONT}`;
  names.forEach((line, i) => ctx.fillText(line, tx + numW, base + i * size * 1.2));
  base += size * ((names.length - 1) * 1.2 + 0.3) + small;

  if (showEn) {
    ctx.font = `700 ${Math.round(small * 0.86)}px ${FONT}`;
    ctx.fillStyle = MUTED;
    ctx.fillText(clip(ctx, e.pose.en, tw), tx, base);
    base += small * 1.3;
  }
  ctx.font = `700 ${small}px ${FONT}`;
  ctx.fillStyle = ACCENT;
  const tool = e.pose.tool !== "mat" && !e.pose.name.includes(TOOLS[e.pose.tool]) ? `  ·  ${TOOLS[e.pose.tool]}` : "";
  ctx.fillText(clip(ctx, doseText(e.pose, e.item.dur) + tool, tw), tx, base);
}

function drawFooter(ctx, page, pages) {
  ctx.font = `700 30px ${FONT}`;
  ctx.fillStyle = MUTED;
  ctx.fillText("Pilates & Yoga Sequence Studio", PAD, H - SAFE - 20);
  if (pages > 1) {
    ctx.textAlign = "right";
    ctx.fillText(`${page} / ${pages}`, W - PAD, H - SAFE - 20);
  }
  ctx.textAlign = "left";
}

export async function renderStory(seq, byId) {
  const items = seq.items.filter((it) => byId.has(it.id));
  await waitFonts();
  const figures = new Map();
  const poses = [...new Set(items.map((it) => byId.get(it.id)))];
  await Promise.all(poses.map(async (pose) => figures.set(pose.id, await loadFigure(pose))));

  const page = () => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    background(ctx);
    return { canvas, ctx, top: drawHeader(ctx, seq, items, byId) };
  };

  const first = page();
  const { cols, row, pages } = chooseLayout(entriesOf(items, byId), BOTTOM - first.top);
  const name = (seq.title || "sequence").replace(/[\\/:*?"<>|]/g, "").trim() || "sequence";
  const files = [];
  for (let i = 0; i < pages.length; i++) {
    const { canvas, ctx, top } = i ? page() : first;
    pages[i].forEach((e) => drawEntry(ctx, e, top, cols, row, figures));
    drawFooter(ctx, i + 1, pages.length);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const suffix = pages.length > 1 ? `-${i + 1}` : "";
    files.push(new File([blob], `${name}${suffix}.png`, { type: "image/png" }));
  }
  figures.forEach((f) => URL.revokeObjectURL(f.url));
  return files;
}
