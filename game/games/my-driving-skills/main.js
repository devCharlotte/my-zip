import { RacingGame } from "./game.js";
import { HandController } from "./hands.js";

const $ = (id) => document.getElementById(id);

const view = new URLSearchParams(location.search).get("view") || "solo";
const channel = new BroadcastChannel("airwheel-input");

const video = $("video");
const overlay = $("overlay");
const octx = overlay.getContext("2d");
const hands = new HandController(video);

const game = view === "control" ? null : new RacingGame($("game"));
if (game && location.search.includes("debug")) window.__game = game;

let running = false;
let started = false;
let mode = "cam";
let last = performance.now();
let best = Number(localStorage.getItem("airwheel-driving-best") || 0);
$("best").textContent = best;

const wheelSvg = $("wheel");
const pedal = $("pedal");
const camStatus = $("cam-status");

const MAX_KMH = 140;

let remoteInput = { steer: 0, throttle: 0, handsOn: false, brake: false, hands: [] };
let lastRemoteTime = -1e9;
const remoteCam = $("remote-cam");

const SVGNS = "http://www.w3.org/2000/svg";
const sEl = (tag, a) => { const e = document.createElementNS(SVGNS, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
const ptn = (cx, cy, r, deg) => { const t = deg * Math.PI / 180; return [cx + r * Math.sin(t), cy - r * Math.cos(t)]; };
let speedNeedle, tachNeedle, fuelNeedle, tempNeedle, odoText, bestText, arrowL, arrowR;

function buildDefs(svg) {
  const defs = sEl("defs", {});
  const face = sEl("radialGradient", { id: "face", cx: "50%", cy: "42%", r: "62%" });
  [["0%", "#16223e"], ["68%", "#0a1120"], ["100%", "#04060e"]].forEach(([o, c]) => face.appendChild(sEl("stop", { offset: o, "stop-color": c })));
  defs.appendChild(face);
  const bez = sEl("linearGradient", { id: "bezel", x1: "0", y1: "0", x2: "0.3", y2: "1" });
  [["0%", "#b8c2d2"], ["16%", "#4a5468"], ["50%", "#161c2a"], ["84%", "#586278"], ["100%", "#cdd5e2"]].forEach(([o, c]) => bez.appendChild(sEl("stop", { offset: o, "stop-color": c })));
  defs.appendChild(bez);
  for (const [id, dev] of [["tglow", 1.1], ["nglow", 2.4]]) {
    const f = sEl("filter", { id, x: "-60%", y: "-60%", width: "220%", height: "220%" });
    f.appendChild(sEl("feGaussianBlur", { stdDeviation: dev, result: "b" }));
    const m = sEl("feMerge", {}); m.appendChild(sEl("feMergeNode", { in: "b" })); m.appendChild(sEl("feMergeNode", { in: "SourceGraphic" }));
    f.appendChild(m); defs.appendChild(f);
  }
  svg.appendChild(defs);
}

function buildGauge(svg, cx, cy, r, opt) {
  const START = -135, SWEEP = 270;
  svg.appendChild(sEl("circle", { cx, cy, r: r + 9, fill: "none", stroke: "url(#bezel)", "stroke-width": 8 }));
  svg.appendChild(sEl("circle", { cx, cy, r, fill: "url(#face)", stroke: "#0c1424", "stroke-width": 2 }));
  const majors = Math.round(opt.max / opt.step), minorPer = opt.minorPer || 5, total = majors * minorPer;
  for (let i = 0; i <= total; i++) {
    const f = i / total, th = START + f * SWEEP, val = f * opt.max, isMajor = i % minorPer === 0;
    const red = opt.redFrom != null && val >= opt.redFrom - 1e-6;
    const len = isMajor ? 18 : 9;
    const [x1, y1] = ptn(cx, cy, r - 7, th), [x2, y2] = ptn(cx, cy, r - 7 - len, th);
    svg.appendChild(sEl("line", { x1, y1, x2, y2, stroke: red ? "#ff5a2a" : (isMajor ? "#bcd6ff" : "#5d80b8"), "stroke-width": isMajor ? 3.2 : 1.5, "stroke-linecap": "round", filter: isMajor ? "url(#tglow)" : "" }));
    if (isMajor && !opt.noLabels) {
      const [lx, ly] = ptn(cx, cy, r - 42, th);
      const tn = sEl("text", { x: lx, y: ly + 7, "text-anchor": "middle", class: "tick-num" });
      tn.textContent = Math.round(val / (opt.labelDiv || 1));
      if (red) tn.setAttribute("fill", "#ff8a5a");
      svg.appendChild(tn);
    }
  }
  if (opt.cap) { const c = sEl("text", { x: cx, y: cy + r - 28, "text-anchor": "middle", class: "gauge-cap" }); c.textContent = opt.cap; svg.appendChild(c); }
  const nl = sEl("line", { x1: cx, y1: cy + r * 0.2, x2: cx, y2: cy - (r - 15), stroke: "#bfe0ff", "stroke-width": opt.big ? 6 : 3.5, "stroke-linecap": "round", class: "ndl" });
  svg.appendChild(nl);
  svg.appendChild(sEl("circle", { cx, cy, r: opt.big ? 14 : 8, fill: "#0b1322", stroke: "#7fb6ff", "stroke-width": 2.5 }));
  svg.appendChild(sEl("circle", { cx, cy, r: opt.big ? 6 : 3, fill: "#9cc6ff" }));
  nl._cx = cx; nl._cy = cy;
  return nl;
}
const setNeedle = (nl, frac) => { if (nl) nl.setAttribute("transform", `rotate(${-135 + Math.max(0, Math.min(1, frac)) * 270} ${nl._cx} ${nl._cy})`); };

function buildCluster() {
  const svg = $("cluster");
  buildDefs(svg);
  svg.appendChild(sEl("rect", { x: 6, y: 6, width: 988, height: 368, rx: 44, fill: "#06090f", stroke: "#19212f", "stroke-width": 2 }));
  svg.appendChild(sEl("rect", { x: 34, y: 16, width: 932, height: 34, rx: 17, fill: "rgba(255,255,255,0.035)" }));
  speedNeedle = buildGauge(svg, 312, 196, 150, { max: MAX_KMH, step: 50, big: true, cap: "km / h" });
  tachNeedle = buildGauge(svg, 688, 196, 150, { max: 8, step: 1, redFrom: 7, big: true, cap: "RPM x1000" });
  fuelNeedle = buildGauge(svg, 80, 250, 52, { max: 1, step: 0.5, noLabels: true, cap: "GAS" });
  tempNeedle = buildGauge(svg, 920, 250, 52, { max: 1, step: 0.5, noLabels: true, cap: "TEMP" });
  arrowL = sEl("path", { d: "M455 96 L432 116 L455 136 L455 124 L478 124 L478 108 L455 108 Z", fill: "#2f6bff", opacity: "0.15", filter: "url(#nglow)" });
  arrowR = sEl("path", { d: "M545 96 L568 116 L545 136 L545 124 L522 124 L522 108 L545 108 Z", fill: "#2f6bff", opacity: "0.15", filter: "url(#nglow)" });
  svg.appendChild(arrowL); svg.appendChild(arrowR);
  svg.appendChild(sEl("rect", { x: 416, y: 250, width: 168, height: 42, rx: 7, fill: "#0a1322", stroke: "#1d3a66", "stroke-width": 1.5 }));
  const cap = sEl("text", { x: 500, y: 240, "text-anchor": "middle", class: "odo-cap" }); cap.textContent = "DIST  m"; svg.appendChild(cap);
  odoText = sEl("text", { x: 500, y: 281, "text-anchor": "middle", class: "odo-num" }); odoText.textContent = "0"; svg.appendChild(odoText);
  bestText = sEl("text", { x: 500, y: 314, "text-anchor": "middle", class: "odo-cap" }); bestText.textContent = "BEST 0"; svg.appendChild(bestText);
}

function updateDash(t) {
  const sf = t.kmh / MAX_KMH;
  setNeedle(speedNeedle, sf);
  setNeedle(tachNeedle, Math.min(1, sf * 0.6 + (t.brake ? 0 : t.throttle) * 0.42));
  setNeedle(fuelNeedle, t.brake ? 0.08 : t.throttle);
  setNeedle(tempNeedle, Math.min(1, sf * 0.85 + 0.12));
  if (odoText) odoText.textContent = Math.floor(t.dist);
  if (bestText) bestText.textContent = "BEST " + Math.floor(t.best);
}
function setArrows(steer) {
  if (!arrowL) return;
  arrowL.setAttribute("opacity", steer < -0.12 ? "0.95" : "0.13");
  arrowR.setAttribute("opacity", steer > 0.12 ? "0.95" : "0.13");
}

channel.onmessage = (e) => {
  const d = e.data; if (!d) return;
  if (d.type === "input" && view === "game") { remoteInput = d; lastRemoteTime = performance.now(); }
  else if (d.type === "telemetry" && view === "control") updateDash(d);
  else if (d.type === "cam" && view === "game") { remoteCam.src = d.img; }
};

if (game) {
  game.onCrash = (dist) => {
    running = false;
    const result = typeof dist === "object" ? dist : { score: game.getState().score, dist, violations: game.getState().violations, reason: "주행이 종료되었습니다." };
    if (result.score > best) { best = result.score; localStorage.setItem("airwheel-driving-best", best); $("best").textContent = best; }
    $("final-dist").textContent = result.dist;
    $("final-score").textContent = result.score;
    $("final-violations").textContent = result.violations;
    $("final-reason").textContent = result.reason || "주행이 종료되었습니다.";
    $("gameover").classList.remove("hidden");
  };
}

function badge(text, warn) {
  let b = $("mode-badge");
  if (!b) { b = document.createElement("div"); b.id = "mode-badge"; b.className = "mode-badge"; document.body.appendChild(b); }
  b.textContent = text;
  b.classList.toggle("warn", !!warn);
}

if (view === "control") {
  document.body.classList.add("view-control");
  badge("🎮 컨트롤러 — 양손으로 핸들 조작");
  buildCluster();
} else if (view === "game") {
  document.body.classList.add("view-game");
  badge("🖥️ 시뮬레이션 창 — 컨트롤러 창에서 조작", true);
  mode = "remote";
  $("start-screen").classList.add("hidden");
  launch();
}

async function begin() {
  $("start-screen").classList.add("hidden");
  $("loading").classList.remove("hidden");
  try {
    await hands.startCamera();
    overlay.width = video.videoWidth || 640;
    overlay.height = video.videoHeight || 480;
    await hands.init();
  } catch (e) {
    $("loading").classList.add("hidden");
    if (view === "control") {
      alert("카메라/손 인식을 시작할 수 없습니다.\n" + (e?.message || e));
      $("start-screen").classList.remove("hidden");
      return;
    }
    const useKb = confirm(
      "카메라/손 인식을 시작할 수 없습니다.\n" + (e?.message || e) +
      "\n\n[확인]을 누르면 키보드(← → ↑ ↓ / Space)로 플레이합니다.");
    if (useKb) { beginKeyboard(); return; }
    $("start-screen").classList.remove("hidden");
    return;
  }
  $("loading").classList.add("hidden");
  mode = "cam";
  if (view !== "control") $("cam-wrap").classList.remove("hidden");
  launch();
}

function beginKeyboard() {
  mode = "keyboard";
  kb.throttle = 0;
  kb.steer = 0;
  $("start-screen").classList.add("hidden");
  $("loading").classList.add("hidden");
  $("cam-wrap").classList.add("hidden");
  launch();
}

function launch() {
  if (!started) requestAnimationFrame(loop);
  started = true;
  if (game) { game.reset(); running = true; }
  last = performance.now();
}

function restart() {
  $("gameover").classList.add("hidden");
  kb.throttle = 0;
  kb.steer = 0;
  game.reset();
  running = true;
  last = performance.now();
}

const kb = { steer: 0, throttle: 0, active: false };

function stepKeyboard(dt) {
  const left = keys.ArrowLeft || keys.a;
  const right = keys.ArrowRight || keys.d;
  const gas = keys.ArrowUp || keys.w;
  const brake = keys.ArrowDown || keys.s || keys[" "];
  if (left || right || gas || brake) kb.active = true;

  const steerTarget = (right ? 1 : 0) - (left ? 1 : 0);
  const steerRate = steerTarget === 0 ? 5 : 3.2;
  kb.steer += Math.sign(steerTarget - kb.steer) * Math.min(Math.abs(steerTarget - kb.steer), steerRate * dt);

  if (brake) kb.throttle = Math.max(0, kb.throttle - 3 * dt);
  else if (gas) kb.throttle = Math.min(1, kb.throttle + 0.75 * dt);
  else kb.throttle = Math.max(0, kb.throttle - 0.3 * dt);

  return { steer: kb.steer, throttle: kb.throttle, brake: !!brake, handsOn: true, hands: [] };
}

function readInput(now, dt) {
  const keyState = stepKeyboard(dt);
  if (mode === "keyboard") return keyState;

  let s;
  if (view === "game") {
    s = now - lastRemoteTime > 600
      ? { steer: 0, throttle: 0, handsOn: false, brake: false, hands: [] }
      : { ...remoteInput };
  } else {
    s = hands.read(now);
  }
  if (!s.handsOn && kb.active) return keyState;
  return s;
}

function updateHud(input) {
  wheelSvg.style.transform = `rotate(${input.steer * 130}deg)`;
  pedal.classList.remove("gas", "brake");
  if (!input.handsOn) { pedal.textContent = (mode === "cam") ? "✋ 양손 올려주세요" : "COAST"; }
  else if (input.brake) { pedal.textContent = "BRAKE"; pedal.classList.add("brake"); }
  else if (input.throttle > 0.15) { pedal.textContent = "GAS " + Math.round(input.throttle * 100) + "%"; pedal.classList.add("gas"); }
  else { pedal.textContent = "COAST"; }
}

function updatePracticeHud(state) {
  $("score").textContent = state.score;
  $("penalty").textContent = state.violations;
  $("speed-limit").textContent = state.speedLimit;
  $("mission").textContent = state.mission;
  $("feedback").textContent = state.feedback;
  const sig = state.signal || "none";
  for (const name of ["red", "yellow", "green"]) {
    const el = $("hud-" + name);
    if (el) el.classList.toggle("active", sig === name);
  }
}

const streamCanvas = document.createElement("canvas");
streamCanvas.width = 240; streamCanvas.height = 180;
const sctx = streamCanvas.getContext("2d");
let lastStream = 0;
function streamCam(now) {
  if (now - lastStream < 80 || video.readyState < 2) return;
  lastStream = now;
  sctx.setTransform(-1, 0, 0, 1, streamCanvas.width, 0);
  sctx.drawImage(video, 0, 0, streamCanvas.width, streamCanvas.height);
  sctx.drawImage(overlay, 0, 0, streamCanvas.width, streamCanvas.height);
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  channel.postMessage({ type: "cam", img: streamCanvas.toDataURL("image/jpeg", 0.5) });
}

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const input = readInput(now, dt);

  if (view === "control") {
    hands.drawOverlay(octx, overlay.width, overlay.height);
    channel.postMessage({ type: "input", steer: input.steer, throttle: input.throttle, handsOn: input.handsOn, brake: input.brake });
    wheelSvg.style.transform = `rotate(${input.steer * 130}deg)`;
    setArrows(input.steer);
    streamCam(now);
    requestAnimationFrame(loop);
    return;
  }

  if (running) game.update(dt, input);
  else game._render(dt);

  if (view === "solo" && mode === "cam") hands.drawOverlay(octx, overlay.width, overlay.height);

  if (view === "game") {
    channel.postMessage({ type: "telemetry", kmh: game.kmh, dist: game.distance, best, throttle: input.throttle, brake: input.brake, handsOn: input.handsOn });
  }

  const state = game.getState();
  $("speed").textContent = state.kmh;
  $("speed").classList.toggle("over", state.overLimit);
  $("dist").textContent = Math.floor(state.dist);
  updatePracticeHud(state);
  updateHud(input);

  if (view === "solo" && mode === "cam") {
    camStatus.textContent = input.handsOn
      ? `🖐️🖐️ 인식됨 · 조향 ${(input.steer * 100).toFixed(0)}%`
      : (input.hands?.length === 1 ? "✋ 한 손 더 들어주세요" : "손을 화면에 보여주세요");
  }

  requestAnimationFrame(loop);
}

$("start-btn").addEventListener("click", begin);
$("keyboard-btn").addEventListener("click", beginKeyboard);
$("restart-btn").addEventListener("click", () => (game ? restart() : null));
$("twowin-btn").addEventListener("click", () => {
  window.open(location.pathname + "?view=control", "airwheel-control", "width=1280,height=1180,menubar=no,toolbar=no");
  location.href = location.pathname + "?view=game";
});

const keys = {};
const ARROWS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "];
const keyName = (e) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
addEventListener("keydown", (e) => { keys[keyName(e)] = true; if (ARROWS.includes(e.key)) e.preventDefault(); });
addEventListener("keyup", (e) => { keys[keyName(e)] = false; });
addEventListener("blur", () => { for (const k in keys) keys[k] = false; });


document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    last = performance.now();
    hands.resetTiming?.();
  }
});
addEventListener("focus", () => { last = performance.now(); hands.resetTiming?.(); });
