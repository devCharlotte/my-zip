'use strict';

const NS = 'http://www.w3.org/2000/svg';
const MAP_W = 1200;
const MAP_H = 600;
const PIN_COLORS = ['#4f86c6', '#d9806b', '#e0a23a', '#c4566a', '#7a68b8', '#3a9a83', '#45556b', '#b0708f', '#d68fb8', '#6f7f96'];
const SEASONS = ['겨울', '봄', '여름', '가을'];
const CARD_W = 178;
const SIDE_GAP = 36;

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const map = $('map');
const world = $('world');
const leaders = $('leaders');
const lines = $('lines');
const cardLayer = $('cards');

const colors = new Map();
for (const p of PEOPLE) {
  if (!colors.has(p.country)) colors.set(p.country, PIN_COLORS[colors.size % PIN_COLORS.length]);
}
const colorOf = (p) => colors.get(p.country);

const weather = new Map();
const cards = new Map();
const pins = new Map();
const formats = new Map();
let selected = null;
let showAll = false;

const wx = (lon) => (lon + 180) * MAP_W / 360;
const wy = (lat) => (90 - lat) * MAP_H / 180;

function fmt(zone, kind) {
  const key = zone + kind;
  if (!formats.has(key)) {
    const opts = {
      time: { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' },
      date: { month: 'numeric', day: 'numeric', weekday: 'short' },
      month: { month: 'numeric' },
      hm: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
    }[kind];
    formats.set(key, new Intl.DateTimeFormat(kind === 'hm' ? 'en-GB' : 'ko-KR', { timeZone: zone, ...opts }));
  }
  return formats.get(key);
}

function season(p, d) {
  const month = Number(fmt(p.tz, 'month').formatToParts(d).find((x) => x.type === 'month').value);
  return SEASONS[(Math.floor((month % 12) / 3) + (p.lat < 0 ? 2 : 0)) % 4];
}

function sky(code) {
  if (code === 0) return '맑음';
  if (code <= 2) return '대체로 맑음';
  if (code === 3) return '흐림';
  if (code === 45 || code === 48) return '안개';
  if (code >= 51 && code <= 57) return '이슬비';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return '비';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '눈';
  if (code >= 95) return '뇌우';
  return '날씨 정보';
}

function weatherText(p) {
  const w = weather.get(p.id);
  if (!w) return '날씨 확인 중';
  if (w.error) return '날씨를 못 불러왔어요';
  return `${Math.round(w.temp)}°C, ${sky(w.code)}`;
}

function isDay(p, d) {
  const now = fmt(p.tz, 'hm').format(d);
  const w = weather.get(p.id);
  if (w && w.rise && w.set) return now >= w.rise.slice(11, 16) && now < w.set.slice(11, 16);
  const h = Number(now.slice(0, 2));
  return h >= 7 && h < 19;
}

function el(tag, cls, parent, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  if (parent) parent.append(node);
  return node;
}

function makeCard(p) {
  const card = el('article', 'card', cardLayer);
  card.style.setProperty('--pin', colorOf(p));
  const head = el('div', 'card-head', card);
  el('strong', '', head, p.name);
  const day = el('span', 'day', head);
  const close = el('button', 'close', card, '×');
  close.type = 'button';
  close.setAttribute('aria-label', '닫기');
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    select(null);
  });
  if (p.school) el('div', 'school', card, p.school);
  el('div', 'city', card, `${p.city}, ${p.country}`);
  const date = el('div', 'date', card);
  const clock = el('div', 'clock', card);
  const sky = el('div', 'weather', card);
  const note = el('div', 'climate', card);
  card.addEventListener('click', (e) => {
    if (!showAll) e.stopPropagation();
  });
  return { p, card, day, date, clock, sky, note };
}

function refresh(ref, d) {
  const { p } = ref;
  ref.day.textContent = isDay(p, d) ? '☀ 낮' : '☾ 밤';
  ref.date.textContent = fmt(p.tz, 'date').format(d);
  ref.clock.textContent = fmt(p.tz, 'time').format(d);
  ref.sky.textContent = weatherText(p);
  const s = season(p, d);
  ref.note.textContent = `${s}, ${p.notes[SEASONS.indexOf(s)]}`;
}

function tick() {
  const d = new Date();
  $('seoul').textContent = fmt('Asia/Seoul', 'time').format(d);
  $('seoul-date').textContent = fmt('Asia/Seoul', 'date').format(d);
  for (const ref of cards.values()) refresh(ref, d);
}

function drawPeople() {
  const q = $('search').value.trim().toLowerCase();
  const box = $('people');
  box.replaceChildren();
  for (const p of PEOPLE) {
    if (![p.name, p.city, p.country, p.school].join(' ').toLowerCase().includes(q)) continue;
    const b = el('button', 'person' + (selected === p.id ? ' active' : ''), box);
    b.type = 'button';
    b.style.setProperty('--pin', colorOf(p));
    el('span', 'flag', b, p.flag);
    const name = el('span', '', b);
    el('b', '', name, p.name);
    el('small', '', name, p.city);
    b.addEventListener('click', () => {
      if (showAll) setAll(false);
      select(selected === p.id ? null : p.id);
    });
  }
}

function pathOf(poly) {
  let d = '';
  for (const ring of poly) {
    ring.forEach(([lon, lat], i) => {
      d += `${i ? 'L' : 'M'}${wx(lon).toFixed(1)} ${wy(lat).toFixed(1)} `;
    });
    d += 'Z ';
  }
  return d;
}

async function loadWorld() {
  const land = document.createElementNS(NS, 'g');
  world.insertBefore(land, world.children[1] || null);
  try {
    const res = await fetch('world.geojson', { cache: 'force-cache' });
    const geo = await res.json();
    for (const f of geo.features) {
      const g = f.geometry;
      if (!g) continue;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const poly of polys) {
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('class', 'land');
        path.setAttribute('d', pathOf(poly));
        land.append(path);
      }
    }
  } catch {
    stage.classList.add('no-map');
  }
}

function drawGrid() {
  const grid = document.createElementNS(NS, 'g');
  for (let lon = -150; lon <= 150; lon += 30) {
    const l = document.createElementNS(NS, 'path');
    l.setAttribute('d', `M${wx(lon)} 0V${MAP_H}`);
    l.setAttribute('class', 'grid');
    grid.append(l);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const l = document.createElementNS(NS, 'path');
    l.setAttribute('d', `M0 ${wy(lat)}H${MAP_W}`);
    l.setAttribute('class', 'grid');
    grid.append(l);
  }
  world.append(grid);
}

function drawPins() {
  const layer = document.createElementNS(NS, 'g');
  world.append(layer);
  for (const p of PEOPLE) {
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', wx(p.lon));
    dot.setAttribute('cy', wy(p.lat));
    dot.setAttribute('r', 4.6);
    dot.setAttribute('class', 'pin');
    dot.setAttribute('tabindex', '0');
    dot.setAttribute('role', 'button');
    dot.setAttribute('aria-label', `${p.name}, ${p.city}`);
    dot.style.fill = colorOf(p);
    const title = document.createElementNS(NS, 'title');
    title.textContent = `${p.name}, ${p.city}`;
    dot.append(title);
    const open = (e) => {
      e.stopPropagation();
      if (showAll) return;
      select(selected === p.id ? null : p.id);
    };
    dot.addEventListener('click', open);
    dot.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(e);
      }
    });
    layer.append(dot);
    pins.set(p.id, dot);
    cards.set(p.id, makeCard(p));
  }
}

function select(id) {
  selected = id;
  for (const [pid, ref] of cards) ref.card.classList.toggle('open', pid === id);
  for (const [pid, dot] of pins) {
    dot.classList.toggle('active', pid === id);
    dot.setAttribute('r', pid === id ? 6.4 : 4.6);
  }
  drawPeople();
  requestAnimationFrame(layout);
}

function setAll(on) {
  showAll = on;
  stage.classList.toggle('all', on);
  const btn = $('toggle-all');
  btn.setAttribute('aria-pressed', String(on));
  btn.textContent = on ? '접기' : '모두 펼치기';
  if (on) selected = null;
  for (const dot of pins.values()) {
    dot.classList.remove('active');
    dot.setAttribute('r', 4.6);
  }
  for (const ref of cards.values()) ref.card.classList.remove('open');
  drawPeople();
  requestAnimationFrame(layout);
}

function narrow() {
  return window.matchMedia('(max-width: 720px)').matches;
}

function project(p, box) {
  const scale = Math.min(box.w / MAP_W, box.h / MAP_H);
  return {
    x: box.x + (box.w - MAP_W * scale) / 2 + wx(p.lon) * scale,
    y: box.y + (box.h - MAP_H * scale) / 2 + wy(p.lat) * scale,
  };
}

function line(x1, y1, x2, y2, color) {
  const l = document.createElementNS(NS, 'line');
  l.setAttribute('x1', x2);
  l.setAttribute('y1', y2);
  l.setAttribute('x2', x1);
  l.setAttribute('y2', y1);
  l.setAttribute('marker-end', `url(#${arrow(color)})`);
  l.style.stroke = color;
  lines.append(l);
}

function arrow(color) {
  const id = 'arrow-' + color.slice(1);
  if (!document.getElementById(id)) {
    const m = document.createElementNS(NS, 'marker');
    for (const [k, v] of Object.entries({ id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' })) {
      m.setAttribute(k, v);
    }
    const head = document.createElementNS(NS, 'path');
    head.setAttribute('d', 'M0 0L10 5L0 10z');
    head.setAttribute('fill', color);
    m.append(head);
    leaders.querySelector('defs').append(m);
  }
  return id;
}

function place(card, x, y) {
  card.style.left = Math.round(x) + 'px';
  card.style.top = Math.round(y) + 'px';
}

function matching(cost) {
  const n = cost.length;
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const owner = new Array(n + 1).fill(0);
  const way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    owner[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = owner[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[owner[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (owner[j0] !== 0);
    do {
      const j1 = way[j0];
      owner[j0] = owner[j1];
      j0 = j1;
    } while (j0);
  }
  const pick = new Array(n);
  for (let j = 1; j <= n; j++) pick[owner[j] - 1] = j - 1;
  return pick;
}

function layoutAll() {
  const list = PEOPLE.map((p) => cards.get(p.id));
  if (narrow()) {
    stage.style.height = '';
    map.style.left = map.style.right = '';
    for (const ref of list) ref.card.style.left = ref.card.style.top = '';
    return;
  }
  const h = Math.max(...list.map((r) => r.card.offsetHeight)) + 10;
  const perSide = Math.ceil(list.length / 2);
  const W = stage.clientWidth;
  const H = Math.max(520, perSide * h + 20);
  stage.style.height = H + 'px';
  const side = CARD_W + SIDE_GAP;
  map.style.left = map.style.right = side + 'px';
  const box = { x: side, y: 0, w: W - side * 2, h: H };
  const top = (H - perSide * h) / 2 + 5;
  const slots = [];
  for (let k = 0; k < perSide; k++) {
    slots.push({ x: 8, y: top + k * h, left: true });
    slots.push({ x: W - CARD_W - 8, y: top + k * h, left: false });
  }
  const spots = list.map((ref) => ({ ref, ...project(ref.p, box) }));
  const anchor = (slot) => ({ x: slot.left ? slot.x + CARD_W : slot.x, y: slot.y + h / 2 - 5 });
  const cost = slots.map((slot) => {
    const a = anchor(slot);
    return spots.map((s) => Math.hypot(a.x - s.x, a.y - s.y)).concat(new Array(slots.length - spots.length).fill(0));
  });
  while (cost[0].length < cost.length) cost.forEach((row) => row.push(0));
  const pick = matching(cost);
  slots.forEach((slot, i) => {
    const s = spots[pick[i]];
    if (!s) return;
    place(s.ref.card, slot.x, slot.y);
    const ch = s.ref.card.offsetHeight;
    line(s.x, s.y, slot.left ? slot.x + CARD_W : slot.x, slot.y + ch / 2, colorOf(s.ref.p));
  });
}

function layoutOne() {
  stage.style.height = '';
  map.style.left = map.style.right = '';
  const ref = cards.get(selected);
  if (!ref) return;
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  const { x, y } = project(ref.p, { x: 0, y: 0, w: W, h: H });
  const w = ref.card.offsetWidth;
  const h = ref.card.offsetHeight;
  const gap = 64;
  const pad = 10;
  const tries = [
    { x: x + gap, y: y - h / 2 },
    { x: x - w - gap, y: y - h / 2 },
    { x: x - w / 2, y: y - h - gap },
    { x: x - w / 2, y: y + gap },
  ].map((t) => {
    const cx = Math.max(pad, Math.min(W - w - pad, t.x));
    const cy = Math.max(pad, Math.min(H - h - pad, t.y));
    const covers = x > cx - 12 && x < cx + w + 12 && y > cy - 12 && y < cy + h + 12;
    return { x: cx, y: cy, cost: (covers ? 1e4 : 0) + Math.abs(cx - t.x) + Math.abs(cy - t.y) };
  });
  const best = tries.sort((a, b) => a.cost - b.cost)[0];
  place(ref.card, best.x, best.y);
  const tx = Math.max(best.x, Math.min(best.x + w, x));
  const ty = Math.max(best.y, Math.min(best.y + h, y));
  line(x, y, tx, ty, colorOf(ref.p));
}

function layout() {
  lines.replaceChildren();
  leaders.setAttribute('viewBox', `0 0 ${stage.clientWidth} ${stage.clientHeight}`);
  if (showAll) layoutAll();
  else layoutOne();
  leaders.setAttribute('viewBox', `0 0 ${stage.clientWidth} ${stage.clientHeight}`);
}

async function fetchWeather() {
  const place = (p) => `${p.lat},${p.lon}`;
  const spots = [...new Map(PEOPLE.map((p) => [place(p), p])).values()];
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${spots.map((p) => p.lat).join(',')}&longitude=${spots.map((p) => p.lon).join(',')}`
    + '&current=temperature_2m,weather_code&daily=sunrise,sunset&forecast_days=2&timezone=auto';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const rows = Array.isArray(data) ? data : [data];
    const byPlace = new Map();
    spots.forEach((p, i) => byPlace.set(place(p), rows[i]));
    for (const p of PEOPLE) {
      const j = byPlace.get(place(p));
      if (!j || !j.current) continue;
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: p.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const i = Math.max(0, (j.daily?.time || []).indexOf(today));
      weather.set(p.id, { temp: j.current.temperature_2m, code: j.current.weather_code, rise: j.daily?.sunrise?.[i], set: j.daily?.sunset?.[i] });
    }
  } catch {
    for (const p of PEOPLE) if (!weather.has(p.id)) weather.set(p.id, { error: true });
  } finally {
    clearTimeout(timer);
  }
  tick();
  requestAnimationFrame(layout);
}

drawGrid();
drawPins();
loadWorld();
drawPeople();
tick();
fetchWeather();

$('search').addEventListener('input', drawPeople);
$('toggle-all').addEventListener('click', () => setAll(!showAll));
stage.addEventListener('click', () => {
  if (!showAll && selected) select(null);
});
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(layout, 100);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    tick();
    fetchWeather();
  }
});
setInterval(tick, 1000);
setInterval(fetchWeather, 15 * 60 * 1000);
