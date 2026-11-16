import { itemSeconds, TRANSITION_SECONDS, DISCIPLINES } from "./poses.js";

export const FOCUS_AREAS = {
  hip: { label: "힙", body: ["hip", "glute", "hipflexor", "adductor"] },
  back: { label: "허리", body: ["lowerback", "spine", "core"] },
  shoulder: { label: "어깨·목", body: ["shoulder", "neck", "upperback", "chest"] },
  core: { label: "코어", body: ["core", "oblique"] },
  legs: { label: "하체", body: ["quad", "hamstring", "calf", "glute", "adductor", "foot"] },
  balance: { label: "균형", body: ["balance", "foot", "core"] },
  full: { label: "전신", body: ["fullbody"] },
  relax: { label: "이완", body: ["relax", "spine", "neck"] },
};

const STYLES = { strength: "강화", flexibility: "유연성", recovery: "회복" };

const SHARE = {
  strength: { warmup: 0.15, main: 0.47, peak: 0.15, cooldown: 0.13, rest: 0.1 },
  flexibility: { warmup: 0.15, main: 0.42, peak: 0.13, cooldown: 0.18, rest: 0.12 },
  recovery: { warmup: 0.15, main: 0.38, peak: 0.07, cooldown: 0.25, rest: 0.15 },
};

const STYLE_FOCUS = {
  strength: { strength: 3, stability: 2.5, balance: 2, mobility: 0.5 },
  flexibility: { stretch: 3, mobility: 2.5, release: 1, balance: 0.5 },
  recovery: { release: 3, breath: 2.5, stretch: 2, mobility: 1.5 },
};

const RANK = { standing: 0, kneeling: 1, quadruped: 2, inversion: 2.5, prone: 3, side: 4, seated: 5, supine: 6 };

const CUE_TO = {
  standing: "손을 발 쪽으로 걸어오거나 한 발씩 세워 천천히 일어섭니다.",
  kneeling: "무릎을 골반 너비로 매트에 내려 무릎으로 섭니다.",
  quadruped: "손은 어깨 아래, 무릎은 골반 아래에 두고 네발 자세로 옵니다.",
  inversion: "손과 발의 위치를 먼저 확인하고, 준비된 사람만 천천히 올라갑니다.",
  prone: "몸을 앞으로 길게 내려 이마를 매트에 두고 엎드립니다.",
  side: "옆으로 돌아누워 머리부터 발끝까지 한 줄로 맞춥니다.",
  seated: "엉덩이를 매트에 내려 좌골로 앉고 척추를 세웁니다.",
  supine: "한 마디씩 등을 내려 천장을 보고 눕습니다.",
};

function transitionCue(prev, pose) {
  if (!prev) return "매트 가운데에서 호흡을 고르며 시작합니다.";
  if (prev.position === pose.position) return "";
  return CUE_TO[pose.position] || "";
}

const NICE_REPS = [3, 4, 5, 6, 8, 10, 12, 15, 16, 20, 24, 30, 32, 40, 48];

function niceReps(n) {
  return NICE_REPS.reduce((best, x) => (Math.abs(x - n) < Math.abs(best - n) ? x : best));
}

function fits(pose, phase, level) {
  const f = pose.focus;
  if (phase === "warmup") return pose.level === 1 && pose.position !== "inversion" && ["mobility", "breath", "stretch", "stability"].includes(f);
  if (phase === "main") return !["release", "breath"].includes(f);
  if (phase === "peak") return !["release", "breath"].includes(f) && pose.level >= Math.min(level, 2);
  if (phase === "cooldown") return pose.position !== "standing" && pose.position !== "inversion" && ["stretch", "release", "mobility", "breath"].includes(f);
  return ["supine", "seated", "side", "prone"].includes(pose.position) && (["release", "breath"].includes(f) || pose.body.includes("relax"));
}

function score(pose, phase, ctx) {
  let s = Math.random() * 2.5;
  pose.body.forEach((b, i) => {
    if (ctx.body.has(b)) s += i === 0 ? 3 : 1.5;
  });
  if (ctx.full) s += 1;
  s += (STYLE_FOCUS[ctx.style][pose.focus] || 0) * (phase === "main" || phase === "peak" ? 1 : 0.5);
  if (phase === "warmup" && ["mobility", "breath"].includes(pose.focus)) s += 2;
  if (phase === "peak") s += pose.level * 1.5;
  if (phase === "rest" && pose.body.includes("relax")) s += 3;
  if (phase === "peak" && ctx.mainEnd != null && RANK[pose.position] < ctx.mainEnd - 1) s -= 5;
  if (phase === "cooldown" && ctx.peakRank != null && RANK[pose.position] < ctx.peakRank - 1) s -= 3;
  if (ctx.discipline === "mix") s += ctx.count[pose.discipline] <= Math.min(...Object.values(ctx.count)) ? 1.5 : 0;
  if (ctx.last.has(pose.id)) s -= 2.5;
  if (ctx.filler.has(pose.id)) s -= 4;
  return s;
}

function durFor(pose, phase, style) {
  const { type, value } = pose.dose;
  if (type === "reps") return phase === "warmup" ? niceReps(Math.max(4, value * 0.75)) : value;
  let sec = value;
  if (style !== "strength" && ["stretch", "release", "breath"].includes(pose.focus)) sec *= 1.5;
  if (phase === "warmup") sec = Math.min(sec, 60);
  if (phase === "rest") sec = Math.max(sec, 90);
  return Math.round(Math.min(sec, 180) / 5) * 5;
}

function take(pose, ctx) {
  ctx.used.add(pose.id);
  ctx.count[pose.discipline] = (ctx.count[pose.discipline] || 0) + 1;
}

function substitute(original, pool, ctx) {
  const keys = new Set(original.body);
  let best = null;
  let bestScore = 0;
  for (const p of pool) {
    if (ctx.used.has(p.id)) continue;
    const overlap = p.body.filter((b) => keys.has(b)).length;
    if (!overlap) continue;
    const s = overlap * 2 + (p.body[0] === original.body[0] ? 2 : 0) + (p.focus === original.focus ? 1.5 : 0)
      + (p.position === original.position ? 1 : 0) + Math.random();
    if (s > bestScore) {
      best = p;
      bestScore = s;
    }
  }
  return best;
}

export function alternatives(original, poses, taken, tools) {
  const keys = new Set(original.body);
  return poses
    .filter((p) => p.id !== original.id && !taken.has(p.id) && p.discipline === original.discipline && tools.has(p.tool)
      && p.level <= Math.max(original.level, 1) + 1 && p.body?.some((b) => keys.has(b)))
    .map((p) => [
      p.body.filter((b) => keys.has(b)).length * 2 + (p.body[0] === original.body[0] ? 2 : 0)
        + (p.tool === original.tool ? 3 : 0) + (p.position === original.position ? 3 : 0)
        + (p.focus === original.focus ? 2 : 0) + (p.level === original.level ? 1 : 0),
      p,
    ])
    .sort((a, b) => b[0] - a[0])
    .map(([, p]) => p);
}

const ROLE_ORDER = ["release", "mobilize", "strengthen", "integrate"];
const ROLE_PHASES = {
  release: ["warmup", "cooldown"],
  mobilize: ["warmup", "main"],
  strengthen: ["main"],
  integrate: ["peak", "main"],
};
const FILLER_ROLE = { warmup: 1, main: 2, peak: 3, cooldown: 0, rest: 0 };

function concernSeeds(concerns, poses, pool, ctx, budget) {
  const byId = new Map(poses.map((p) => [p.id, p]));
  const inPool = new Set(pool.map((p) => p.id));
  const seeds = { warmup: [], main: [], peak: [], cooldown: [], rest: [] };
  const used = { warmup: 0, main: 0, peak: 0, cooldown: 0, rest: 0 };

  ROLE_ORDER.forEach((role, r) => {
    const lists = concerns.map((c) => c.roles?.[role] || []);
    const longest = Math.max(0, ...lists.map((l) => l.length));
    for (let i = 0; i < longest; i++) {
      for (const list of lists) {
        const original = byId.get(list[i]);
        if (!original?.body?.length) continue;
        original.body.slice(0, 2).forEach((b) => ctx.body.add(b));
        const pose = inPool.has(original.id) && !ctx.used.has(original.id) ? original : substitute(original, pool, ctx);
        if (!pose) continue;
        for (const phase of ROLE_PHASES[role]) {
          const item = { id: pose.id, dur: durFor(pose, phase, ctx.style), phase };
          const cost = itemSeconds(item, pose) + TRANSITION_SECONDS;
          if (used[phase] + cost > budget(phase) + 30) continue;
          seeds[phase].push([pose, item, r]);
          used[phase] += cost;
          take(pose, ctx);
          break;
        }
      }
    }
  });
  return seeds;
}

function fillPhase(phase, budget, pool, ctx, maxCount = Infinity, seeds = []) {
  const ranked = pool
    .filter((p) => !ctx.used.has(p.id) && fits(p, phase, ctx.level))
    .map((p) => [score(p, phase, ctx), p])
    .sort((a, b) => b[0] - a[0]);

  const picked = [...seeds];
  let used = seeds.reduce((sum, [pose, item]) => sum + itemSeconds(item, pose) + TRANSITION_SECONDS, 0);
  for (const [, pose] of ranked) {
    if (used >= budget - 15 || picked.length >= maxCount) break;
    if (phase === "peak" && picked.length && Math.abs(RANK[pose.position] - RANK[picked[0][0].position]) > 1) continue;
    const item = { id: pose.id, dur: durFor(pose, phase, ctx.style), phase };
    const cost = itemSeconds(item, pose) + TRANSITION_SECONDS;
    if (picked.length && used + cost > budget + 30) continue;
    picked.push([pose, item, FILLER_ROLE[phase]]);
    used += cost;
    take(pose, ctx);
  }
  return { picked, used };
}

let lastIds = new Set();

export function generate(poses, opts) {
  const { discipline, areas, tools, minutes, level, style } = opts;
  const concerns = opts.concerns || [];
  const kinds = discipline === "mix" ? ["yoga", "pilates", ...(opts.mixExtra || [])] : [discipline];
  const usable = poses.filter((p) => p.level <= level && p.dose && p.body?.length);
  const pool = usable.filter((p) => kinds.includes(p.discipline) && tools.includes(p.tool));
  const target = minutes * 60;
  const room = pool.reduce((sum, p) => sum + itemSeconds({ dur: p.dose.value }, p) + TRANSITION_SECONDS, 0);
  const plain = discipline === "desk" ? ["mat", "chair", "desk"] : ["mat"];
  const fillKinds = discipline === "barre" ? ["barre", "pilates", "yoga"] : kinds;
  const filler = opts.fill && room < target * 1.3
    ? usable.filter((p) => fillKinds.includes(p.discipline) && plain.includes(p.tool) && !pool.includes(p))
    : [];
  pool.push(...filler);

  const ctx = {
    style,
    level,
    discipline,
    body: new Set(areas.flatMap((a) => FOCUS_AREAS[a]?.body || [])),
    full: areas.includes("full") || (!areas.length && !concerns.length),
    used: new Set(),
    last: lastIds,
    filler: new Set(filler.map((p) => p.id)),
    count: Object.fromEntries(kinds.map((k) => [k, 0])),
    mainEnd: null,
    peakRank: null,
  };

  const share = SHARE[style];
  const budget = (phase) => Math.round(target * share[phase]);

  const seeds = concernSeeds(concerns, poses, pool, ctx, budget);

  const warmup = fillPhase("warmup", budget("warmup"), pool, ctx, Infinity, seeds.warmup);
  let carry = budget("warmup") - warmup.used;
  const main = fillPhase("main", budget("main") + carry, pool, ctx, Infinity, seeds.main);
  carry = budget("main") + carry - main.used;
  if (main.picked.length) ctx.mainEnd = Math.max(...main.picked.map(([p]) => RANK[p.position]));

  const peak = fillPhase("peak", budget("peak") + Math.max(0, carry), pool, ctx, minutes <= 15 ? 1 : 3, seeds.peak);
  carry = budget("peak") + Math.max(0, carry) - peak.used;
  if (peak.picked.length) ctx.peakRank = Math.max(...peak.picked.map(([p]) => RANK[p.position]));

  const cooldown = fillPhase("cooldown", budget("cooldown") + Math.max(0, carry), pool, ctx, Infinity, seeds.cooldown);
  carry = budget("cooldown") + Math.max(0, carry) - cooldown.used;
  const rest = fillPhase("rest", budget("rest") + Math.max(0, carry), pool, ctx, 2);

  const byRank = (dir) => (a, b) => (concerns.length ? a[2] - b[2] : 0) || dir * (RANK[a[0].position] - RANK[b[0].position]);
  const ordered = [
    ...warmup.picked.sort(byRank(-1)),
    ...main.picked.sort(byRank(1)),
    ...peak.picked.sort(byRank(1)),
    ...cooldown.picked.sort(byRank(1)),
    ...rest.picked.sort(byRank(1)),
  ];

  const byId = new Map(ordered.map(([p]) => [p.id, p]));
  const cost = (list) => list.reduce((s, [pose, item]) => s + itemSeconds(item, pose) + TRANSITION_SECONDS, 0);
  const block = main.picked;
  const after = warmup.picked.length + block.length;
  let rounds = 1;
  while (block.length && rounds < 3 && cost(ordered) + cost(block) <= target * 1.05 && cost(ordered) < target * 0.85) {
    rounds += 1;
    ordered.splice(after + block.length * (rounds - 2), 0, ...block.map(([pose, item], i) => [pose, { ...item, round: rounds, first: i === 0 }]));
  }

  let prev = null;
  const items = ordered.map(([pose, item]) => {
    const { round, first, ...rest } = item;
    rest.cue = first ? `${round === 2 ? "두" : "세"} 번째 세트입니다. 메인 동작을 같은 순서로 한 번 더 이어갑니다.` : round ? "" : transitionCue(prev, pose);
    prev = pose;
    return rest;
  });

  const work = () => items.reduce((s, it) => s + itemSeconds(it, byId.get(it.id)), 0);
  const transitions = TRANSITION_SECONDS * Math.max(0, items.length - 1);
  const scale = Math.min(1.6, Math.max(0.7, (target - transitions) / (work() || 1)));
  if (scale > 1.1 || scale < 0.93) {
    for (const it of items) {
      if (it.phase === "rest" && scale > 1) continue;
      it.dur = byId.get(it.id).dose.type === "reps" ? niceReps(it.dur * scale) : Math.max(10, Math.round((it.dur * scale) / 5) * 5);
    }
  }
  const total = work() + transitions;
  const lastRest = [...items].reverse().find((it) => it.phase === "rest" && byId.get(it.id).dose.type === "hold");
  if (lastRest && total < target) {
    const cap = Math.max(lastRest.dur, Math.round((target * 0.15) / 5) * 5);
    lastRest.dur = Math.min(lastRest.dur + Math.round((target - total) / 5) * 5, cap);
  }

  lastIds = new Set(items.map((it) => it.id));

  const areaText = [...concerns.map((c) => c.name), ...areas.map((a) => FOCUS_AREAS[a]?.label)].filter(Boolean).join("·") || "전신";
  return {
    title: `${DISCIPLINES[discipline]} ${areaText} ${STYLES[style]} ${minutes}분`,
    items,
    filled: items.filter((it) => ctx.filler.has(it.id)).length,
    rounds,
  };
}
