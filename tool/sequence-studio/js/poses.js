export const DISCIPLINES = { yoga: "요가", pilates: "필라테스", desk: "데스크 스트레칭", barre: "바레", mix: "혼합" };

export const TOOLS = {
  mat: "맨몸 매트",
  wall: "벽",
  chair: "의자",
  desk: "책상",
  barre: "바레 바",
  band: "라텍스 밴드",
  strap: "요가 스트랩",
  block: "요가 블록",
  ring: "리커버리 링",
  circle: "써클링",
  softball: "소프트볼",
  ball: "마사지 볼",
  roller: "폼롤러",
};

export const TOOL_GROUPS = [
  ["맨몸·가구", ["mat", "wall", "chair", "desk", "barre"]],
  ["소도구", ["band", "strap", "block", "ring", "circle", "softball"]],
  ["릴리즈", ["ball", "roller"]],
];

export const TOOL_NOTES = {
  mat: "도구 없이 매트 위에서",
  wall: "벽에 기대거나 밀어 정렬과 지지",
  chair: "의자에 앉거나 짚어 높이와 지지",
  desk: "책상을 짚거나 기대어 자리에서",
  barre: "바를 가볍게 잡고 균형과 정렬을 지키며",
  band: "당기고 버텨 저항과 보조",
  strap: "손이 닿지 않는 거리를 이어 주는 끈",
  block: "바닥을 올려 범위를 맞추는 받침",
  ring: "가운데가 잘록한 단단한 플라스틱 링, 끼우고 대고 지그시 누르기",
  circle: "매직 서클이라고도 부르는 양쪽 패드 탄성 링, 조이고 밀기",
  softball: "말랑한 작은 볼, 끼우고 조이기",
  ball: "단단한 볼로 한 점을 지그시 눌러 풀기",
  roller: "긴 원통 위에서 굴리고 받치기",
};

export const POSITIONS = {
  standing: "서기",
  kneeling: "무릎",
  quadruped: "네발",
  seated: "앉기",
  supine: "누워서",
  prone: "엎드려",
  side: "옆으로",
  inversion: "역자세",
};

export const BODY = {
  neck: "목",
  shoulder: "어깨",
  chest: "가슴",
  upperback: "등 위쪽",
  lowerback: "허리",
  spine: "척추",
  core: "코어",
  oblique: "옆구리",
  hipflexor: "고관절 굴곡근",
  hip: "고관절",
  glute: "둔근",
  adductor: "내전근",
  quad: "대퇴사두",
  hamstring: "햄스트링",
  calf: "종아리·발목",
  foot: "발",
  wrist: "손목",
  arm: "팔",
  balance: "균형",
  fullbody: "전신",
  relax: "이완",
};

export const LEVELS = { 1: "입문", 2: "중급", 3: "상급" };

export const FOCUS = {
  stretch: "스트레칭",
  strength: "근력",
  mobility: "가동성",
  balance: "균형",
  release: "이완",
  breath: "호흡",
  stability: "안정화",
};

export const PHASES = {
  warmup: "웜업",
  main: "메인",
  peak: "피크",
  cooldown: "쿨다운",
  rest: "이완",
};

export const ROLES = {
  release: { label: "풀기", en: "Release", phase: "warmup" },
  mobilize: { label: "움직이기", en: "Mobilize", phase: "warmup" },
  strengthen: { label: "강화", en: "Strengthen", phase: "main" },
  integrate: { label: "통합", en: "Integrate", phase: "peak" },
};

export const CONCERN_GROUPS = ["자세 습관", "상체", "하체", "코어", "회복"];

export const TRANSITION_SECONDS = 10;

const FILES = [
  ["yoga-mat", "YOGA_MAT"],
  ["yoga-props", "YOGA_PROPS"],
  ["pilates-mat", "PILATES_MAT"],
  ["pilates-props", "PILATES_PROPS"],
  ["rings", "RINGS"],
  ["desk", "DESK"],
  ["strap-block", "STRAP_BLOCK"],
  ["ball-roller", "BALL_ROLLER"],
  ["barre", "BARRE"],
  ["yoga-extra", "YOGA_EXTRA"],
  ["pilates-extra", "PILATES_EXTRA"],
  ["props-extra", "PROPS_EXTRA"],
];

export async function loadLibrary() {
  const results = await Promise.allSettled([
    ...FILES.map(([file]) => import(`../data/${file}.js`)),
    import("../data/sequences.js"),
    import("../data/concerns.js"),
  ]);

  const poses = [];
  const seen = new Set();
  const missing = [];

  FILES.forEach(([file, name], i) => {
    const res = results[i];
    const list = res.status === "fulfilled" ? res.value[name] : null;
    if (!Array.isArray(list)) {
      missing.push(`${file}.js`);
      return;
    }
    for (const pose of list) {
      if (!pose?.id || seen.has(pose.id) || !pose.figure?.j || !pose.discipline || !pose.tool) continue;
      seen.add(pose.id);
      poses.push({
        ...pose,
        body: pose.body || [],
        dose: pose.dose || { type: "hold", value: 30, sides: false },
      });
    }
  });

  const seqRes = results[FILES.length];
  const sequences = seqRes.status === "fulfilled" && Array.isArray(seqRes.value.SEQUENCES) ? seqRes.value.SEQUENCES : [];
  if (seqRes.status !== "fulfilled") missing.push("sequences.js");

  const conRes = results[FILES.length + 1];
  const concerns = conRes.status === "fulfilled" && Array.isArray(conRes.value.CONCERNS)
    ? conRes.value.CONCERNS.filter((c) => c?.id && c.name && c.roles)
    : [];

  return { poses, sequences, concerns, missing };
}

function repSeconds(pose) {
  const { value, tempo } = pose.dose;
  if (tempo) return tempo;
  let sec = value <= 5 ? 8 : value < 10 ? 5 : value < 20 ? 3 : 1.5;
  if (pose.focus === "breath") sec = Math.max(sec, 8);
  else if (pose.discipline !== "desk" && ["mobility", "stretch"].includes(pose.focus)) sec = Math.max(sec, 6);
  return sec;
}

export function itemSeconds(item, pose) {
  if (!pose) return 0;
  const once = pose.dose?.type === "reps" ? Math.round(item.dur * repSeconds(pose)) : item.dur;
  return pose.dose?.sides ? once * 2 : once;
}

export function totalSeconds(items, byId) {
  if (!items.length) return 0;
  const work = items.reduce((sum, item) => sum + itemSeconds(item, byId.get(item.id)), 0);
  return work + TRANSITION_SECONDS * (items.length - 1);
}

export function doseText(pose, dur = pose.dose?.value) {
  const unit = pose.dose?.type === "reps" ? `${dur}회` : formatHold(dur);
  return pose.dose?.sides ? `${unit} × 양쪽` : unit;
}

function formatHold(sec) {
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}분 ${s}초` : `${m}분`;
}

export function formatMinutes(sec) {
  if (!sec) return "0분";
  const m = Math.round(sec / 60);
  if (m < 1) return `${sec}초`;
  if (m < 60) return `${m}분`;
  return `${Math.floor(m / 60)}시간 ${m % 60 ? `${m % 60}분` : ""}`.trim();
}

export function clock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function escapeHTML(text = "") {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
