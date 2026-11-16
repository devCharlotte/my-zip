const FLOOR = 104;

const COLORS = {
  body: "#35343c",
  far: "#26252b",
  top: "#2b2b30",
  skin: "#f3d7c4",
  skinFar: "#e2bba6",
  skinLine: "#c99a84",
  hair: "#43312b",
  cheek: "#ee9aa2",
  mat: "#e3d8c8",
  ring: "#e58fa2",
  circle: "#7fa7c6",
  band: "#ec8d6d",
  chair: "#c49e7a",
  desk: "#d9c2a4",
  wall: "#efebf3",
  block: "#c3b3e4",
  strap: "#4f8a85",
  ball: "#de8ca2",
  roller: "#93a4cc",
};

const LIGHT = [-0.55, -0.83];

const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const perp = (a) => [-a[1], a[0]];
const mid = (a, b) => mul(add(a, b), 0.5);
const lerp = (a, b, t) => add(a, mul(sub(b, a), t));
const at = (o, u, v, x, y) => [o[0] + u[0] * x + v[0] * y, o[1] + u[1] * x + v[1] * y];
const f = (n) => +n.toFixed(2);

function gapTo(q, a, b) {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(q, a), ab) / (dot(ab, ab) || 1)));
  return len(sub(q, add(a, mul(ab, t))));
}

function unit(a, fallback = [0, 1]) {
  const l = len(a);
  return l < 1e-6 ? fallback : [a[0] / l, a[1] / l];
}

function turn(from, to, v) {
  const c = dot(from, to), s = from[0] * to[1] - from[1] * to[0];
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  return "#" + [n >> 16, (n >> 8) & 255, n & 255]
    .map((c) => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k).toString(16).padStart(2, "0"))
    .join("");
}

function pt(p) {
  return `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
}

function smooth(ps, closed = true) {
  const n = ps.length;
  const get = (i) => closed ? ps[(i + n) % n] : ps[Math.max(0, Math.min(n - 1, i))];
  let d = "M" + pt(ps[0]);
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const c1 = add(get(i), mul(sub(get(i + 1), get(i - 1)), 1 / 6));
    const c2 = sub(get(i + 1), mul(sub(get(i + 2), get(i)), 1 / 6));
    d += `C${pt(c1)} ${pt(c2)} ${pt(get(i + 1))}`;
  }
  return closed ? d + "Z" : d;
}

function disc(c, r) {
  return `M${pt([c[0] + r, c[1]])}A${f(r)} ${f(r)} 0 1 0 ${pt([c[0] - r, c[1]])}A${f(r)} ${f(r)} 0 1 0 ${pt([c[0] + r, c[1]])}Z`;
}

function seg(a, b, r1, r2, k1 = 0, k2 = k1) {
  const l = len(sub(b, a));
  if (l < 0.5) return disc(a, Math.max(r1, r2));
  const u = mul(sub(b, a), 1 / l), n = perp(u);
  const m = add(a, mul(u, l * 0.42)), w = (r1 + r2) / 2;
  return `M${pt(add(a, mul(n, r1)))}Q${pt(add(m, mul(n, w + 2 * k1)))} ${pt(add(b, mul(n, r2)))}`
    + `A${f(r2)} ${f(r2)} 0 0 0 ${pt(add(b, mul(n, -r2)))}`
    + `Q${pt(add(m, mul(n, -w - 2 * k2)))} ${pt(add(a, mul(n, -r1)))}`
    + `A${f(r1)} ${f(r1)} 0 0 0 ${pt(add(a, mul(n, r1)))}Z`;
}

function shine(a, b, r1, r2) {
  const u = unit(sub(b, a));
  let n = perp(u);
  if (dot(n, LIGHT) < 0) n = mul(n, -1);
  return `M${pt(at(a, u, n, r1 * 0.9, r1 * 0.5))}L${pt(at(b, u, n, -r2 * 0.9, r2 * 0.5))}`;
}

function shape(d, fill, line, w = 0.9) {
  return `<path d="${d}" fill="${fill}" stroke="${line}" stroke-width="${w}" stroke-linejoin="round" paint-order="stroke"/>`;
}

function isFrontal(j, down) {
  if (Math.abs(down[1]) < 0.6) {
    const p = perp(down);
    const across = (h) => {
      const v = sub(h, j.neck);
      return Math.abs(dot(v, down)) < Math.abs(dot(v, p)) * 0.6 ? dot(v, p) : 0;
    };
    const a = across(j.handN), b = across(j.handF);
    const pillow = [[j.elbowN, j.handN], [j.elbowF, j.handF]]
      .some(([e, h]) => len(sub(h, j.head)) < 9 && e[1] > FLOOR - 6 && dot(sub(e, j.head), down) < 0);
    const [hi, lo] = [j.handN[1], j.handF[1]].sort((m, n) => m - n);
    return pillow || (a * b < 0 && Math.abs(a) > 12 && Math.abs(b) > 12 && hi < j.neck[1] - 10 && lo > j.neck[1] + 6);
  }
  if (Math.abs(down[0]) > 0.4) return false;
  const mirror = (a, b, c, gap) =>
    Math.abs(a[0] + b[0] - 2 * c[0]) < 3.5 && Math.abs(a[0] - b[0]) > gap && Math.abs(a[1] - b[1]) < 5;
  return mirror(j.kneeN, j.kneeF, j.hip, 7)
    || mirror(j.footN, j.footF, j.hip, 9)
    || (mirror(j.elbowN, j.elbowF, j.neck, 10) && mirror(j.handN, j.handF, j.neck, 8));
}

const TOWARD = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function facing(j, down, props, hint) {
  const p = perp(down);
  if (TOWARD[hint]) return dot(p, TOWARD[hint]) < 0 ? mul(p, -1) : p;
  let s = 0;
  for (const [knee, foot] of [[j.kneeN, j.footN], [j.kneeF, j.footF]]) {
    const t = unit(sub(knee, j.hip), down);
    if (dot(t, down) < 0.75) s += dot(t, p) * 22;
    const bend = turn(t, down, sub(knee, mid(j.hip, foot)));
    if (len(bend) > 3) s += dot(bend, p) * 1.2;
  }
  const upright = Math.abs(down[1]) > 0.8;
  for (const [elbow, hand] of [[j.elbowN, j.handN], [j.elbowF, j.handF]]) {
    const onFloor = hand[1] > FLOOR - 5;
    const reach = dot(sub(hand, j.neck), p);
    const hanging = upright && hand[1] > j.hip[1] - 8;
    if (Math.abs(reach) > 9 && !hanging) s += reach * (onFloor ? 0.2 : 0.5);
    if (elbow[1] > FLOOR - 5) {
      if (Math.abs(elbow[0] - j.neck[0]) < 7 && j.neck[1] < elbow[1] - 8) s += dot(sub(elbow, j.neck), p);
    } else if (onFloor) {
      const bend = sub(elbow, mid(j.neck, hand));
      if (len(bend) > 3) s -= dot(bend, p) * 0.6;
    }
  }
  if (upright) {
    const nod = dot(sub(j.head, j.neck), p);
    if (Math.abs(nod) > 3) s += nod * 1.5;
  }
  if (Math.abs(s) < 2) {
    const [x0, x1] = [j.neck[0], j.hip[0]].sort((a, b) => a - b);
    const propped = props.some((q) => q.at && q.at[0] > x0 - 4 && q.at[0] < x1 + 4);
    const wall = props.find((q) => q.type === "wall");
    s = Math.abs(down[1]) > 0.5 ? (wall ? j.neck[0] - wall.x : 1) * p[0] : j.neck[1] < j.hip[1] - 3 && !propped ? p[1] : -p[1];
  }
  return s < 0 ? mul(p, -1) : p;
}

const SIDE = [[-0.06, 2.4, 2.7], [0.08, 4.2, 4.7], [0.28, 5.4, 4.4], [0.46, 4.4, 3.9], [0.64, 3.8, 3.3], [0.86, 4.3, 5.3], [1, 3.6, 5]];
const FRONT = [[-0.06, 2.4, 2.4], [0.07, 7.2, 7.2], [0.2, 6.6, 6.6], [0.4, 5.4, 5.4], [0.64, 4.6, 4.6], [0.88, 6, 6], [1.02, 5, 5]];
const FOOT = [[-1, -1.6], [-2, 0.1], [-1.3, 1.1], [3.5, 1.15], [6, 0.8], [6.4, -0.1], [4, -0.9], [1, -1.7]];
const FACE = [[90, 1], [130, 1.01], [175, 1], [220, 0.97], [262, 0.88], [300, 0.93], [322, 1], [340, 1], [353, 1.1], [8, 1.03], [30, 1], [58, 1]];
const HAIR = [[42, 1.08], [80, 1.13], [120, 1.14], [160, 1.12], [200, 1.06], [234, 0.93], [222, 0.55], [190, 0.4], [140, 0.45], [95, 0.62], [58, 0.88]];
const FRONT_FACE = [[90, 1], [140, 1], [185, 0.96], [225, 0.9], [262, 0.84], [278, 0.84], [315, 0.9], [355, 0.96], [40, 1]];
const FRONT_HAIR = [[-8, 1.02], [30, 1.1], [90, 1.15], [150, 1.1], [188, 1.02], [172, 0.8], [130, 0.62], [92, 0.66], [50, 0.62], [8, 0.8]];

export function bodyFrame(figure) {
  const j = figure.j, hint = figure.facing;
  const grounded = figure.floor !== false;
  const down = unit(sub(j.hip, j.neck));
  const lying = Math.abs(down[1]) < 0.6;
  let front = grounded ? isFrontal(j, down) : Math.abs(down[1]) < 0.5 || isFrontal(j, down);
  if (hint === "front") front = true;
  else if (hint === "side") front = lying;
  else if (TOWARD[hint]) front = false;
  const ant = front ? perp(down) : facing(j, down, [].concat(figure.prop || []), hint);
  return { down, front, ant };
}

function body(figure, between = "", over = "") {
  const j = figure.j, hint = figure.facing;
  const grounded = figure.floor !== false;
  const { down, front, ant } = bodyFrame(figure);
  const tl = len(sub(j.hip, j.neck));
  const curl = { round: -1, arch: 1 }[figure.spine];
  const arch = curl ? (front ? 0 : curl * Math.min(5.6, tl * 0.18)) : hint === "up" && j.hip[1] < j.neck[1] - 10 ? 4 : 0;
  const k = Math.min(1.1, Math.max(0.85, tl / 30));
  const side = (p, o, dflt) => Math.sign(dot(sub(p, o), ant)) || dflt;
  const lit = [];

  function leg(knee, foot, dflt, near, tip) {
    const hip = front ? add(j.hip, mul(ant, 3 * side(knee, j.hip, dflt))) : j.hip;
    const td = unit(sub(knee, hip), down), sd = unit(sub(foot, knee), td);
    const ta = front ? perp(td) : turn(down, td, ant);
    const sa = front ? perp(sd) : turn(td, sd, ta);
    const bulge = (u, a, fore, rear) => dot(perp(u), a) > 0 ? [fore, rear] : [rear, fore];

    const out = mul(ant, side(foot, j.hip, dflt));
    const tiptoe = grounded && !front && (tip ? foot[1] > FLOOR - 8 : foot[1] > FLOOR - 6 && foot[1] <= FLOOR - 3.5 && sd[1] > 0.75);
    const planted = grounded && !tiptoe && foot[1] > FLOOR - 5;
    let u = !front ? add(sa, mul(sd, 0.25))
      : planted && Math.abs(sd[1]) > 0.6 ? add(out, [0, 0.15]) : add(sd, mul(out, 0.4));
    if (!front && planted) {
      if (u[1] > 0.3) u = Math.abs(sd[1]) < 0.55 ? unit([sd[0], 0.12]) : unit([Math.sign(u[0]) || 1, 0.3]);
      else if (u[1] > -0.45) u = [Math.sign(u[0]) || 1, 0];
    }
    if (tiptoe) u = [Math.sign(u[0]) || 1, 0.9];
    u = unit(u);
    let v = perp(u);
    if (dot(v, front ? sd : sub(sd, sa)) < 0) v = mul(v, -1);
    const s = front ? 0.55 : 1;
    const shoe = () => FOOT.map(([x, y]) => at(foot, u, v, x * s, y));
    const lowest = (ps) => Math.max(...ps.map((q) => q[1]));
    let toes = shoe();
    if (grounded && !planted && !tiptoe && lowest(toes) > FLOOR + 0.3) {
      u = unit([Math.sign(u[0]) || 1, 0.15]);
      v = perp(u);
      if (dot(v, front ? sd : sub(sd, sa)) < 0) v = mul(v, -1);
      toes = shoe();
    }
    if (planted || tiptoe || (grounded && lowest(toes) > FLOOR + 0.3)) {
      const dy = Math.max(-2.5, Math.min(planted || tiptoe ? 2 : 0, FLOOR + 0.3 - lowest(toes)));
      foot = add(foot, [0, dy]);
      toes = toes.map((q) => add(q, [0, dy]));
    }
    const d = seg(hip, knee, 4.2, 3, ...bulge(td, ta, 0.4, 0.35))
      + seg(knee, foot, 2.9, 1.9, ...bulge(sd, sa, front ? 0.25 : 0.1, front ? 0.25 : 0.5));
    if (near) lit.push(shine(hip, knee, 4.2, 3), shine(knee, foot, 2.9, 1.9));
    return [d, smooth(toes)];
  }

  function arm(elbow, hand, dflt, near) {
    const sh = front ? at(j.neck, down, ant, 2.6, 5 * side(elbow, j.neck, dflt)) : add(j.neck, mul(down, 2.4));
    const fd = unit(sub(hand, elbow), unit(sub(elbow, sh), down));
    let hd = fd;
    if (grounded && hand[1] > FLOOR - 4 && Math.abs(fd[1]) > 0.6) hd = [Math.sign(hand[0] - j.hip[0]) || Math.sign(ant[0]) || 1, 0];
    if (grounded && hand[1] > FLOOR - 4.6) hand = [hand[0], FLOOR + 0.2 - 1.6 - Math.max(0, hd[1] * 2.1)];
    const wrist = sub(hand, mul(hd, 1.3));
    return seg(sh, elbow, 2.5, 1.95, 0.2) + seg(elbow, wrist, 1.95, 1.55, 0.15) + seg(wrist, add(hand, mul(hd, 2.1)), 1.55, 1.6, 0.2);
  }

  const rows = front ? FRONT : SIDE;
  const bow = (t) => arch * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
  const rest = (q) => arch && grounded ? [q[0], Math.min(q[1], FLOOR - 0.3)] : q;
  const fore = rows.map(([t, a]) => rest(at(j.neck, down, ant, t * tl, a * k + bow(t))));
  const back = rows.map(([t, , b]) => rest(at(j.neck, down, ant, t * tl, -b * k + bow(t))));
  const tail = at(j.neck, down, ant, 1.08 * tl, front ? 0 : -1.8);
  const torso = smooth([...fore, tail, ...back.slice().reverse()]);
  const top = smooth([...back.slice(0, 5).reverse(), ...fore.slice(0, 5)], false) + "Z";

  const R = 6.8;
  const hc = grounded ? [j.head[0], Math.min(j.head[1], FLOOR + 0.4 - R * 1.08)] : j.head;
  const up = unit(sub(hc, j.neck), mul(down, -1));
  let face = front ? perp(up) : turn(mul(down, -1), up, ant);
  if (front && (Math.abs(dot(face, ant)) < 0.35 ? dot(face, down) * (Math.sign(dot(up, ant)) || 1) : dot(face, ant)) < 0) face = mul(face, -1);
  const polar = (deg, r) => {
    const a = deg * Math.PI / 180;
    return at(hc, face, up, Math.cos(a) * r * R, Math.sin(a) * r * R);
  };
  const outline = (list) => smooth(list.map(([a, r]) => polar(a, r)));
  const neck = seg(add(j.neck, mul(down, 1.5)), lerp(j.neck, hc, 0.6), 2, 1.8);
  const hairLine = shade(COLORS.hair, -0.3);
  const pony = (tie, d) => {
    const mids = [tie];
    for (let i = 0; i < 5; i++) {
      d = unit(add(d, [0, 0.55]));
      mids.push(add(mids[i], mul(d, 3.1)));
    }
    const w = [1.5, 2.1, 2, 1.7, 1.2, 0.45];
    const n = mids.map((m, i) => unit(perp(sub(mids[Math.min(i + 1, 5)], mids[Math.max(i - 1, 0)]))));
    const wave = (m, i, s) => {
      const q = add(m, mul(n[i], s * w[i] + (i % 2 ? 0.7 : -0.5) * Math.min(i, 1)));
      return [q[0], Math.min(q[1], FLOOR - 1)];
    };
    const edge = mids.map((m, i) => wave(m, i, 1)).concat(mids.map((m, i) => wave(m, i, -1)).reverse());
    return shape(smooth(edge) + disc(tie, 1.5), COLORS.hair, hairLine);
  };
  const blush = (deg) => disc(polar(deg, 0.6), 1.25);

  const legLine = shade(COLORS.body, -0.3), skinLine = COLORS.skinLine;
  const tip = figure.tiptoe || "";
  const [legN, footN] = leg(j.kneeN, j.footN, 1, true, /N|both/.test(tip));
  const [legF, footF] = leg(j.kneeF, j.footF, -1, front, /F|both/.test(tip));
  const armN = arm(j.elbowN, j.handN, 1, true);
  const armF = arm(j.elbowF, j.handF, -1, front);
  const farLeg = front ? COLORS.body : COLORS.far, farSkin = front ? COLORS.skin : COLORS.skinFar;

  let head;
  if (front) {
    const eye = (x) => {
      const p = at(hc, face, up, x * R, -0.12 * R);
      return `M${pt(at(p, face, up, -0.9, 0))}Q${pt(at(p, face, up, 0, -0.7))} ${pt(at(p, face, up, 0.9, 0))}`;
    };
    head = pony(polar(78, 1.08), unit(add(mul(face, -0.9), mul(up, 0.7))))
      + shape(disc(polar(0, 0.97), 1.4) + disc(polar(180, 0.97), 1.4), COLORS.skin, skinLine)
      + shape(outline(FRONT_FACE), COLORS.skin, skinLine)
      + shape(outline(FRONT_HAIR), COLORS.hair, hairLine)
      + `<path d="${blush(-36) + blush(216)}" fill="${COLORS.cheek}" fill-opacity=".5"/>`
      + `<path d="${eye(-0.36) + eye(0.36)}" fill="none" stroke="#4a352c" stroke-width=".7" stroke-linecap="round"/>`;
  } else {
    const ear = polar(196, 0.2);
    const eye = polar(14, 0.6);
    head = pony(polar(112, 1.04), unit(add(mul(face, -1), mul(up, 0.5))))
      + shape(outline(FACE), COLORS.skin, skinLine)
      + shape(outline(HAIR), COLORS.hair, hairLine)
      + `<path d="${blush(-32)}" fill="${COLORS.cheek}" fill-opacity=".5"/>`
      + `<path d="M${pt(polar(72, 0.82))}Q${pt(polar(100, 1))} ${pt(polar(135, 0.88))}" fill="none" stroke="${shade(COLORS.hair, 0.3)}" stroke-width=".7" stroke-linecap="round"/>`
      + `<path d="M${pt(at(ear, face, up, 0, 1))}A1.1 1.5 0 1 0 ${pt(at(ear, face, up, 0, -1))}" fill="${COLORS.skin}" stroke="${skinLine}" stroke-width=".6"/>`
      + `<path d="M${pt(at(eye, face, up, -0.9, 0))}Q${pt(at(eye, face, up, 0, -0.6))} ${pt(at(eye, face, up, 0.9, 0))}" fill="none" stroke="#4a352c" stroke-width=".7" stroke-linecap="round"/>`;
  }

  const farArm = shape(armF, farSkin, shade(farSkin, -0.22));
  const farLegs = shape(legF, farLeg, shade(farLeg, -0.3)) + shape(footF, farSkin, shade(farSkin, -0.22));
  const nearLeg = shape(legN, COLORS.body, legLine) + shape(footN, COLORS.skin, skinLine);
  const nearArm = shape(armN, COLORS.skin, skinLine);
  const trunk = shape(neck, COLORS.skin, skinLine)
    + shape(torso, COLORS.body, legLine)
    + shape(top, COLORS.top, shade(COLORS.top, -0.28));
  const toHead = sub(j.handN, hc);
  const cupped = len(toHead) < R * 1.7 && dot(toHead, face) < R * 0.2;
  const overhead = dot(sub(j.handN, j.neck), up) > dot(sub(hc, j.neck), up) + R * 0.5
    && Math.min(gapTo(hc, add(j.neck, mul(down, 2.4)), j.elbowN), gapTo(hc, j.elbowN, j.handN)) < R + 1.2;
  const parts = front
    ? [farLegs, between, nearLeg, trunk, head, over, farArm, nearArm]
    : cupped || overhead
      ? [farArm, farLegs, between, trunk, nearLeg, nearArm, over, head]
      : [farArm, farLegs, between, trunk, nearLeg, head, over, nearArm];
  return parts.join("")
    + `<path d="${lit.join("")}" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width=".8" stroke-linecap="round"/>`;
}

const PROPS = {
  wall({ x }) {
    const w = 120 - x;
    return `<rect x="${x}" y="6" width="${w}" height="${FLOOR - 6}" fill="${COLORS.wall}"/>`
      + `<rect x="${x}" y="${FLOOR - 4}" width="${w}" height="4" fill="${shade(COLORS.wall, -0.07)}"/>`
      + `<path d="M${x} 6V${FLOOR}" stroke="${shade(COLORS.wall, -0.2)}" stroke-width="1.2"/>`;
  },
  chair({ x, w = 22, seatY: s = 78, back = "left" }) {
    const wood = shade(COLORS.chair, -0.35);
    const right = back === "right";
    const bx = right ? x + w - 1.2 : x + 1.2, lean = right ? 1.6 : -1.6;
    let frame = `M${x + 2.2} ${s + 1.6}L${x + 1.4} ${FLOOR}M${x + w - 2.2} ${s + 1.6}L${x + w - 1.4} ${FLOOR}M${x + 2} ${FLOOR - 9}H${x + w - 2}`;
    if (back !== "none") frame += `M${bx} ${s}L${bx + lean} ${s - 25}`;
    return `<path d="${frame}" fill="none" stroke="${wood}" stroke-width="1.9" stroke-linecap="round"/>`
      + `<rect x="${x - 0.6}" y="${s - 1.2}" width="${w + 1.2}" height="3" rx="1.4" fill="${COLORS.chair}" stroke="${wood}" stroke-width=".6"/>`
      + (back === "none" ? "" : `<rect x="${f(bx + lean * 0.8 - 1.6)}" y="${s - 25}" width="3.2" height="11" rx="1.5" fill="${COLORS.chair}" stroke="${wood}" stroke-width=".6"/>`);
  },
  desk({ x, w = 34, topY: t = 70 }) {
    const wood = shade(COLORS.chair, -0.35);
    return `<path d="M${x + 3} ${t}V${FLOOR}M${x + w - 3} ${t}V${FLOOR}" stroke="${wood}" stroke-width="2.2" stroke-linecap="round"/>`
      + `<rect x="${x + 1.5}" y="${t + 1.4}" width="${w - 3}" height="3.4" fill="${shade(COLORS.desk, -0.15)}"/>`
      + `<rect x="${x - 1}" y="${t - 1.6}" width="${w + 2}" height="3.2" rx="1" fill="${COLORS.desk}" stroke="${wood}" stroke-width=".6"/>`;
  },
  barre({ x, y = 62, w = 40, wall }) {
    const wood = shade(COLORS.chair, -0.35), x1 = x + w;
    const ends = wall
      ? `<path d="M${f(x + 4)} ${y}v4.5M${f(x1 - 4)} ${y}v4.5" stroke="#9a9ca6" stroke-width="1.3" stroke-linecap="round"/>`
        + `<rect x="${f(x + 2.6)}" y="${f(y + 4)}" width="2.8" height="2.4" rx=".8" fill="#b4b6be" stroke="#80828c" stroke-width=".5"/>`
        + `<rect x="${f(x1 - 5.4)}" y="${f(y + 4)}" width="2.8" height="2.4" rx=".8" fill="#b4b6be" stroke="#80828c" stroke-width=".5"/>`
      : `<path d="M${x + 2} ${y}V${FLOOR}M${x1 - 2} ${y}V${FLOOR}" stroke="${wood}" stroke-width="1.8"/>`
        + `<path d="M${x - 1} ${FLOOR - 0.6}h6M${x1 - 5} ${FLOOR - 0.6}h6" stroke="${wood}" stroke-width="1.4" stroke-linecap="round"/>`;
    return ends
      + `<path d="M${x} ${y}H${x1}" stroke="${wood}" stroke-width="3.2" stroke-linecap="round"/>`
      + `<path d="M${x} ${y}H${x1}" stroke="${COLORS.chair}" stroke-width="2.2" stroke-linecap="round"/>`
      + `<path d="M${x + 1} ${y - 0.5}H${x1 - 1}" stroke="#fff" stroke-opacity=".35" stroke-width=".5" stroke-linecap="round"/>`;
  },
  block({ at: [x, y] }) {
    const c = COLORS.block;
    return `<g stroke="${shade(c, -0.32)}" stroke-width=".55" stroke-linejoin="round">`
      + `<path d="M${x - 6} ${y - 4}l1.8 -1.8h12l-1.8 1.8z" fill="${shade(c, 0.35)}"/>`
      + `<path d="M${x + 6} ${y - 4}l1.8 -1.8v8l-1.8 1.8z" fill="${shade(c, -0.14)}"/>`
      + `<rect x="${x - 6}" y="${y - 4}" width="12" height="8" fill="${c}"/>`
      + `</g>`;
  },
  roller({ at: [x, y], len: l = 30, r = 4.5, rot = 0 }) {
    const c = COLORS.roller, line = shade(c, -0.32);
    if (l < r * 2.6) {
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="${shade(c, 0.2)}" stroke="${line}" stroke-width=".6"/>`
        + `<circle cx="${x}" cy="${y}" r="${f(r * 0.45)}" fill="none" stroke="${shade(c, -0.1)}" stroke-width=".6"/>`;
    }
    const x0 = f(x - l / 2), x1 = f(x + l / 2), e = f(r * 0.38);
    return `<g transform="rotate(${rot} ${x} ${y})" stroke="${line}" stroke-width=".6">`
      + `<path d="M${x0} ${y - r}H${x1}A${e} ${r} 0 0 1 ${x1} ${y + r}H${x0}A${e} ${r} 0 0 1 ${x0} ${y - r}Z" fill="${c}"/>`
      + `<path d="M${x0 + 1} ${f(y - r * 0.5)}H${x1 - 1}" stroke="#fff" stroke-opacity=".35" stroke-width="${f(r * 0.28)}" stroke-linecap="round"/>`
      + `<ellipse cx="${x1}" cy="${y}" rx="${e}" ry="${r}" fill="${shade(c, 0.25)}"/>`
      + `<ellipse cx="${x1}" cy="${y}" rx="${f(e * 0.45)}" ry="${f(r * 0.45)}" fill="none" stroke="${shade(c, -0.1)}"/>`
      + `</g>`;
  },
  ring({ at: [x, y], r = 4, rot, flat }) {
    const c = COLORS.ring, line = shade(c, -0.32);
    const w = r * (flat ? 0.2 : 0.62);
    const outline = smooth([[0, -1], [0.62, -0.9], [1, -0.52], [0.68, 0], [1, 0.52], [0.62, 0.9], [0, 1], [-0.62, 0.9], [-1, 0.52], [-0.68, 0], [-1, -0.52], [-0.62, -0.9]]
      .map(([a, b]) => [x + a * w, y + b * r]));
    const gleam = `M${pt([x - w * 0.75, y - r * 0.68])}Q${pt([x - w * 0.5, y - r * 0.98])} ${pt([x + w * 0.1, y - r * 0.98])}`;
    const rim = flat ? 1.3 : 1.6;
    return `<g transform="rotate(${rot ?? (flat ? 90 : 0)} ${x} ${y})" fill="none" stroke-linecap="round">`
      + `<path d="${outline}" stroke="${line}" stroke-width="${rim + 0.9}"/>`
      + `<path d="${outline}" stroke="${c}" stroke-width="${rim}"/>`
      + `<path d="${gleam}" stroke="#fff" stroke-opacity=".6" stroke-width=".5"/>`
      + `</g>`;
  },
  circle({ at: [x, y], rx = 11, ry = 11, rot = 0 }, j) {
    const c = COLORS.circle, line = shade(c, -0.32);
    const e = `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="none"`;
    const a = rot * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const limbs = j ? [j.kneeN, j.kneeF, j.footN, j.footF, j.handN, j.handF, j.elbowN, j.elbowF] : [];
    const rim = Array.from({ length: 48 }, (_, i) => {
      const t = i * Math.PI / 24, lx = Math.cos(t) * (rx + 0.4), ly = Math.sin(t) * (ry + 0.4);
      const q = [x + lx * ca - ly * sa, y + lx * sa + ly * ca];
      return { t, q, gap: Math.min(99, ...limbs.map((l) => len(sub(l, q)))) };
    });
    const best = rim.reduce((m, r) => r.gap < m.gap ? r : m);
    const apart = (r) => Math.abs(Math.atan2(Math.sin(r.t - best.t), Math.cos(r.t - best.t))) > 1.75;
    const other = rim.filter(apart).reduce((m, r) => r.gap < m.gap ? r : m);
    const spots = best.gap < 8 ? [best, other] : [rim[0], rim[24]];
    const pads = spots.map(({ t, q }) => {
      const deg = Math.atan2(Math.sin(t) / ry, Math.cos(t) / rx) * 180 / Math.PI + rot;
      return `<rect x="${f(q[0] - 1.8)}" y="${f(q[1] - 3.2)}" width="3.6" height="6.4" rx="1.5" transform="rotate(${f(deg)} ${f(q[0])} ${f(q[1])})"/>`;
    }).join("");
    return `<g transform="rotate(${rot} ${x} ${y})">`
      + e + ` stroke="${line}" stroke-width="3"/>`
      + e + ` stroke="${c}" stroke-width="2"/>`
      + `<path d="M${pt([x - rx * 0.71, y - ry * 0.71])}A${rx} ${ry} 0 0 1 ${x} ${y - ry}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width=".6" stroke-linecap="round"/>`
      + `</g>`
      + `<g fill="${shade(c, -0.22)}" stroke="${line}" stroke-width=".6">${pads}</g>`;
  },
  band({ path }) {
    const d = smooth(path, false), c = COLORS.band;
    return `<g fill="none" stroke-linecap="round" stroke-linejoin="round">`
      + `<path d="${d}" stroke="${shade(c, -0.25)}" stroke-width="2.6"/>`
      + `<path d="${d}" stroke="${c}" stroke-width="1.8"/>`
      + `<path d="${d}" stroke="#fff" stroke-opacity=".3" stroke-width=".45"/>`
      + `</g>`;
  },
  strap({ path }) {
    const d = "M" + path.map(pt).join("L"), c = COLORS.strap;
    const [a, b = a] = path, u = unit(sub(b, a), [1, 0]);
    const q = add(a, mul(u, Math.min(5, len(sub(b, a)) * 0.3)));
    return `<g fill="none" stroke-linejoin="round">`
      + `<path d="${d}" stroke="${shade(c, -0.35)}" stroke-width="2.9"/>`
      + `<path d="${d}" stroke="${c}" stroke-width="2.1"/>`
      + `<path d="${d}" stroke="#fff" stroke-opacity=".45" stroke-width=".35" stroke-dasharray="1.2 .9"/>`
      + `<path d="M-1 -2h1a2 2 0 0 1 0 4h-1z" transform="translate(${pt(q)}) rotate(${f(Math.atan2(u[1], u[0]) * 180 / Math.PI)})" stroke="#9a9ca6" stroke-width=".8"/>`
      + `</g>`;
  },
  ball({ at: p, r = 3.6, double }) {
    const c = COLORS.ball;
    const cs = double ? [[p[0] - r * 0.9, p[1]], [p[0] + r * 0.9, p[1]]] : [p];
    const each = (dx, dy, k) => cs.map((q) => disc([q[0] + dx * r, q[1] + dy * r], r * k)).join("");
    return shape(each(0, 0, 1), shade(c, -0.15), shade(c, -0.38), 0.7)
      + `<path d="${each(-0.2, -0.22, 0.74)}" fill="${c}"/>`
      + `<path d="${each(-0.36, -0.4, 0.24)}" fill="#fff" fill-opacity=".6"/>`;
  },
};

const BACK = new Set(["wall", "chair", "desk", "barre", "block", "roller"]);

function overFace(q, j) {
  if (q.type !== "band" && q.type !== "strap") return false;
  const hc = [j.head[0], Math.min(j.head[1], FLOOR + 0.4 - 6.8 * 1.08)];
  return q.path.some((a, i) => i && gapTo(hc, q.path[i - 1], a) < 6);
}

function drawProps(prop, j, pick) {
  if (!prop) return "";
  return [].concat(prop).filter((p) => PROPS[p.type] && pick(p)).map((p) => PROPS[p.type](p, j)).join("");
}

export function figureSVG(figure, opts = {}) {
  const j = figure.j;
  const size = opts.size || 120;
  const grounded = figure.floor !== false;
  const { front } = bodyFrame(figure);
  let floor = "";
  if (grounded) {
    const low = Object.values(j).filter((p) => p[1] > FLOOR - 7).map((p) => p[0]);
    floor = `<rect x="11" y="${FLOOR + 2.2}" width="98" height="2.4" rx="1.2" fill="${shade(COLORS.mat, -0.3)}" opacity=".35"/>`
      + `<rect x="10" y="${FLOOR}" width="100" height="3.4" rx="1.7" fill="${COLORS.mat}"/>`
      + (low.length ? `<ellipse cx="${f((Math.min(...low) + Math.max(...low)) / 2)}" cy="${FLOOR + 0.6}" rx="${f((Math.max(...low) - Math.min(...low)) / 2 + 5)}" ry="1.4" fill="#5b4636" opacity=".13"/>` : "");
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="${size}" height="${size}" role="img">`
    + drawProps(figure.prop, j, (p) => BACK.has(p.type) && !p.front && !(p.type === "barre" && front))
    + floor
    + body(figure,
      drawProps(figure.prop, j, (p) => (BACK.has(p.type) && p.front) || overFace(p, j)),
      drawProps(figure.prop, j, (p) => p.type === "barre" && front))
    + drawProps(figure.prop, j, (p) => !BACK.has(p.type) && !overFace(p, j))
    + `</svg>`;
}

export { FLOOR, COLORS };
