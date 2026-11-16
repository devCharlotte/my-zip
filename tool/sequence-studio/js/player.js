import { figureSVG } from "./figure.js";
import { itemSeconds, PHASES, TOOLS, TRANSITION_SECONDS, clock, escapeHTML, formatMinutes } from "./poses.js";
import { buildScript, sentences } from "./guide.js";
import { clipFor, hasClips, loadClips, preload, takeClip } from "./voice.js";

const $ = (id) => document.getElementById(id);
const READY_SECONDS = 8;
const hasSpeech = "speechSynthesis" in window;
const SENTENCE_GAP = 220;

const EFFECTS = {
  bell: { type: "sine", freq: 880, decay: 0.9 },
  wood: { type: "triangle", freq: 620, decay: 0.09 },
  soft: { type: "sine", freq: 520, decay: 0.28 },
};

let dialog;
let prefs;
let savePrefs;
let segments = [];
let index = 0;
let left = 0;
let script = [];
let fired = 0;
let timer = null;
let paused = false;
let audio = null;
let wakeLock = null;
let itemCount = 0;
let totalSec = 0;
let queue = [];
let current = null;
let gapTimer = 0;

export function initPlayer(userPrefs, save) {
  dialog = $("player");
  prefs = userPrefs;
  savePrefs = (patch) => save(Object.assign(prefs, patch));

  $("voiceToggle").checked = prefs.voice;
  $("recordedToggle").checked = prefs.recorded;
  $("largeToggle").checked = prefs.large;
  $("rateRange").value = prefs.rate;
  $("rateValue").textContent = `${prefs.rate}배`;
  $("effectSelect").value = prefs.effect;
  dialog.querySelector(`[name=detail][value=${prefs.detail}]`).checked = true;
  dialog.classList.toggle("is-large", prefs.large);
  fillVoices();
  loadClips().then(fillVoices);
  if (hasSpeech) speechSynthesis.addEventListener("voiceschanged", fillVoices);

  $("voiceToggle").addEventListener("change", (e) => {
    savePrefs({ voice: e.target.checked });
    fillVoices();
    if (!prefs.voice) hush();
  });
  $("largeToggle").addEventListener("change", (e) => {
    savePrefs({ large: e.target.checked });
    dialog.classList.toggle("is-large", prefs.large);
  });
  $("recordedToggle").addEventListener("change", (e) => {
    savePrefs({ recorded: e.target.checked });
    fillVoices();
  });
  $("voiceSelect").addEventListener("change", (e) => savePrefs({ voiceName: e.target.value }));
  $("rateRange").addEventListener("input", (e) => {
    savePrefs({ rate: Number(e.target.value) });
    if (current?.clip) current.clip.playbackRate = prefs.rate;
    $("rateValue").textContent = `${prefs.rate}배`;
  });
  $("effectSelect").addEventListener("change", (e) => {
    savePrefs({ effect: e.target.value });
    sound("start");
  });
  $("guideSettings").addEventListener("change", (e) => {
    if (e.target.name !== "detail") return;
    savePrefs({ detail: e.target.value });
    if (segments[index]) loadScript();
  });
  $("guideBtn").addEventListener("click", () => {
    const open = $("guideSettings").hidden;
    $("guideSettings").hidden = !open;
    $("guideBtn").setAttribute("aria-expanded", String(open));
  });

  $("playerClose").addEventListener("click", () => dialog.close());
  $("playerToggle").addEventListener("click", togglePause);
  $("playerPrev").addEventListener("click", () => jump(-1));
  $("playerSkip").addEventListener("click", () => jump(1));
  $("playerRestart").addEventListener("click", () => start(0));
  $("playerAgain").addEventListener("click", () => start(0));
  $("playerDoneClose").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", stop);
  dialog.addEventListener("keydown", (e) => {
    if (e.target.closest("input, button, select")) return;
    if (e.key === " ") {
      e.preventDefault();
      togglePause();
    } else if (e.key === "ArrowRight") jump(1);
    else if (e.key === "ArrowLeft") jump(-1);
  });
  document.addEventListener("visibilitychange", () => {
    if (dialog.open && document.visibilityState === "visible") keepAwake();
  });
}

function voiceRank(v) {
  if (/natural|online/i.test(v.name)) return 0;
  if (/google/i.test(v.name)) return 1;
  if (/premium|enhanced|neural/i.test(v.name)) return 2;
  return v.localService === false ? 3 : 4;
}

function koVoices() {
  if (!hasSpeech) return [];
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith("ko"))
    .sort((a, b) => voiceRank(a) - voiceRank(b));
}

function pickVoice(voices = koVoices()) {
  return voices.find((v) => v.name === prefs.voiceName) || voices[0];
}

function voiceLabel(v) {
  return v.name.replace(/\s*-\s*Korean.*$/i, "").replace(/^Microsoft\s+/, "");
}

function fillVoices() {
  const voices = koVoices();
  const chosen = voices.some((v) => v.name === prefs.voiceName) ? prefs.voiceName : "";
  $("voiceSelect").innerHTML = voices.length
    ? `<option value=""${chosen ? "" : " selected"}>자동: ${escapeHTML(voiceLabel(voices[0]))}</option>` +
      voices.map((v) => `<option value="${escapeHTML(v.name)}"${v.name === chosen ? " selected" : ""}>${escapeHTML(voiceLabel(v))}</option>`).join("")
    : "<option value=\"\">한국어 음성 없음</option>";
  $("voiceSelect").disabled = !voices.length;
  $("voiceToggle").disabled = !canTalk();
  $("recordedToggle").disabled = !hasClips();
  $("voiceNotice").hidden = canTalk();
  $("voiceNotice").textContent = hasSpeech
    ? "이 기기에는 한국어 음성이 없어 화면 자막으로 안내합니다."
    : "이 브라우저는 음성 안내를 지원하지 않아 화면 자막으로 안내합니다.";
  dialog.classList.toggle("caption-only", !canTalk() || !prefs.voice);
}

function canTalk() {
  return koVoices().length > 0 || (prefs.recorded && hasClips());
}

function buildSegments(items, byId) {
  const list = [];
  items.forEach((item, order) => {
    const pose = byId.get(item.id);
    if (!pose) return;
    const base = { pose, item, order, kind: "work", side: "" };
    list.push(list.length ? { ...base, kind: "move", seconds: TRANSITION_SECONDS } : { ...base, kind: "ready", seconds: READY_SECONDS });
    const sec = itemSeconds(item, pose);
    if (pose.dose?.sides) {
      list.push({ ...base, side: "오른쪽", seconds: Math.round(sec / 2) });
      list.push({ ...base, side: "왼쪽", seconds: Math.round(sec / 2), second: true });
    } else {
      list.push({ ...base, seconds: sec });
    }
  });
  return list;
}

export function playSequence(seq, byId) {
  segments = buildSegments(seq.items, byId);
  if (!segments.length) return;
  itemCount = seq.items.length;
  totalSec = segments.reduce((s, seg) => s + (seg.kind === "ready" ? 0 : seg.seconds), 0);
  $("playerTitle").textContent = seq.title || "이름 없는 시퀀스";
  if (!audio && (window.AudioContext || window.webkitAudioContext)) {
    audio = new (window.AudioContext || window.webkitAudioContext)();
  }
  fillVoices();
  dialog.showModal();
  start(0);
  keepAwake();
}

function keepAwake() {
  navigator.wakeLock?.request("screen").then((lock) => (wakeLock = lock)).catch(() => {});
}

function start(i) {
  dialog.classList.remove("is-done");
  setPaused(false);
  go(i);
  clearInterval(timer);
  timer = setInterval(tick, 1000);
  $("playerToggle").focus();
}

function stop() {
  clearInterval(timer);
  timer = null;
  hush();
  wakeLock?.release();
  wakeLock = null;
}

function go(i, flowing) {
  index = i;
  left = segments[i].seconds;
  if (flowing) settle();
  else hush();
  render();
  loadScript();
  if (segments[i].kind === "work") sound("start");
  fire();
}

function loadScript() {
  script = buildScript(segments[index], prefs.detail);
  const elapsed = segments[index].seconds - left;
  fired = script.filter((line) => line.at < elapsed).length;
}

function fire() {
  const elapsed = segments[index].seconds - left;
  while (fired < script.length && script[fired].at <= elapsed) {
    const line = script[fired++];
    if (line.kind === "talk") say(line.text);
    else sound("tick");
    if (line.kind === "count" || line.kind === "final") say(line.text, line.kind);
    if (line.text) caption(line.text, line.kind !== "talk");
  }
  warm(script[fired]?.text);
}

function warm(text) {
  if (prefs.voice && prefs.recorded && text) sentences(text).slice(0, 2).forEach(preload);
}

function tick() {
  if (paused) return;
  left -= 1;
  if (left <= 0) {
    if (index + 1 >= segments.length) return finish();
    go(index + 1, true);
    return;
  }
  if (left === 2 && segments[index + 1]) warm(buildScript(segments[index + 1], prefs.detail)[0]?.text);
  fire();
  renderTime();
}

function jump(dir) {
  if (dialog.classList.contains("is-done")) return;
  let i = index + dir;
  if (dir < 0 && segments[index].seconds - left > 3) i = index;
  go(Math.max(0, Math.min(segments.length - 1, i)));
}

function setPaused(value) {
  paused = value;
  $("playerToggle").textContent = paused ? "계속" : "일시정지";
  $("playerToggle").setAttribute("aria-pressed", String(paused));
  dialog.classList.toggle("is-paused", paused);
}

function togglePause() {
  if (dialog.classList.contains("is-done")) return;
  setPaused(!paused);
  if (paused) {
    hush();
    caption("일시정지했습니다. 계속을 누르면 남은 시간부터 이어갑니다.");
  }
}

function finish() {
  clearInterval(timer);
  timer = null;
  left = 0;
  dialog.classList.add("is-done");
  $("playerDoneText").textContent = `${itemCount}개 자세, 약 ${formatMinutes(totalSec)}. 수고하셨습니다.`;
  $("playerBar").style.width = "100%";
  sound("end");
  hush();
  say("오늘 수업은 여기까지예요. 수고 많으셨어요.");
  $("playerAgain").focus();
}

function caption(text, count) {
  const el = $("playerCaption");
  el.textContent = text;
  el.classList.toggle("is-count", Boolean(count));
}

function render() {
  const seg = segments[index];
  const { pose, item } = seg;
  const moving = seg.kind !== "work";
  dialog.classList.toggle("is-moving", moving);
  $("playerFigure").innerHTML = figureSVG(pose.figure, { size: 320 });
  $("playerStep").textContent = `${seg.order + 1} / ${itemCount}`;
  $("playerPhase").textContent = PHASES[item.phase] || "";
  $("playerPhase").dataset.phase = item.phase || "";

  let sideText = "";
  if (seg.kind === "ready") sideText = "곧 시작합니다";
  else if (moving) sideText = "다음 자세 준비";
  else if (seg.second) sideText = `반대쪽 · ${seg.side}`;
  else if (seg.side) sideText = `${seg.side} 먼저`;
  $("playerSide").textContent = sideText;
  $("playerName").textContent = pose.name;
  $("playerEn").textContent = pose.en || "";
  $("playerTool").textContent = TOOLS[pose.tool] || "";
  $("playerTool").className = `tag tool tool-${pose.tool}`;

  const reps = pose.dose?.type === "reps";
  const amount = reps ? `${item.dur}회` : `${item.dur}초`;
  $("playerDose").textContent = moving
    ? `${amount}${pose.dose?.sides ? " × 양쪽" : ""}`
    : `${seg.side ? `${seg.side} ` : ""}${amount}${reps ? "" : " 유지"}`;

  const cues = [];
  if (moving && item.cue) cues.push(item.cue);
  if (seg.second) cues.push("반대쪽으로 바꿔 같은 방식으로 진행합니다.");
  cues.push(...(pose.cues || []).slice(0, 2));
  $("playerCues").innerHTML = cues.slice(0, 3).map((c) => `<li>${escapeHTML(c)}</li>`).join("");
  caption(moving ? `다음은 ${pose.name}입니다.` : pose.name);

  const next = segments.slice(index + 1).find((s) => s.kind === "work" && (s.order !== seg.order || s.second));
  $("playerNext").innerHTML = next
    ? `<span class="label">다음</span>${figureSVG(next.pose.figure, { size: 56 })}<span><strong>${escapeHTML(next.pose.name)}</strong>${next.side ? ` <em>${next.side}</em>` : ""}<small class="next-tool">${TOOLS[next.pose.tool] || ""}</small></span>`
    : `<span class="label">다음</span><span>마지막 자세입니다</span>`;
  renderTime();
}

function renderTime() {
  const seg = segments[index];
  $("playerTime").textContent = clock(left);
  $("playerSegBar").style.width = `${((seg.seconds - left) / seg.seconds) * 100}%`;
  const before = segments.slice(0, index).reduce((s, x) => s + (x.kind === "ready" ? 0 : x.seconds), 0);
  const done = before + (seg.kind === "ready" ? 0 : seg.seconds - left);
  $("playerBar").style.width = `${(done / totalSec) * 100}%`;
  $("playerRemain").textContent = `남은 시간 ${clock(totalSec - done)}`;
}

function busy() {
  return Boolean(current || gapTimer || queue.length);
}

function say(text, mode) {
  if (!text || !prefs.voice || !canTalk()) return;
  if (stale()) release();
  if (mode === "count" && busy()) return;
  if (mode === "final") hush();
  queue.push(sentences(text));
  if (queue.length > 2) queue.splice(0, queue.length - 2);
  speakNext();
}

function stale() {
  if (!current) return false;
  if (current.clip) return Date.now() > current.until;
  return !speechSynthesis.speaking && !speechSynthesis.pending && Date.now() - current.startedAt > 1500;
}

function speakNext() {
  if (current || gapTimer) return;
  while (queue.length && !queue[0].length) queue.shift();
  if (!queue.length) return;
  const text = queue[0].shift();
  const clip = prefs.recorded && clipFor(text);
  if (clip) playClip(text, clip);
  else speak(text);
  const next = queue[0]?.[0] ?? queue[1]?.[0];
  if (prefs.recorded && next) preload(next);
}

function finished(item) {
  if (current !== item) return;
  current = null;
  while (queue.length && !queue[0].length) queue.shift();
  if (!queue.length) return;
  gapTimer = setTimeout(() => {
    gapTimer = 0;
    speakNext();
  }, SENTENCE_GAP);
}

function speak(text) {
  if (!koVoices().length) return speakNext();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = pickVoice() || null;
  u.lang = u.voice?.lang || "ko-KR";
  u.rate = prefs.rate;
  u.pitch = 1;
  u.onend = u.onerror = () => finished(u);
  current = u;
  u.startedAt = Date.now();
  speechSynthesis.speak(u);
}

function playClip(text, { src, seconds }) {
  const clip = takeClip(src);
  const item = { clip, until: Date.now() + (seconds / prefs.rate) * 1000 + 3000 };
  const fallback = () => {
    if (current !== item) return;
    release();
    speak(text);
  };
  clip.playbackRate = prefs.rate;
  clip.onended = () => finished(item);
  clip.onerror = fallback;
  current = item;
  clip.play().catch(fallback);
}

function settle() {
  queue = [];
  clearTimeout(gapTimer);
  gapTimer = 0;
}

function release() {
  if (current?.clip) {
    current.clip.onended = current.clip.onerror = null;
    current.clip.pause();
  }
  current = null;
}

function hush() {
  settle();
  release();
  if (hasSpeech) speechSynthesis.cancel();
}

function tone(freq, length, type, volume, delay = 0) {
  const t = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + length + 0.05);
}

function sound(kind) {
  const fx = EFFECTS[prefs.effect];
  if (!fx || !audio) return;
  if (audio.state === "suspended") audio.resume();
  if (kind === "tick") tone(fx.freq * 1.5, Math.max(0.06, fx.decay * 0.35), fx.type, 0.1);
  else if (kind === "start") tone(fx.freq, fx.decay, fx.type, 0.18);
  else [1, 1.25, 1.5].forEach((m, i) => tone(fx.freq * m * 0.75, fx.decay * 1.4, fx.type, 0.18, i * 0.22));
}
