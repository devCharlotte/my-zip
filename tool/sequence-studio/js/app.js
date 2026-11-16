import { figureSVG } from "./figure.js";
import {
  loadLibrary, DISCIPLINES, TOOLS, TOOL_GROUPS, TOOL_NOTES, POSITIONS, BODY, LEVELS, FOCUS, PHASES,
  itemSeconds, totalSeconds, doseText, formatMinutes, clock, escapeHTML, TRANSITION_SECONDS, ROLES, CONCERN_GROUPS,
} from "./poses.js";
import { store } from "./store.js";
import { generate, alternatives, FOCUS_AREAS } from "./generator.js";
import { initPlayer, playSequence } from "./player.js";
import { renderStory } from "./story.js";

const $ = (id) => document.getElementById(id);
const esc = escapeHTML;
const PAGE = 36;

const state = {
  poses: [],
  byId: new Map(),
  sequences: [],
  concerns: [],
  concernId: null,
  templateKind: "all",
  filter: {
    q: "",
    discipline: "all",
    tools: new Set(),
    positions: new Set(),
    body: new Set(),
    levels: new Set(),
    focus: new Set(),
    favOnly: false,
  },
  limit: PAGE,
  favorites: store.favorites(),
  seq: store.draft(),
  saved: store.saved(),
  generated: null,
  lastPlayed: null,
  storyFiles: [],
  genAreas: new Set(),
  genTools: new Set(["mat"]),
  genConcerns: new Set(),
};

let uidSeed = 0;
const newUid = () => `${Date.now().toString(36)}-${uidSeed++}`;
const searchIndex = new Map();

function searchText(pose) {
  if (!searchIndex.has(pose.id)) {
    const parts = [pose.name, pose.en, pose.sa, ...(pose.muscles?.primary || []), ...(pose.muscles?.secondary || [])];
    searchIndex.set(pose.id, parts.filter(Boolean).join(" ").toLowerCase().replace(/\s+/g, ""));
  }
  return searchIndex.get(pose.id);
}

function matches(pose) {
  const f = state.filter;
  if (f.discipline !== "all" && pose.discipline !== f.discipline) return false;
  if (f.tools.size && !f.tools.has(pose.tool)) return false;
  if (f.positions.size && !f.positions.has(pose.position)) return false;
  if (f.body.size && !pose.body?.some((b) => f.body.has(b))) return false;
  if (f.levels.size && !f.levels.has(String(pose.level))) return false;
  if (f.focus.size && !f.focus.has(pose.focus)) return false;
  if (f.favOnly && !state.favorites.has(pose.id)) return false;
  if (f.q && !searchText(pose).includes(f.q)) return false;
  return true;
}

function josa(word, withFinal, withoutFinal) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return withoutFinal;
  const final = code % 28;
  if (withFinal === "으로" && final === 8) return withoutFinal;
  return final ? withFinal : withoutFinal;
}

function toast(message, undo) {
  const el = $("toast");
  el.innerHTML = `<span>${esc(message)}</span>${undo ? '<button type="button">되돌리기</button>' : ""}`;
  el.classList.add("show");
  if (undo) {
    el.querySelector("button").addEventListener("click", () => {
      undo();
      el.classList.remove("show");
    });
  }
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), undo ? 5000 : 2200);
}

function chips(container, entries, isOn, onToggle) {
  container.innerHTML = entries
    .map(([value, label]) => `<button type="button" class="chip" data-value="${value}" aria-pressed="${isOn(value)}">${esc(label)}</button>`)
    .join("");
  container.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-value]");
    if (!btn) return;
    onToggle(btn.dataset.value);
    btn.setAttribute("aria-pressed", String(isOn(btn.dataset.value)));
  });
}

function toggleIn(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

function toolTag(tool) {
  return `<span class="tag tool tool-${tool}" title="${esc(TOOL_NOTES[tool] || "")}">${esc(TOOLS[tool] || tool)}</span>`;
}

function toolChips(container, set, onChange) {
  container.classList.add("tool-groups");
  container.innerHTML = TOOL_GROUPS.map(([label, tools]) => `<div class="tool-group">
      <span class="tool-group-label">${label}</span>
      ${tools.map((t) => `<button type="button" class="chip tool-chip tool-${t}" data-value="${t}" aria-pressed="${set.has(t)}" title="${esc(TOOL_NOTES[t])}">${esc(TOOLS[t])}</button>`).join("")}
    </div>`).join("");
  container.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-value]");
    if (!btn) return;
    toggleIn(set, btn.dataset.value);
    btn.setAttribute("aria-pressed", String(set.has(btn.dataset.value)));
    onChange();
  });
  container.insertAdjacentHTML("afterend", `<p class="tool-legend">${["ring", "circle"]
    .map((t) => `<span><i class="dot tool-${t}"></i><b>${TOOLS[t]}</b> ${TOOL_NOTES[t]}</span>`).join("")}</p>`);
}

function tagsFor(pose) {
  return `<span class="tag disc-${pose.discipline}">${DISCIPLINES[pose.discipline] || ""}</span>`
    + toolTag(pose.tool)
    + `<span class="tag level level-${pose.level}">${LEVELS[pose.level] || ""}</span>`;
}

function renderLibrary() {
  const list = state.poses.filter(matches);
  const shown = list.slice(0, state.limit);
  $("poseGrid").innerHTML = shown.map(cardHTML).join("");
  $("resultCount").innerHTML = `<strong>${list.length}</strong>개 자세`;
  $("libraryEmpty").hidden = list.length > 0 || !state.poses.length;
  $("moreBtn").hidden = list.length <= state.limit;
  $("moreBtn").textContent = `더 보기 (${list.length - shown.length})`;

  const f = state.filter;
  const extra = f.positions.size + f.body.size + f.levels.size + f.focus.size;
  $("filterCount").textContent = extra ? extra : "";
}

const cardFigures = new Map();

function cardFigure(pose) {
  if (!cardFigures.has(pose.id)) cardFigures.set(pose.id, figureSVG(pose.figure, { size: 120 }));
  return cardFigures.get(pose.id);
}

function cardHTML(pose) {
  const fav = state.favorites.has(pose.id);
  const body = (pose.body || []).slice(0, 3).map((b) => BODY[b]).filter(Boolean).join(" · ");
  return `<article class="pose-card disc-${pose.discipline}" data-id="${pose.id}">
    <button type="button" class="card-main" data-open="${pose.id}">
      <span class="card-figure">${cardFigure(pose)}</span>
      <span class="card-text">
        <span class="card-name">${esc(pose.name)}</span>
        <span class="card-en">${esc(pose.en || "")}</span>
      </span>
    </button>
    <div class="card-meta">
      <div class="card-tags">${tagsFor(pose)}</div>
      <p class="card-body">${esc(body)}</p>
    </div>
    <div class="card-actions">
      <button type="button" class="icon-btn fav" data-fav="${pose.id}" aria-pressed="${fav}" aria-label="${esc(pose.name)} 즐겨찾기">${fav ? "★" : "☆"}</button>
      <button type="button" class="icon-btn add" data-add="${pose.id}" aria-label="${esc(pose.name)} 시퀀스에 추가">+</button>
    </div>
  </article>`;
}

function setupLibrary() {
  const f = state.filter;
  let searchTimer;
  $("search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      f.q = e.target.value.trim().toLowerCase().replace(/\s+/g, "");
      state.limit = PAGE;
      renderLibrary();
    }, 120);
  });

  $("disciplineFilter").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    f.discipline = btn.dataset.value;
    $("disciplineFilter").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    state.limit = PAGE;
    renderLibrary();
  });

  const bind = (id, entries, set) => chips($(id), entries, (v) => set.has(v), (v) => {
    toggleIn(set, v);
    state.limit = PAGE;
    renderLibrary();
  });
  toolChips($("toolFilter"), f.tools, () => {
    state.limit = PAGE;
    renderLibrary();
  });
  bind("positionFilter", Object.entries(POSITIONS), f.positions);
  bind("bodyFilter", Object.entries(BODY), f.body);
  bind("levelFilter", Object.entries(LEVELS), f.levels);
  bind("focusFilter", Object.entries(FOCUS), f.focus);

  $("favOnly").addEventListener("click", (e) => {
    f.favOnly = !f.favOnly;
    e.currentTarget.setAttribute("aria-pressed", String(f.favOnly));
    renderLibrary();
  });

  const reset = () => {
    Object.assign(f, { q: "", discipline: "all", favOnly: false });
    [f.tools, f.positions, f.body, f.levels, f.focus].forEach((s) => s.clear());
    $("search").value = "";
    document.querySelectorAll(".filters [aria-pressed]").forEach((b) => b.setAttribute("aria-pressed", "false"));
    $("disciplineFilter").querySelector('[data-value="all"]').setAttribute("aria-pressed", "true");
    state.limit = PAGE;
    renderLibrary();
  };
  $("resetFilters").addEventListener("click", reset);
  $("emptyReset").addEventListener("click", reset);

  $("moreBtn").addEventListener("click", () => {
    state.limit += PAGE;
    renderLibrary();
  });

  $("poseGrid").addEventListener("click", cardClick);
}

function cardClick(e) {
  const open = e.target.closest("[data-open]");
  const fav = e.target.closest("[data-fav]");
  const add = e.target.closest("[data-add]");
  if (open) openDetail(open.dataset.open);
  else if (fav) toggleFavorite(fav.dataset.fav);
  else if (add) addPose(add.dataset.add);
}

function concernPoses(concern) {
  return Object.keys(ROLES).map((role) => [
    role,
    (concern.roles[role] || []).map((id) => state.byId.get(id)).filter(Boolean),
  ]);
}

function renderConcerns() {
  const has = state.concerns.length > 0;
  $("tab-concern").hidden = !has;
  $("genConcernField").hidden = !has;
  if (!has) return;

  if (!state.concerns.some((c) => c.id === state.concernId)) state.concernId = state.concerns[0].id;
  const groups = [...CONCERN_GROUPS, ...new Set(state.concerns.map((c) => c.group))]
    .filter((g, i, arr) => arr.indexOf(g) === i && state.concerns.some((c) => c.group === g));
  const loose = state.concerns.filter((c) => !c.group);
  const row = (list) => list
    .map((c) => `<button type="button" class="chip concern-chip" data-concern="${esc(c.id)}" aria-pressed="${c.id === state.concernId}">${esc(c.name)}</button>`)
    .join("");
  $("concernGroups").innerHTML = groups
    .map((g) => `<div class="concern-group"><h3>${esc(g)}</h3><div class="chip-row">${row(state.concerns.filter((c) => c.group === g))}</div></div>`)
    .join("") + (loose.length ? `<div class="concern-group"><div class="chip-row">${row(loose)}</div></div>` : "");

  chips($("genConcerns"), state.concerns.map((c) => [c.id, c.name]), (v) => state.genConcerns.has(v), (v) => toggleIn(state.genConcerns, v));
  renderConcernDetail();
}

function renderConcernDetail() {
  const concern = state.concerns.find((c) => c.id === state.concernId);
  if (!concern) return;
  const blocks = concernPoses(concern).filter(([, poses]) => poses.length);
  const steps = blocks.map(([role, poses], i) => `<section class="role-block role-${role}">
      <h3><span class="role-no">${i + 1}</span>${ROLES[role].label}<small>${ROLES[role].en}</small><span class="role-count">${poses.length}</span></h3>
      <div class="pose-grid">${poses.map(cardHTML).join("")}</div>
    </section>`).join("");
  $("concernDetail").innerHTML = `<article class="panel concern-head">
      <div class="concern-title">
        <p class="eyebrow">${esc(concern.group || "")}</p>
        <h2>${esc(concern.name)}</h2>
        <p class="concern-summary">${esc(concern.summary || "")}</p>
        <ol class="role-path">${blocks.map(([role]) => `<li class="role-${role}">${ROLES[role].label}</li>`).join("")}</ol>
      </div>
      <div class="concern-cols">
        ${concern.approach?.length ? `<div class="concern-approach"><h3>접근 원칙</h3><ol>${concern.approach.map((a) => `<li>${esc(a)}</li>`).join("")}</ol></div>` : ""}
        ${concern.caution ? `<div class="concern-caution"><h3>주의</h3><p>${esc(concern.caution)}</p></div>` : ""}
      </div>
      ${blocks.length ? '<button type="button" class="btn primary" data-concern-add>이 순서대로 시퀀스에 담기</button>' : ""}
    </article>
    ${steps || '<p class="muted empty-line">이 고민에 연결된 자세를 아직 불러오지 못했습니다.</p>'}`;
}

function setupConcerns() {
  $("concernGroups").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-concern]");
    if (!btn) return;
    state.concernId = btn.dataset.concern;
    $("concernGroups").querySelectorAll("[data-concern]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    renderConcernDetail();
  });
  $("concernDetail").addEventListener("click", (e) => {
    if (!e.target.closest("[data-concern-add]")) return cardClick(e);
    const concern = state.concerns.find((c) => c.id === state.concernId);
    const added = concernPoses(concern).flatMap(([role, poses]) => poses.map((pose) => ({
      uid: newUid(), id: pose.id, dur: pose.dose.value, phase: ROLES[role].phase, cue: "",
    })));
    const next = { ...state.seq, items: [...state.seq.items, ...added] };
    if (!state.seq.items.length && !state.seq.title) next.title = `${concern.name} 케어`;
    replaceSeq(next, `${concern.name} 자세 ${added.length}개를 추가했습니다`);
  });
}

function toggleFavorite(id) {
  toggleIn(state.favorites, id);
  store.saveFavorites(state.favorites);
  const on = state.favorites.has(id);
  document.querySelectorAll(`[data-fav="${id}"]`).forEach((b) => {
    b.setAttribute("aria-pressed", String(on));
    b.textContent = b.classList.contains("wide") ? (on ? "★ 즐겨찾기됨" : "☆ 즐겨찾기") : on ? "★" : "☆";
  });
  if (state.filter.favOnly) renderLibrary();
}

function bullets(items) {
  return `<ul>${(items || []).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
}

function openDetail(id) {
  const pose = state.byId.get(id);
  if (!pose) return;
  const fav = state.favorites.has(id);
  const bodyTags = (pose.body || []).map((b) => `<span class="tag soft">${BODY[b] || b}</span>`).join("");
  const muscles = (names) => (names || []).map((m) => `<span class="tag soft">${esc(m)}</span>`).join("") || "<span class=\"muted\">-</span>";
  $("poseDetail").innerHTML = `
    <button type="button" class="icon-btn dialog-close" data-close aria-label="닫기">✕</button>
    <div class="detail-head">
      <div class="detail-figure disc-${pose.discipline}">${figureSVG(pose.figure, { size: 280 })}</div>
      <div class="detail-title">
        <div class="card-tags">${tagsFor(pose)}<span class="tag">${POSITIONS[pose.position] || ""}</span><span class="tag">${FOCUS[pose.focus] || ""}</span></div>
        <h2 id="dName">${esc(pose.name)}</h2>
        <p class="detail-en">${esc(pose.en || "")}${pose.sa ? `, ${esc(pose.sa)}` : ""}</p>
        <p class="detail-tool">${esc(TOOL_NOTES[pose.tool] || "")}</p>
        <div class="tag-line">${bodyTags}</div>
        <p class="detail-dose"><span>권장</span> ${esc(doseText(pose))}</p>
        <div class="detail-actions">
          <button type="button" class="btn primary" data-add-detail="${pose.id}">시퀀스에 추가</button>
          <button type="button" class="btn ghost wide" data-fav="${pose.id}" aria-pressed="${fav}">${fav ? "★ 즐겨찾기됨" : "☆ 즐겨찾기"}</button>
        </div>
      </div>
    </div>
    <div class="detail-grid">
      <section class="d-setup"><h3>시작 자세</h3><p>${esc(pose.setup)}</p></section>
      <section class="d-breath"><h3>호흡</h3><p>${esc(pose.breath)}</p></section>
      <section class="d-steps"><h3>동작 순서</h3><ol>${(pose.steps || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol></section>
      <section class="d-cues"><h3>강사 큐잉</h3>${bullets(pose.cues)}</section>
      <section><h3>정렬 포인트</h3>${bullets(pose.alignment)}</section>
      <section><h3>흔한 실수</h3>${bullets(pose.mistakes)}</section>
      <section class="d-variants">
        <div><h3>쉬운 변형</h3><p>${esc(pose.easier)}</p></div>
        <div><h3>어려운 변형</h3><p>${esc(pose.harder)}</p></div>
      </section>
      ${pose.caution ? `<section class="d-caution"><h3>주의</h3><p>${esc(pose.caution)}</p></section>` : ""}
      <section class="d-muscles">
        <h3>근육</h3>
        <p><span class="m-label">주동근</span>${muscles(pose.muscles?.primary)}</p>
        <p><span class="m-label">협력근</span>${muscles(pose.muscles?.secondary)}</p>
      </section>
    </div>`;
  const dialog = $("poseDialog");
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  $("poseDetail").scrollTop = 0;
}

function setupDetail() {
  const dialog = $("poseDialog");
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog || e.target.closest("[data-close]")) dialog.close();
    const add = e.target.closest("[data-add-detail]");
    const fav = e.target.closest("[data-fav]");
    if (add) addPose(add.dataset.addDetail);
    if (fav) toggleFavorite(fav.dataset.fav);
  });
}

function defaultPhase(pose) {
  if (pose.body?.includes("relax") && ["release", "breath"].includes(pose.focus)) return "rest";
  if (pose.focus === "release") return "cooldown";
  return "main";
}

function addPose(id) {
  const pose = state.byId.get(id);
  if (!pose) return;
  state.seq.items.push({ uid: newUid(), id, dur: pose.dose?.value || 30, phase: defaultPhase(pose), cue: "" });
  saveDraft();
  renderBuilder();
  toast(`${pose.name}${josa(pose.name, "을", "를")} ${state.seq.items.length}번째로 추가했습니다`);
  const btn = $("sheetToggle");
  btn.classList.remove("bump");
  void btn.offsetWidth;
  btn.classList.add("bump");
}

function saveDraft() {
  store.saveDraft(state.seq);
}

function phaseBar(items) {
  const sums = {};
  let total = 0;
  for (const item of items) {
    const sec = itemSeconds(item, state.byId.get(item.id));
    sums[item.phase] = (sums[item.phase] || 0) + sec;
    total += sec;
  }
  if (!total) return "";
  return Object.keys(PHASES)
    .filter((p) => sums[p])
    .map((p) => `<span class="ph ph-${p}" style="flex:${sums[p]}" title="${PHASES[p]} ${formatMinutes(sums[p])}"><i>${PHASES[p]}</i></span>`)
    .join("");
}

function renderSummary() {
  const items = state.seq.items;
  const total = totalSeconds(items.filter((it) => state.byId.has(it.id)), state.byId);
  $("seqTotal").textContent = formatMinutes(total);
  $("seqCount").textContent = items.length ? `자세 ${items.length}개 · 전환 ${TRANSITION_SECONDS}초씩 포함` : "자세 0개";
  $("seqPhaseBar").innerHTML = phaseBar(items);
  $("sheetCount").textContent = items.length;
  $("sheetTime").textContent = formatMinutes(total);
  $("seqEmpty").hidden = items.length > 0;
  ["playBtn", "storyBtn", "saveBtn", "printBtn", "clearBtn"].forEach((id) => ($(id).disabled = !items.length));
}

function renderBuilder() {
  $("seqTitle").value = state.seq.title || "";
  $("seqList").innerHTML = state.seq.items.map(seqItemHTML).join("");
  renderSummary();
}

function seqItemHTML(item, i, items) {
  const pose = state.byId.get(item.id);
  if (!pose) {
    return `<li class="seq-item missing" data-uid="${item.uid}" data-phase="${item.phase}">
      <span class="seq-idx">${i + 1}</span>
      <div class="seq-main"><p class="seq-name">불러오지 못한 자세 <small>${esc(item.id)}</small></p></div>
      <div class="seq-move"><button type="button" class="icon-btn" data-remove aria-label="삭제">✕</button></div>
    </li>`;
  }
  const reps = pose.dose?.type === "reps";
  const options = Object.entries(PHASES)
    .map(([k, v]) => `<option value="${k}"${k === item.phase ? " selected" : ""}>${v}</option>`)
    .join("");
  return `<li class="seq-item" data-uid="${item.uid}" data-phase="${item.phase}">
    <span class="drag" title="끌어서 순서 바꾸기" aria-hidden="true"><svg viewBox="0 0 10 16"><circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/><circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/><circle cx="3" cy="13" r="1.3"/><circle cx="7" cy="13" r="1.3"/></svg></span>
    <button type="button" class="seq-thumb" data-open="${pose.id}" aria-label="${esc(pose.name)} 자세히 보기">${figureSVG(pose.figure, { size: 52 })}</button>
    <div class="seq-main">
      <p class="seq-name"><span class="seq-idx">${i + 1}</span>${esc(pose.name)}</p>
      ${pose.tool !== "mat" ? `<p class="seq-tool">${toolTag(pose.tool)}</p>` : ""}
      <div class="seq-controls">
        <select data-phase aria-label="${esc(pose.name)} 구간">${options}</select>
        <label class="dur">
          <input type="number" data-dur inputmode="numeric" min="1" max="${reps ? 50 : 900}" step="${reps ? 1 : 5}" value="${item.dur}" aria-label="${esc(pose.name)} ${reps ? "횟수" : "시간(초)"}">
          <span>${reps ? "회" : "초"}${pose.dose?.sides ? " × 양쪽" : ""}</span>
        </label>
      </div>
      ${item.cue ? `<p class="seq-cue">${esc(item.cue)}</p>` : ""}
    </div>
    <div class="seq-move">
      <button type="button" class="icon-btn" data-move="-1" aria-label="${esc(pose.name)} 위로" ${i === 0 ? "disabled" : ""}>↑</button>
      <button type="button" class="icon-btn" data-move="1" aria-label="${esc(pose.name)} 아래로" ${i === items.length - 1 ? "disabled" : ""}>↓</button>
      <button type="button" class="icon-btn" data-remove aria-label="${esc(pose.name)} 삭제">✕</button>
      <button type="button" class="icon-btn" data-swap aria-label="${esc(pose.name)} 비슷한 자세로 바꾸기" title="비슷한 자세로 바꾸기">⇄</button>
    </div>
  </li>`;
}

function itemIndex(el) {
  const li = el.closest("li[data-uid]");
  return li ? state.seq.items.findIndex((it) => it.uid === li.dataset.uid) : -1;
}

function move(from, to) {
  const items = state.seq.items;
  if (to < 0 || to >= items.length || from === to) return;
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
  saveDraft();
  renderBuilder();
}

function replaceSeq(next, message) {
  const prev = structuredClone(state.seq);
  state.seq = next;
  saveDraft();
  renderBuilder();
  toast(message, prev.items.length ? () => {
    state.seq = prev;
    saveDraft();
    renderBuilder();
  } : null);
}

const swapTried = new Map();

function swapPose(i) {
  const item = state.seq.items[i];
  const pose = state.byId.get(item.id);
  const tried = swapTried.get(item.uid) || new Set([item.id]);
  const inSeq = state.seq.items.map((it) => it.id);
  const tools = new Set(inSeq.map((id) => state.byId.get(id)?.tool));
  let next = alternatives(pose, state.poses, new Set([...inSeq, ...tried]), tools)[0];
  if (!next) {
    tried.clear();
    next = alternatives(pose, state.poses, new Set(inSeq), tools)[0];
  }
  if (!next) return toast(`${pose.name}${josa(pose.name, "과", "와")} 비슷한 자세를 찾지 못했습니다`);
  const prev = structuredClone(state.seq.items);
  tried.add(next.id);
  const uid = newUid();
  swapTried.set(uid, tried);
  state.seq.items[i] = { ...item, uid, id: next.id, dur: next.dose.value, cue: next.position === pose.position ? item.cue : "" };
  saveDraft();
  renderBuilder();
  $("seqList").children[i]?.querySelector("[data-swap]")?.focus();
  toast(`${pose.name} 대신 ${next.name}${josa(next.name, "을", "를")} 넣었습니다`, () => {
    state.seq.items = prev;
    saveDraft();
    renderBuilder();
  });
}

function setupBuilder() {
  const listEl = $("seqList");

  $("seqTitle").addEventListener("input", (e) => {
    state.seq.title = e.target.value;
    saveDraft();
  });

  listEl.addEventListener("click", (e) => {
    const i = itemIndex(e.target);
    if (i < 0) return;
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.open) return openDetail(btn.dataset.open);
    if (btn.hasAttribute("data-remove")) {
      const prev = structuredClone(state.seq.items);
      const pose = state.byId.get(state.seq.items[i].id);
      state.seq.items.splice(i, 1);
      saveDraft();
      renderBuilder();
      toast(`${pose ? pose.name : "자세"}${josa(pose ? pose.name : "자세", "을", "를")} 뺐습니다`, () => {
        state.seq.items = prev;
        saveDraft();
        renderBuilder();
      });
      return;
    }
    if (btn.hasAttribute("data-swap")) return swapPose(i);
    if (btn.dataset.move) {
      const to = i + Number(btn.dataset.move);
      move(i, to);
      const target = listEl.children[to]?.querySelector(`[data-move="${btn.dataset.move}"]:not(:disabled)`) || listEl.children[to]?.querySelector("[data-move]:not(:disabled)");
      target?.focus();
    }
  });

  listEl.addEventListener("input", (e) => {
    const i = itemIndex(e.target);
    if (i < 0 || !e.target.matches("[data-dur]")) return;
    const value = parseInt(e.target.value, 10);
    if (value > 0) {
      state.seq.items[i].dur = Math.min(value, Number(e.target.max));
      saveDraft();
      renderSummary();
    }
  });

  listEl.addEventListener("change", (e) => {
    const i = itemIndex(e.target);
    if (i < 0) return;
    const item = state.seq.items[i];
    if (e.target.matches("[data-phase]")) {
      item.phase = e.target.value;
      e.target.closest("li").dataset.phase = item.phase;
    }
    if (e.target.matches("[data-dur]")) e.target.value = item.dur;
    saveDraft();
    renderSummary();
  });

  let dragUid = null;
  const clearMarks = () => listEl.querySelectorAll(".drop-before, .drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));

  listEl.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(".drag");
    if (handle) handle.closest("li").draggable = true;
  });
  listEl.addEventListener("dragstart", (e) => {
    const li = e.target.closest("li");
    dragUid = li.dataset.uid;
    li.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragUid);
  });
  listEl.addEventListener("dragover", (e) => {
    if (!dragUid) return;
    e.preventDefault();
    const li = e.target.closest("li");
    clearMarks();
    if (!li || li.dataset.uid === dragUid) return;
    const rect = li.getBoundingClientRect();
    li.classList.add(e.clientY > rect.top + rect.height / 2 ? "drop-after" : "drop-before");
  });
  listEl.addEventListener("drop", (e) => {
    e.preventDefault();
    const li = e.target.closest("li");
    if (!dragUid || !li || li.dataset.uid === dragUid) return;
    const items = state.seq.items;
    const from = items.findIndex((it) => it.uid === dragUid);
    const after = li.classList.contains("drop-after");
    const [item] = items.splice(from, 1);
    const target = items.findIndex((it) => it.uid === li.dataset.uid);
    items.splice(after ? target + 1 : target, 0, item);
    saveDraft();
    renderBuilder();
  });
  listEl.addEventListener("dragend", () => {
    dragUid = null;
    clearMarks();
    listEl.querySelectorAll("li").forEach((li) => {
      li.draggable = false;
      li.classList.remove("dragging");
    });
  });

  $("playBtn").addEventListener("click", () => play(state.seq));
  $("storyBtn").addEventListener("click", () => openStory(state.seq));
  $("printBtn").addEventListener("click", printSheet);
  $("saveBtn").addEventListener("click", saveSequence);
  $("clearBtn").addEventListener("click", () => replaceSeq({ title: "", items: [] }, "시퀀스를 비웠습니다"));

  $("savedList").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const entry = state.saved.find((s) => s.id === btn.closest("li").dataset.id);
    if (!entry) return;
    if (btn.dataset.act === "load") {
      replaceSeq({ title: entry.title, savedId: entry.id, items: entry.items.map((it) => ({ ...it, uid: newUid() })) }, `"${entry.title}"${josa(entry.title, "을", "를")} 불러왔습니다`);
      if (window.matchMedia("(max-width: 1023px)").matches) $("seqList").scrollIntoView({ block: "nearest" });
    } else if (btn.dataset.act === "rename") {
      renameSaved(btn.closest("li"), entry);
    } else if (btn.dataset.act === "delete") {
      const prev = [...state.saved];
      state.saved = state.saved.filter((s) => s !== entry);
      store.saveSaved(state.saved);
      renderSaved();
      toast(`"${entry.title}"${josa(entry.title, "을", "를")} 삭제했습니다`, () => {
        state.saved = prev;
        store.saveSaved(state.saved);
        renderSaved();
      });
    }
  });

  $("sheetToggle").addEventListener("click", () => setSheet(!$("builder").classList.contains("open")));
  document.querySelector(".skip-link").addEventListener("click", (e) => {
    e.preventDefault();
    if (window.matchMedia("(max-width: 1023px)").matches) setSheet(true);
    else $("builderHeading").focus();
  });
  $("sheetClose").addEventListener("click", () => setSheet(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("builder").classList.contains("open") && !document.querySelector("dialog[open]")) setSheet(false);
  });
}

function setSheet(open) {
  $("builder").classList.toggle("open", open);
  $("sheetToggle").setAttribute("aria-expanded", String(open));
  if (open) $("builderHeading").focus();
  else $("sheetToggle").focus();
}

function saveSequence() {
  const seq = state.seq;
  if (!seq.items.length) return;
  const title = seq.title.trim();
  if (!title) {
    $("seqTitle").focus();
    toast("시퀀스 이름을 먼저 적어 주세요");
    return;
  }
  seq.title = title;
  const now = new Date();
  const items = seq.items.map(({ id, dur, phase, cue }) => ({ id, dur, phase, cue }));
  const existing = state.saved.find((s) => s.id === seq.savedId && s.title === title);
  if (existing) {
    Object.assign(existing, { title, items, savedAt: now.toISOString() });
  } else {
    seq.savedId = `s-${now.getTime().toString(36)}`;
    state.saved.unshift({ id: seq.savedId, title, items, savedAt: now.toISOString() });
  }
  store.saveSaved(state.saved);
  saveDraft();
  renderBuilder();
  renderSaved();
  toast(existing ? `"${title}"에 덮어 저장했습니다` : `"${title}"${josa(title, "으로", "로")} 저장했습니다`);
}

function renameSaved(li, entry) {
  const box = li.querySelector("div");
  box.innerHTML = `<input type="text" class="rename-input" value="${esc(entry.title)}" maxlength="60" aria-label="새 이름">`;
  const input = box.querySelector("input");
  input.focus();
  input.select();
  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    const title = input.value.trim();
    if (keep && title && title !== entry.title) {
      if (state.seq.savedId === entry.id) {
        state.seq.title = title;
        saveDraft();
        $("seqTitle").value = title;
      }
      entry.title = title;
      store.saveSaved(state.saved);
      toast("이름을 바꿨습니다");
    }
    renderSaved();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") {
      e.stopPropagation();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
}

function renderSaved() {
  $("savedCount").textContent = state.saved.length;
  $("savedList").innerHTML = state.saved.length
    ? state.saved.map((s) => {
      const date = new Date(s.savedAt);
      const total = totalSeconds(s.items.filter((it) => state.byId.has(it.id)), state.byId);
      return `<li data-id="${s.id}">
        <div><strong>${esc(s.title)}</strong><span>${s.items.length}개 · ${formatMinutes(total)} · ${date.getMonth() + 1}/${date.getDate()}</span></div>
        <button type="button" class="text-btn" data-act="load" aria-label="${esc(s.title)} 불러오기">불러오기</button>
        <button type="button" class="text-btn" data-act="rename" aria-label="${esc(s.title)} 이름 바꾸기">이름</button>
        <button type="button" class="text-btn danger" data-act="delete" aria-label="${esc(s.title)} 삭제">삭제</button>
      </li>`;
    }).join("")
    : '<li class="muted">아직 저장한 시퀀스가 없습니다.</li>';
}

function play(seq) {
  const playable = seq.items.filter((it) => state.byId.has(it.id));
  if (!playable.length) return toast("재생할 자세가 없습니다");
  state.lastPlayed = { ...seq, items: playable };
  playSequence(state.lastPlayed, state.byId);
}

function printSheet() {
  const items = state.seq.items.filter((it) => state.byId.has(it.id));
  if (!items.length) return;
  const total = totalSeconds(items, state.byId);
  const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  const kinds = [...new Set(items.map((it) => DISCIPLINES[state.byId.get(it.id).discipline]))].join(", ");
  const tools = [...new Set(items.map((it) => state.byId.get(it.id).tool))].map((t) => TOOLS[t]).join(", ");

  const blockTime = (from) => {
    let sec = 0;
    for (let i = from; i < items.length && items[i].phase === items[from].phase; i++) sec += itemSeconds(items[i], state.byId.get(items[i].id));
    return sec;
  };

  let elapsed = 0;
  let lastPhase = "";
  const rows = items.map((item, i) => {
    const pose = state.byId.get(item.id);
    const cues = [item.cue, ...(pose.cues || [])].filter(Boolean).slice(0, 3);
    const head = item.phase !== lastPhase
      ? `<h2 class="ps-phase ph-${item.phase}">${PHASES[item.phase] || ""}<span>${formatMinutes(blockTime(i))}</span></h2>`
      : "";
    lastPhase = item.phase;
    const row = `${head}<article class="ps-item">
      <div class="ps-no"><b>${i + 1}</b><span>${clock(elapsed)}</span></div>
      <div class="ps-fig">${figureSVG(pose.figure, { size: 72 })}</div>
      <div class="ps-name">
        <h3>${esc(pose.name)}</h3>
        <p class="ps-en">${esc(pose.en || "")}</p>
        <p class="ps-dose">${esc(doseText(pose, item.dur))}</p>
        ${pose.tool !== "mat" ? `<p class="ps-tool tool-${pose.tool}">${esc(TOOLS[pose.tool])}</p>` : ""}
      </div>
      <ul class="ps-cues">${cues.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
    </article>`;
    elapsed += itemSeconds(item, pose) + TRANSITION_SECONDS;
    return row;
  }).join("");

  $("printSheet").innerHTML = `<header class="ps-head">
      <div>
        <p class="ps-kind">${esc(kinds)} 수업 시트</p>
        <h1>${esc(state.seq.title || "이름 없는 시퀀스")}</h1>
        <p class="ps-meta">${today} · 자세 ${items.length}개 · 약 ${formatMinutes(total)} · ${esc(tools)}</p>
      </div>
      <div class="ps-memo"><span>담당</span><span>회원 / 특이사항</span></div>
    </header>
    <div class="phase-bar ps-bar">${phaseBar(items)}</div>
    <div class="ps-list">${rows}</div>`;
  window.print();
}

async function openStory(seq) {
  const items = seq.items.filter((it) => state.byId.has(it.id));
  if (!items.length) return;
  const dialog = $("storyDialog");
  state.storyFiles.forEach((f) => URL.revokeObjectURL(f.url));
  state.storyFiles = [];
  $("storyPages").innerHTML = "";
  $("storyInfo").textContent = "이미지를 만드는 중입니다.";
  $("storySave").disabled = true;
  $("storyShare").hidden = true;
  if (!dialog.open) dialog.showModal();

  const files = await renderStory({ ...seq, items }, state.byId);
  state.storyFiles = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
  $("storyPages").innerHTML = state.storyFiles
    .map(({ file, url }, i) => `<figure><img src="${url}" alt="${esc(file.name)}"><figcaption>${files.length > 1 ? `${i + 1} / ${files.length}` : "1080 × 1920"}</figcaption></figure>`)
    .join("");
  $("storyInfo").textContent = files.length > 1
    ? `자세가 많아 ${files.length}장으로 나눴습니다. 휴대폰에서는 이미지를 길게 눌러 저장해도 됩니다.`
    : "1080 × 1920 스토리 크기입니다. 휴대폰에서는 이미지를 길게 눌러 저장해도 됩니다.";
  $("storySave").disabled = false;
  $("storyShare").hidden = !navigator.canShare?.({ files });
}

function setupStory() {
  const dialog = $("storyDialog");
  $("storyClose").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  $("storySave").addEventListener("click", () => {
    state.storyFiles.forEach(({ file, url }, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
      }, i * 400);
    });
  });
  $("storyShare").addEventListener("click", () => {
    const files = state.storyFiles.map((f) => f.file);
    navigator.share({ files, title: files[0].name }).catch(() => {});
  });
  $("playerStory").addEventListener("click", () => openStory(state.lastPlayed));
}

function readGenForm() {
  const form = $("genForm");
  return {
    discipline: form.discipline.value,
    minutes: Number(form.minutes.value),
    level: Number(form.level.value),
    style: form.style.value,
    mixExtra: [...form.querySelectorAll("[name=mixExtra]:checked")].map((el) => el.value),
    fill: form.fill.checked,
    areas: [...state.genAreas],
    concerns: state.concerns.filter((c) => state.genConcerns.has(c.id)),
    tools: [...state.genTools],
  };
}

function runGenerator() {
  const opts = readGenForm();
  if (!opts.tools.length) {
    $("genMsg").textContent = "도구를 하나 이상 골라 주세요.";
    return;
  }
  const result = generate(state.poses, opts);
  if (!result.items.length) {
    $("genMsg").textContent = opts.fill
      ? "조건에 맞는 자세가 없습니다. 도구나 레벨을 넓혀 주세요."
      : "조건에 맞는 자세가 없습니다. '부족하면 맨몸 동작으로 채우기'를 켜거나 도구, 레벨을 넓혀 주세요.";
    $("genResult").hidden = true;
    return;
  }
  const total = totalSeconds(result.items, state.byId);
  const notes = [];
  if (result.filled) notes.push(`고른 도구의 자세가 모자라 맨몸 동작 ${result.filled}개를 더했습니다.`);
  if (result.rounds > 1) notes.push(`메인 동작은 같은 순서로 ${result.rounds}세트 반복합니다.`);
  if (total < opts.minutes * 60 * 0.8) notes.push(`조건에 맞는 자세가 적어 ${formatMinutes(total)} 분량입니다. 도구나 레벨을 넓히면 더 길어집니다.`);
  $("genMsg").textContent = notes.join(" ");
  state.generated = { ...result, opts };
  renderGenerated();
}

function renderGenerated() {
  const { title, items, opts } = state.generated;
  const total = totalSeconds(items, state.byId);
  $("genTitle").textContent = title;
  const tools = [...new Set(items.map((it) => state.byId.get(it.id).tool))];
  $("genMeta").textContent = `자세 ${items.length}개 · 약 ${formatMinutes(total)} · ${LEVELS[opts.level]} · ${tools.map((t) => TOOLS[t]).join(", ")}`;
  $("genPhaseBar").innerHTML = phaseBar(items);
  let lastPhase = "";
  $("genFlow").innerHTML = items.map((item) => {
    const pose = state.byId.get(item.id);
    const head = item.phase !== lastPhase ? `<li class="flow-phase ph-${item.phase}">${PHASES[item.phase]}</li>` : "";
    lastPhase = item.phase;
    return `${head}<li class="flow-item" data-phase="${item.phase}">
      <button type="button" class="seq-thumb" data-open="${pose.id}" aria-label="${esc(pose.name)} 자세히 보기">${figureSVG(pose.figure, { size: 52 })}</button>
      <div>
        <p class="flow-name">${esc(pose.name)} <span class="tag soft">${POSITIONS[pose.position] || ""}</span>${pose.tool !== "mat" ? toolTag(pose.tool) : ""}</p>
        <p class="flow-dose">${esc(doseText(pose, item.dur))}</p>
        ${item.cue ? `<p class="flow-cue">${esc(item.cue)}</p>` : ""}
      </div>
    </li>`;
  }).join("");
  $("genResult").hidden = false;
}

function importTemplate(t) {
  const items = (t.items || []).filter((it) => state.byId.has(it.id));
  const skipped = (t.items || []).length - items.length;
  return { items: items.map((it) => ({ uid: newUid(), id: it.id, dur: it.dur, phase: it.phase || "main", cue: it.cue || "" })), skipped };
}

function renderTemplates() {
  const grid = $("templateGrid");
  const kinds = ["all", ...Object.keys(DISCIPLINES).filter((d) => state.sequences.some((t) => t.discipline === d))];
  $("templateFilter").hidden = kinds.length < 3;
  $("templateFilter").innerHTML = kinds
    .map((k) => `<button type="button" data-kind="${k}" aria-pressed="${k === state.templateKind}">${{ all: "전체", desk: "데스크" }[k] || DISCIPLINES[k]}</button>`)
    .join("");
  const list = state.sequences.filter((t) => state.templateKind === "all" || t.discipline === state.templateKind);
  if (!list.length) {
    grid.innerHTML = '<p class="muted empty-line">아직 등록된 템플릿이 없습니다.</p>';
    return;
  }
  grid.innerHTML = list.map((t) => {
    const known = (t.items || []).filter((it) => state.byId.has(it.id));
    const strip = known.slice(0, 6).map((it) => figureSVG(state.byId.get(it.id).figure, { size: 46 })).join("");
    const body = (t.body || []).map((b) => BODY[b]).filter(Boolean).join(" · ");
    const tools = (t.tools || []).filter((x) => TOOLS[x]).map(toolTag).join("");
    return `<article class="template-card disc-${t.discipline}" data-id="${esc(t.id)}">
      <div class="card-tags">
        <span class="tag disc-${t.discipline}">${DISCIPLINES[t.discipline] || ""}</span>
        <span class="tag level level-${t.level}">${LEVELS[t.level] || ""}</span>
        <span class="tag">${t.minutes}분</span>
      </div>
      <h3>${esc(t.title)}</h3>
      <p class="t-goal">${esc(t.goal || "")}</p>
      <div class="t-strip" aria-hidden="true">${strip}</div>
      <p class="t-meta">${esc(body)}</p>
      ${tools ? `<div class="card-tags">${tools}</div>` : ""}
      ${t.note ? `<p class="t-note" title="${esc(t.note)}">${esc(t.note)}</p>` : ""}
      <div class="t-actions">
        <button type="button" class="btn ghost" data-act="play">재생</button>
        <button type="button" class="btn primary" data-act="load">빌더로 가져오기</button>
      </div>
    </article>`;
  }).join("");
}

function setupGenerator() {
  chips($("genAreas"), Object.entries(FOCUS_AREAS).map(([k, v]) => [k, v.label]), (v) => state.genAreas.has(v), (v) => toggleIn(state.genAreas, v));
  toolChips($("genTools"), state.genTools, () => {});

  const syncMix = () => ($("mixExtraLine").hidden = $("genForm").discipline.value !== "mix");
  $("genForm").addEventListener("change", syncMix);
  syncMix();
  $("genForm").addEventListener("submit", (e) => {
    e.preventDefault();
    runGenerator();
  });
  $("genAgain").addEventListener("click", runGenerator);
  $("genPlay").addEventListener("click", () => play(state.generated));
  $("genUse").addEventListener("click", () => {
    const { title, items } = state.generated;
    replaceSeq({ title, items: items.map((it) => ({ ...it, uid: newUid() })) }, "생성한 시퀀스를 빌더로 가져왔습니다");
  });
  $("genFlow").addEventListener("click", (e) => {
    const open = e.target.closest("[data-open]");
    if (open) openDetail(open.dataset.open);
  });

  $("templateFilter").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-kind]");
    if (!btn) return;
    state.templateKind = btn.dataset.kind;
    renderTemplates();
  });

  $("templateGrid").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const t = state.sequences.find((s) => String(s.id) === btn.closest("article").dataset.id);
    if (!t) return;
    const { items, skipped } = importTemplate(t);
    if (!items.length) return toast("이 템플릿에 쓰인 자세를 아직 불러오지 못했습니다");
    if (btn.dataset.act === "play") return play({ title: t.title, items });
    replaceSeq({ title: t.title, items }, skipped ? `"${t.title}"${josa(t.title, "을", "를")} 불러왔습니다. 찾지 못한 자세 ${skipped}개는 뺐습니다` : `"${t.title}"${josa(t.title, "을", "를")} 불러왔습니다`);
  });
}

function setupTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const select = (tab) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute("aria-controls")).hidden = !on;
    });
  };
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const shown = tabs.filter((t) => !t.hidden);
      const at = shown.indexOf(tab);
      const next = shown[(at + (e.key === "ArrowRight" ? 1 : shown.length - 1)) % shown.length];
      select(next);
      next.focus();
    });
  });
}

function renderStats() {
  const count = (d) => state.poses.filter((p) => p.discipline === d).length;
  const kinds = ["yoga", "pilates", "barre", "desk"].filter(count).map((d) => `${DISCIPLINES[d]} ${count(d)}`);
  $("heroStats").innerHTML = `자세 ${state.poses.length}개, 템플릿 ${state.sequences.length}개<br>${kinds.join(", ")}`;
}

async function init() {
  setupTabs();
  setupLibrary();
  setupDetail();
  setupBuilder();
  setupGenerator();
  setupConcerns();
  setupStory();
  const prefs = store.prefs();
  initPlayer(prefs, store.savePrefs);

  if (!Array.isArray(state.seq.items)) state.seq = { title: "", items: [] };
  state.seq.items.forEach((it) => (it.uid ||= newUid()));

  $("poseGrid").innerHTML = '<p class="muted loading">자세를 불러오는 중…</p>';
  const { poses, sequences, concerns, missing } = await loadLibrary();
  state.poses = poses;
  state.byId = new Map(poses.map((p) => [p.id, p]));
  state.sequences = sequences;
  state.concerns = concerns;

  if (missing.length) {
    $("loadNotice").hidden = false;
    $("loadNotice").textContent = `일부 자료를 불러오지 못했습니다: ${missing.join(", ")}`;
  }

  renderStats();
  renderLibrary();
  renderBuilder();
  renderSaved();
  renderTemplates();
  renderConcerns();
}

init();
