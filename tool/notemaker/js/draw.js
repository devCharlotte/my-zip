'use strict';
const HEX = /^#[0-9a-fA-F]{6}$/;
function rgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hexMix(a, b, t) {
  try {
    const A = rgb(a),
      B = rgb(b);
    return (
      '#' +
      A.map((v, i) =>
        Math.round(v * (1 - t) + B[i] * t)
          .toString(16)
          .padStart(2, '0')
      )
        .join('')
        .toUpperCase()
    );
  } catch (e) {
    return a;
  }
}
function schoolTheme(col) {
  if (!HEX.test(col || '')) return;
  cfg.accent = col;
  cfg.line = hexMix(col, '#FFFFFF', 0.74);
  cfg.bg = hexMix(col, '#FFFFFF', 0.975);
  cfg.ink = hexMix(col, '#151515', 0.72);
}
function mix(a, b, t) {
  try {
    const A = rgb(a),
      B = rgb(b);
    return 'rgb(' + A.map((v, i) => Math.round(v * (1 - t) + B[i] * t)).join(',') + ')';
  } catch (e) {
    return a;
  }
}

function kit(ctx, cfg) {
  const F = FONTS[cfg.font] || FONTS.gowun;
  const d = {
    ctx,
    cfg,
    F,
    A: cfg.accent,
    soft: t => mix(cfg.accent, cfg.bg, t),
    stroke(c, m = 1, st) {
      c = c || cfg.line;
      st = st || cfg.lineStyle;
      const lw = cfg.lw * m;
      ctx.strokeStyle = c;
      ctx.lineWidth = lw;
      ctx.lineCap = st === 'dotted' ? 'round' : 'butt';
      ctx.setLineDash(
        st === 'dashed'
          ? [lw * 6 + 0.9, lw * 4 + 0.7]
          : st === 'dotted'
            ? [0.001, lw * 3 + 0.7]
            : []
      );
    },
    line(x1, y1, x2, y2, c, m, st) {
      d.stroke(c, m, st);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    },
    path(x, y, w, h, r) {
      ctx.beginPath();
      if (r > 0 && ctx.roundRect) ctx.roundRect(x, y, w, h, r);
      else ctx.rect(x, y, w, h);
    },
    rect(x, y, w, h, o = {}) {
      d.path(x, y, w, h, o.r || 0);
      if (o.fill) {
        ctx.fillStyle = o.fill;
        ctx.fill();
      }
      if (o.stroke) {
        d.stroke(o.stroke, o.m || 1, o.st || 'solid');
        ctx.stroke();
      }
    },
    circle(x, y, r, o = {}) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (o.fill) {
        ctx.fillStyle = o.fill;
        ctx.fill();
      }
      if (o.stroke) {
        d.stroke(o.stroke, o.m || 1, 'solid');
        ctx.stroke();
      }
    },
    font(o) {
      return `${o.weight || 400} ${(o.size || 3) * F.mul}px ${o.font || F.css}`;
    },
    text(s, x, y, o = {}) {
      ctx.save();
      ctx.globalAlpha = o.alpha ?? 1;
      ctx.fillStyle = o.color || cfg.ink;
      ctx.textAlign = o.align || 'left';
      ctx.textBaseline = o.base || 'alphabetic';
      ctx.font = d.font(o);
      if (o.max > 0) ctx.fillText(String(s), x, y, o.max);
      else ctx.fillText(String(s), x, y);
      ctx.restore();
    },
    measure(s, o = {}) {
      ctx.save();
      ctx.font = d.font(o);
      const w = ctx.measureText(s).width;
      ctx.restore();
      return w;
    },
    label(s, x, y, o = {}) {
      d.text(s, x, y, Object.assign({ size: 2.7, weight: 700, color: cfg.accent }, o));
    },
    lines(x, y, w, h, o = {}) {
      const sp = o.sp || cfg.spacing;
      let n = 0;
      for (let yy = y + sp; yy <= y + h + 0.01; yy += sp) {
        d.line(x, yy, x + w, yy, o.c, o.m);
        n++;
      }
      return n;
    },
    check(x, y, s, c) {
      d.rect(x, y, s, s, { stroke: c || cfg.accent, m: 1.3, r: s * 0.2 });
    },
  };
  return d;
}
function split(b, n, land, gap = 8) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (land) {
      const w = (b.w - gap * (n - 1)) / n;
      out.push({ x: b.x + i * (w + gap), y: b.y, w, h: b.h });
    } else {
      const h = (b.h - gap * (n - 1)) / n;
      out.push({ x: b.x, y: b.y + i * (h + gap), w: b.w, h });
    }
  }
  return out;
}
function sep(d, blocks, land) {
  for (let i = 1; i < blocks.length; i++) {
    const p = blocks[i - 1];
    if (land) d.line(p.x + p.w + 4, p.y, p.x + p.w + 4, p.y + p.h, d.soft(0.5), 1, 'dashed');
    else d.line(p.x, p.y + p.h + 4, p.x + p.w, p.y + p.h + 4, d.soft(0.5), 1, 'dashed');
  }
}
function parseMonth(s) {
  const m = /^(\d{4})-(\d{2})$/.exec(s || '');
  return m ? [+m[1], +m[2]] : [now.getFullYear(), now.getMonth() + 1];
}

const T = {};
T.lined = (d, b) => {
  d.lines(b.x, b.y, b.w, b.h);
  if (d.cfg.marginLine) d.line(b.x + 14, b.y, b.x + 14, b.y + b.h, d.soft(0.45), 1.2, 'solid');
};
T.grid = (d, b) => {
  const s = d.cfg.spacing,
    c = Math.floor(b.w / s),
    r = Math.floor(b.h / s),
    gx = b.x + (b.w - c * s) / 2,
    gy = b.y + (b.h - r * s) / 2;
  for (let i = 0; i <= c; i++) {
    const mj = d.cfg.major && i % 5 === 0;
    d.line(gx + i * s, gy, gx + i * s, gy + r * s, mj ? d.soft(0.55) : null, mj ? 1.5 : 1);
  }
  for (let j = 0; j <= r; j++) {
    const mj = d.cfg.major && j % 5 === 0;
    d.line(gx, gy + j * s, gx + c * s, gy + j * s, mj ? d.soft(0.55) : null, mj ? 1.5 : 1);
  }
};
T.dot = (d, b) => {
  const s = d.cfg.spacing,
    c = Math.floor(b.w / s),
    r = Math.floor(b.h / s),
    gx = b.x + (b.w - c * s) / 2,
    gy = b.y + (b.h - r * s) / 2,
    rad = Math.max(0.22, d.cfg.lw * 0.9);
  for (let i = 0; i <= c; i++)
    for (let j = 0; j <= r; j++) d.circle(gx + i * s, gy + j * s, rad, { fill: d.cfg.line });
};
T.cornell = (d, b, land) => {
  const cw = b.w * (land ? 0.24 : 0.3),
    sh = b.h * 0.2,
    nh = b.h - sh - 4;
  d.label('KEYWORD', b.x, b.y + 3.6);
  d.label('NOTE', b.x + cw + 4, b.y + 3.6);
  d.lines(b.x + cw + 4, b.y + 5, b.w - cw - 4, nh - 5);
  d.lines(b.x, b.y + 5, cw - 3, nh - 5, { c: d.soft(0.85) });
  d.line(b.x + cw, b.y, b.x + cw, b.y + nh, d.A, 1.5, 'solid');
  const sy = b.y + nh + 4;
  d.line(b.x, sy, b.x + b.w, sy, d.A, 1.5, 'solid');
  d.label('SUMMARY', b.x, sy + 4.4);
  d.lines(b.x, sy + 5, b.w, sh - 5);
};
T.daily = (d, b, land) => {
  const c = d.cfg,
    sp = c.spacing,
    gap = land ? 7 : 5,
    L = (b.w - gap) * (land ? 0.48 : 0.5),
    R = b.w - gap - L,
    lx = b.x,
    rx = b.x + L + gap;
  const gH = sp * 2 + 7;
  d.rect(lx, b.y, L, gH, { stroke: d.A, m: 1.4, r: 2 });
  d.label('GOAL', lx + 3, b.y + 4.6);
  d.lines(lx + 3, b.y + 5, L - 6, gH - 6);
  const fH = Math.max(30, b.h * 0.2),
    ty = b.y + gH + 5,
    tB = b.y + b.h - fH - 4;
  d.label('TO DO', lx, ty + 3);
  d.text('TIME', lx + L - 6, ty + 3, { size: 2.2, align: 'center', color: d.A, weight: 700 });
  let y = ty + 5;
  d.line(lx, y, lx + L, y, d.A, 1.4, 'solid');
  const rh = Math.max(sp, 6);
  const y0 = y;
  while (y + rh <= tB + 0.01) {
    y += rh;
    if (c.checks) d.check(lx + 1, y - rh / 2 - 1.3, 2.6);
    d.line(lx, y, lx + L, y);
  }
  d.line(lx + L - 12, y0, lx + L - 12, y, null, 1);
  const fy = b.y + b.h - fH;
  d.rect(lx, fy, L, 10, { fill: d.soft(0.86), r: 2 });
  d.label('TOTAL', lx + 3, fy + 6.3);
  d.text('H', lx + L - 18, fy + 6.4, { size: 2.8, align: 'right', weight: 700, color: d.A });
  d.text('M', lx + L - 4, fy + 6.4, { size: 2.8, align: 'right', weight: 700, color: d.A });
  d.label('FEEDBACK', lx, fy + 15.5);
  d.lines(lx, fy + 16, L, fH - 16);
  const H = c.hours,
    top = b.y + 5,
    th = b.h - 5,
    rH = th / H,
    hc = 7,
    cw = (R - hc) / 6;
  d.label('TIME TABLE', rx, b.y + 3.4);
  for (let i = 1; i <= 6; i++)
    d.text(i * 10, rx + hc + cw * i - 0.6, b.y + 3.4, { size: 1.9, align: 'right', alpha: 0.55 });
  d.rect(rx, top, hc, th, { fill: d.soft(0.88) });
  for (let i = 0; i < H; i++) {
    const yy = top + i * rH;
    if (i) d.line(rx, yy, rx + R, yy, null, 1, 'solid');
    d.text((c.startHour + i) % 24, rx + hc / 2, yy + rH / 2 + 0.2, {
      size: Math.min(2.8, rH * 0.5),
      align: 'center',
      base: 'middle',
      weight: 700,
      color: d.A,
    });
  }
  for (let j = 1; j < 6; j++)
    d.line(
      rx + hc + cw * j,
      top,
      rx + hc + cw * j,
      top + th,
      null,
      1,
      j === 3 ? 'solid' : 'dotted'
    );
  d.line(rx + hc, top, rx + hc, top + th, d.A, 1.2, 'solid');
  d.rect(rx, top, R, th, { stroke: d.A, m: 1.4 });
};
const WK = { MON: '월', TUE: '화', WED: '수', THU: '목', FRI: '금', SAT: '토', SUN: '일' };
function weekNames(c) {
  const a = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  return c.weekStart === 'sun' ? ['SUN', ...a.slice(0, 6)] : a;
}
T.weekly = (d, b, land) => {
  const c = d.cfg,
    sp = c.spacing,
    cells = [...weekNames(c), 'MEMO'],
    cols = land ? 4 : 2,
    rows = 8 / cols,
    g = 3.5,
    cw = (b.w - g * (cols - 1)) / cols,
    ch = (b.h - g * (rows - 1)) / rows;
  cells.forEach((n, i) => {
    const x = b.x + (i % cols) * (cw + g),
      y = b.y + Math.floor(i / cols) * (ch + g),
      memo = n === 'MEMO';
    d.rect(x, y, cw, 6.5, { fill: d.soft(memo ? 0.75 : 0.88), r: 1.5 });
    d.text(n, x + 2.5, y + 4.6, {
      size: 2.8,
      weight: 700,
      color: n === 'SUN' ? RED : n === 'SAT' ? BLUE : d.A,
    });
    if (!memo) {
      d.text(WK[n], x + 2.5 + d.measure(n, { size: 2.8, weight: 700 }) + 1.5, y + 4.6, {
        size: 2.4,
        alpha: 0.6,
      });
      d.text('/', x + cw - 7, y + 4.6, { size: 2.8, alpha: 0.45 });
    }
    let yy = y + 6.5;
    while (yy + sp <= y + ch + 0.01) {
      yy += sp;
      if (c.checks && !memo) d.check(x + 1, yy - sp / 2 - 1.2, 2.4);
      d.line(x, yy, x + cw, yy);
    }
  });
};
T.monthly = (d, b, land) => {
  const c = d.cfg,
    [Y, M] = parseMonth(c.month),
    first = new Date(Y, M - 1, 1).getDay(),
    nd = new Date(Y, M, 0).getDate(),
    ws = c.weekStart === 'sun' ? 0 : 1,
    off = (first - ws + 7) % 7,
    rows = Math.ceil((off + nd) / 7),
    names = weekNames(c);
  const cal = { x: b.x, y: b.y, w: b.w, h: b.h };
  let side;
  if (land) {
    cal.w = b.w * 0.74;
    side = { x: b.x + cal.w + 6, y: b.y, w: b.w - cal.w - 6, h: b.h };
  } else {
    cal.h = b.h * 0.66;
    side = { x: b.x, y: b.y + cal.h + 6, w: b.w, h: b.h - cal.h - 6 };
  }
  const hh = 6.5,
    cw = cal.w / 7,
    rh = (cal.h - hh) / rows;
  d.rect(cal.x, cal.y, cal.w, hh, { fill: d.soft(0.85), r: 1.5 });
  names.forEach((n, i) =>
    d.text(n, cal.x + cw * i + cw / 2, cal.y + 4.5, {
      size: 2.5,
      weight: 700,
      align: 'center',
      color: n === 'SUN' ? RED : n === 'SAT' ? BLUE : d.A,
    })
  );
  for (let r = 1; r <= rows; r++)
    d.line(cal.x, cal.y + hh + r * rh, cal.x + cal.w, cal.y + hh + r * rh, null, 1, 'solid');
  for (let j = 1; j < 7; j++)
    d.line(cal.x + cw * j, cal.y + hh, cal.x + cw * j, cal.y + cal.h, null, 1, 'solid');
  for (let k = 0; k < nd; k++) {
    const idx = off + k,
      ci = idx % 7,
      ri = Math.floor(idx / 7),
      n = names[ci];
    d.text(k + 1, cal.x + ci * cw + 1.8, cal.y + hh + ri * rh + 4, {
      size: 2.8,
      weight: 700,
      color: n === 'SUN' ? RED : n === 'SAT' ? BLUE : c.ink,
    });
  }
  const box = (x, y, w, h, l) => {
    d.label(l, x, y + 3.6);
    d.line(x, y + 5, x + w, y + 5, d.A, 1.4, 'solid');
    d.lines(x, y + 5, w, h - 5);
  };
  if (land) {
    const h = (side.h - 6) / 2;
    box(side.x, side.y, side.w, h, 'GOAL');
    box(side.x, side.y + h + 6, side.w, h, 'MEMO');
  } else {
    const w = (side.w - 6) / 2;
    box(side.x, side.y, w, side.h, 'GOAL');
    box(side.x + w + 6, side.y, w, side.h, 'MEMO');
  }
};
function wrongBlock(d, bl) {
  const { x, y, w, h } = bl;
  let cy = y;
  d.label('출처', x, cy + 4);
  d.line(x + 9, cy + 5, x + w * 0.44, cy + 5, null, 1, 'solid');
  d.label('단원', x + w * 0.48, cy + 4);
  d.line(x + w * 0.48 + 9, cy + 5, x + w * 0.8, cy + 5, null, 1, 'solid');
  for (let i = 0; i < 3; i++)
    d.circle(x + w - 1.8 - i * 4.5, cy + 3.2, 1.6, { stroke: d.A, m: 1.2 });
  cy += 8;
  const rest = h - 8 - 9 - 3,
    pH = rest * 0.36,
    sH = rest * 0.38,
    kH = rest - pH - sH - 3;
  d.rect(x, cy, w, pH, { stroke: d.A, m: 1.2, st: 'dashed', r: 2 });
  d.label('Q.', x + 3, cy + 4.6, { size: 3.2 });
  cy += pH + 3;
  d.label('틀린 이유', x, cy + 4.2);
  let ix = x + d.measure('틀린 이유', { size: 2.7, weight: 700 }) + 4;
  ['개념 부족', '계산 실수', '문제 오독', '시간 부족', '찍음'].forEach(t => {
    const tw = d.measure(t, { size: 2.5 });
    if (ix + 4 + tw > x + w) return;
    d.check(ix, cy + 1.8, 2.5);
    d.text(t, ix + 3.4, cy + 4.1, { size: 2.5 });
    ix += 3.4 + tw + 3.5;
  });
  cy += 9;
  d.label('풀이', x, cy + 3.6);
  d.lines(x, cy + 4, w, sH - 4);
  cy += sH + 3;
  d.rect(x, cy, w, kH, { fill: d.soft(0.88), r: 2 });
  d.label('핵심 개념', x + 3, cy + 4.6);
  d.lines(x + 3, cy + 5, w - 6, kH - 6);
}
T.wrong = (d, b, land) => {
  const bl = split(b, d.cfg.repeat, land);
  bl.forEach(x => wrongBlock(d, x));
  sep(d, bl, land);
};
function fields(d, bl, list, lw) {
  const total = list.reduce((s, f) => s + f[1], 0);
  let cy = bl.y;
  d.line(bl.x, cy, bl.x + bl.w, cy, d.A, 1.6, 'solid');
  list.forEach(([lab, wt, kind], i) => {
    const fh = (bl.h * wt) / total;
    if (kind === 'tint') d.rect(bl.x, cy, bl.w, fh, { fill: d.soft(0.88) });
    d.text(lab, bl.x + 1.5, cy + Math.min(5, fh / 2 + 1.2), {
      size: 2.7,
      weight: 700,
      color: d.A,
      max: lw - 3,
    });
    if (kind === 'court') {
      const by = cy + fh * 0.62 + 1,
        cx = bl.x + lw,
        o = { size: 2.5, alpha: 0.55 };
      d.line(cx, by + 1, bl.x + bl.w, by + 1, null, 1, 'solid');
      d.text('법원', cx + 20, by, o);
      d.text('.', cx + 33, by, o);
      d.text('.', cx + 40, by, o);
      d.text('.', cx + 47, by, o);
      d.text('선고', cx + 50, by, o);
      d.text('판결', bl.x + bl.w - 1, by, Object.assign({ align: 'right' }, o));
    } else d.lines(bl.x + lw, cy, bl.w - lw, fh - 1.5);
    cy += fh;
    d.line(bl.x, cy, bl.x + bl.w, cy, d.A, i === list.length - 1 ? 1.6 : 0.9, 'solid');
  });
  d.line(bl.x + lw - 2, bl.y, bl.x + lw - 2, bl.y + bl.h, d.soft(0.6), 1, 'solid');
}
T.case = (d, b, land) => {
  const bl = split(b, d.cfg.repeat, land);
  bl.forEach(x =>
    fields(
      d,
      x,
      [
        ['사건', 0.75, 'court'],
        ['쟁점', 1.3],
        ['사실관계', 2],
        ['판시사항', 1.5],
        ['판결요지', 2.3],
        ['관련 조문', 0.8],
        ['나의 정리', 2, 'tint'],
      ],
      21
    )
  );
  sep(d, bl, land);
};
T.memorize = (d, b) => {
  const c = d.cfg,
    kw = b.w * 0.32,
    cc = 14,
    x = b.x,
    y = b.y,
    rh = Math.max(c.spacing, 6);
  d.rect(x, y, b.w, 7, { fill: d.soft(0.85), r: 1.5 });
  d.label('KEYWORD', x + 2, y + 4.7);
  d.label('내용', x + kw + 3, y + 4.7);
  d.label('회독', x + b.w - cc / 2, y + 4.7, { align: 'center' });
  let yy = y + 7;
  while (yy + rh <= y + b.h - 4 + 0.01) {
    yy += rh;
    d.line(x, yy, x + b.w, yy);
    for (let i = 0; i < 3; i++)
      d.circle(x + b.w - cc + 2.6 + i * 4.3, yy - rh / 2, 1.1, { stroke: c.line, m: 1.3 });
  }
  d.line(x + b.w - cc, y + 7, x + b.w - cc, yy, null, 1, 'solid');
  d.line(x + kw, y, x + kw, yy, d.A, 1.4, 'dashed');
  d.text('✂ 접어서 가리고 외우기', x + kw + 1.5, yy + 3.6, { size: 2.2, alpha: 0.6, color: d.A });
};
T.review = (d, b) => {
  const c = d.cfg,
    R = c.rounds,
    sw = b.w * 0.14,
    rw = b.w * 0.27,
    nw = b.w * 0.1,
    cw = (b.w - sw - rw - nw) / R,
    hh = 10,
    rh = Math.max(c.spacing, 7),
    x = b.x,
    y = b.y;
  d.rect(x, y, b.w, hh, { fill: d.soft(0.85) });
  const xs = [x, x + sw, x + sw + rw];
  for (let i = 0; i < R; i++) xs.push(x + sw + rw + cw * (i + 1));
  d.label('과목', x + sw / 2, y + 6, { align: 'center' });
  d.label('단원 / 범위', x + sw + rw / 2, y + 6, { align: 'center' });
  for (let i = 0; i < R; i++) {
    const cx = x + sw + rw + cw * i + cw / 2;
    d.label(`${i + 1}회독`, cx, y + 4.6, { align: 'center', size: 2.5 });
    d.text('월 / 일', cx, y + 8.2, { size: 1.9, align: 'center', alpha: 0.55 });
  }
  d.label('비고', x + b.w - nw / 2, y + 6, { align: 'center' });
  const n = Math.floor((b.h - hh) / rh),
    bot = y + hh + n * rh;
  const subs = (c.subjects || '')
    .split(/[,，]/)
    .map(s => s.trim())
    .filter(Boolean);
  for (let r = 1; r <= n; r++) {
    const yy = y + hh + r * rh;
    if (subs[r - 1])
      d.text(subs[r - 1], x + 2, yy - rh / 2 + 1, { size: 2.7, weight: 700, max: sw - 3 });
    d.line(x, yy, x + b.w, yy, null, 1, 'solid');
    for (let i = 0; i < R; i++)
      d.text('/', x + sw + rw + cw * i + cw / 2, yy - rh / 2 + 1, {
        size: 2.4,
        align: 'center',
        alpha: 0.22,
      });
  }
  xs.slice(1).forEach((vx, i) => d.line(vx, y, vx, bot, i === 1 ? d.soft(0.5) : null, 1, 'solid'));
  d.line(x, y + hh, x + b.w, y + hh, d.A, 1.3, 'solid');
  d.rect(x, y, b.w, bot - y, { stroke: d.A, m: 1.4 });
};
T.journal = (d, b, land) => {
  const c = d.cfg;
  let tb = { ...b },
    ta;
  if (land) {
    tb.w = b.w * 0.63;
    ta = { x: b.x + tb.w + 7, y: b.y, w: b.w - tb.w - 7, h: b.h };
  } else {
    tb.h = b.h * 0.62;
    ta = { x: b.x, y: b.y + tb.h + 7, w: b.w, h: b.h - tb.h - 7 };
  }
  const fr = [0.07, 0.12, 0.235, 0.17, 0.235, 0.17],
    xs = [tb.x];
  fr.forEach(f => xs.push(xs[xs.length - 1] + f * tb.w));
  const hh = 11,
    rh = Math.max(c.spacing, 6.5),
    n = Math.floor((tb.h - hh) / rh),
    bot = tb.y + hh + n * rh;
  d.rect(tb.x, tb.y, tb.w, hh, { fill: d.soft(0.85) });
  for (let r = 0; r < n; r++)
    if (r % 2) d.rect(tb.x, tb.y + hh + r * rh, tb.w, rh, { fill: d.soft(0.95) });
  d.label('No', (xs[0] + xs[1]) / 2, tb.y + 6.8, { align: 'center' });
  d.label('날짜', (xs[1] + xs[2]) / 2, tb.y + 6.8, { align: 'center' });
  d.label('차변 (Dr.)', (xs[2] + xs[4]) / 2, tb.y + 4.3, { align: 'center' });
  d.label('대변 (Cr.)', (xs[4] + xs[6]) / 2, tb.y + 4.3, { align: 'center' });
  [
    ['계정과목', 2],
    ['금액', 3],
    ['계정과목', 4],
    ['금액', 5],
  ].forEach(([t, i]) =>
    d.text(t, (xs[i] + xs[i + 1]) / 2, tb.y + 9.3, { size: 2.2, align: 'center', alpha: 0.7 })
  );
  d.line(xs[2], tb.y + 5.6, xs[6], tb.y + 5.6, d.soft(0.5), 1, 'solid');
  for (let r = 1; r <= n; r++) {
    const yy = tb.y + hh + r * rh;
    d.line(tb.x, yy, tb.x + tb.w, yy, null, 1, 'solid');
    [3, 5].forEach(i => {
      const w = xs[i + 1] - xs[i];
      for (let k = 1; k < 4; k++)
        d.line(
          xs[i + 1] - (w * k) / 4,
          yy - 1.1,
          xs[i + 1] - (w * k) / 4,
          yy,
          d.soft(0.55),
          1,
          'solid'
        );
    });
  }
  xs.slice(1, 6).forEach((vx, i) =>
    d.line(
      vx,
      i < 1 ? tb.y : i === 1 || i === 3 ? tb.y + 5.6 : tb.y,
      vx,
      bot,
      i === 3 ? d.A : null,
      i === 3 ? 1.2 : 1,
      'solid'
    )
  );
  d.line(xs[2], tb.y, xs[2], tb.y + 5.6, null, 1, 'solid');
  d.line(xs[4], tb.y, xs[4], tb.y + 5.6, d.A, 1.2, 'solid');
  d.line(tb.x, tb.y + hh, tb.x + tb.w, tb.y + hh, d.A, 1.3, 'solid');
  d.rect(tb.x, tb.y, tb.w, bot - tb.y, { stroke: d.A, m: 1.4 });
  d.label('T-ACCOUNT', ta.x, ta.y + 3.6);
  const cols = land ? 1 : 2,
    rows = land ? 3 : 2,
    g = 6,
    tw = (ta.w - g * (cols - 1)) / cols,
    th = (ta.h - 6 - g * (rows - 1)) / rows;
  for (let i = 0; i < cols * rows; i++) {
    const x = ta.x + (i % cols) * (tw + g),
      y = ta.y + 6 + Math.floor(i / cols) * (th + g),
      cx = x + tw / 2;
    d.line(cx - tw * 0.22, y + 4, cx + tw * 0.22, y + 4, null, 1, 'solid');
    d.line(x, y + 7, x + tw, y + 7, d.A, 1.5, 'solid');
    d.line(cx, y + 7, cx, y + th, d.A, 1.5, 'solid');
    d.text('차', x + 1, y + 10.5, { size: 2.3, alpha: 0.5 });
    d.text('대', x + tw - 1, y + 10.5, { size: 2.3, alpha: 0.5, align: 'right' });
  }
};
T.workout = (d, b, land) => {
  const c = d.cfg;
  let y = b.y;
  const bw = (b.w - 9) / 4;
  ['체중', '수면', '컨디션', '물'].forEach((t, i) => {
    const x = b.x + i * (bw + 3);
    d.rect(x, y, bw, 13, { stroke: d.soft(0.45), m: 1.2, r: 2 });
    d.label(t, x + 2.5, y + 4.4);
    if (i === 0) d.text('kg', x + bw - 2.5, y + 10.6, { size: 2.6, align: 'right', alpha: 0.6 });
    if (i === 1) d.text('h', x + bw - 2.5, y + 10.6, { size: 2.6, align: 'right', alpha: 0.6 });
    if (i === 2)
      for (let k = 0; k < 5; k++)
        d.circle(x + 3.5 + k * Math.min(4.2, (bw - 6) / 5), y + 9, 1.3, { stroke: d.A, m: 1.2 });
    if (i === 3)
      for (let k = 0; k < 8; k++) {
        const st = Math.min(3, (bw - 5) / 8);
        d.rect(x + 2.5 + k * st, y + 7.2, st * 0.7, 3.6, { stroke: d.A, m: 1, r: 0.4 });
      }
  });
  y += 17;
  d.label('PART', b.x, y + 3.6);
  let ix = b.x + 11;
  ['가슴', '등', '어깨', '하체', '팔', '코어', '유산소', '스트레칭'].forEach(t => {
    const tw = d.measure(t, { size: 2.6 });
    if (ix + 4 + tw > b.x + b.w) return;
    d.check(ix, y + 1.3, 2.5);
    d.text(t, ix + 3.4, y + 3.6, { size: 2.6 });
    ix += 3.4 + tw + 4;
  });
  y += 8;
  let tb, ml;
  if (land) {
    tb = { x: b.x, y, w: b.w * 0.66, h: b.y + b.h - y };
    ml = { x: b.x + tb.w + 6, y, w: b.w - tb.w - 6, h: tb.h };
  } else {
    const mh = b.h * 0.2;
    tb = { x: b.x, y, w: b.w, h: b.y + b.h - y - mh - 5 };
    ml = { x: b.x, y: b.y + b.h - mh, w: b.w, h: mh };
  }
  const S = c.sets,
    nw = tb.w * 0.28,
    ck = 7,
    sw = (tb.w - nw - ck) / S,
    hh = 8,
    rh = Math.max(c.spacing, 7.5),
    n = Math.floor((tb.h - hh) / rh),
    bot = tb.y + hh + n * rh;
  d.rect(tb.x, tb.y, tb.w, hh, { fill: d.soft(0.85) });
  d.label('EXERCISE', tb.x + 2, tb.y + 5.3);
  for (let i = 0; i < S; i++) {
    const cx = tb.x + nw + sw * i + sw / 2;
    d.label(`SET ${i + 1}`, cx, tb.y + 4, { align: 'center', size: 2.3 });
    d.text('kg × 회', cx, tb.y + 7, { size: 1.8, align: 'center', alpha: 0.55 });
  }
  d.label('✓', tb.x + tb.w - ck / 2, tb.y + 5.3, { align: 'center' });
  for (let r = 1; r <= n; r++)
    d.line(tb.x, tb.y + hh + r * rh, tb.x + tb.w, tb.y + hh + r * rh, null, 1, 'solid');
  for (let i = 0; i <= S; i++)
    d.line(
      tb.x + nw + sw * i,
      tb.y,
      tb.x + nw + sw * i,
      bot,
      i === 0 ? d.soft(0.5) : null,
      1,
      'solid'
    );
  d.line(tb.x, tb.y + hh, tb.x + tb.w, tb.y + hh, d.A, 1.3, 'solid');
  d.rect(tb.x, tb.y, tb.w, bot - tb.y, { stroke: d.A, m: 1.4 });
  const meals = ['아침', '점심', '저녁', '간식'];
  if (land) {
    const h = (ml.h - 9) / 4;
    meals.forEach((m, i) => {
      const yy = ml.y + i * (h + 3);
      d.rect(ml.x, yy, ml.w, h, { stroke: d.soft(0.45), m: 1.2, r: 2 });
      d.label(m, ml.x + 2.5, yy + 4.4);
      d.lines(ml.x + 2.5, yy + 4.5, ml.w - 5, h - 6, { sp: Math.min(c.spacing, 6.5) });
    });
  } else {
    const w = (ml.w - 9) / 4;
    meals.forEach((m, i) => {
      const xx = ml.x + i * (w + 3);
      d.rect(xx, ml.y, w, ml.h, { stroke: d.soft(0.45), m: 1.2, r: 2 });
      d.label(m, xx + 2.5, ml.y + 4.4);
      d.lines(xx + 2.5, ml.y + 4.5, w - 5, ml.h - 6, { sp: Math.min(c.spacing, 6.5) });
    });
  }
};
T.habit = (d, b, land) => {
  const c = d.cfg,
    nw = land ? 42 : 30,
    D = 31,
    cw = (b.w - nw) / D,
    hh = 7,
    fH = b.h * 0.18,
    rh = Math.max(c.spacing, 6.5),
    n = Math.floor((b.h - fH - 6 - hh) / rh),
    bot = b.y + hh + n * rh;
  d.rect(b.x, b.y, b.w, hh, { fill: d.soft(0.85) });
  d.label('HABIT', b.x + 2, b.y + 4.7);
  for (let i = 0; i < D; i++)
    d.text(i + 1, b.x + nw + cw * i + cw / 2, b.y + 4.7, {
      size: Math.min(2.4, cw * 0.55),
      align: 'center',
      color: d.A,
      weight: 700,
    });
  for (let r = 1; r <= n; r++)
    d.line(b.x, b.y + hh + r * rh, b.x + b.w, b.y + hh + r * rh, null, 1, 'solid');
  for (let i = 0; i <= D; i++)
    d.line(
      b.x + nw + cw * i,
      b.y,
      b.x + nw + cw * i,
      bot,
      i % 7 === 0 ? d.soft(0.5) : null,
      i % 7 === 0 ? 1.3 : 1,
      i % 7 === 0 ? 'solid' : c.lineStyle
    );
  d.line(b.x, b.y + hh, b.x + b.w, b.y + hh, d.A, 1.3, 'solid');
  d.rect(b.x, b.y, b.w, bot - b.y, { stroke: d.A, m: 1.4 });
  const fy = b.y + b.h - fH;
  d.label('이번 달 돌아보기', b.x, fy + 3.6);
  d.line(b.x, fy + 5, b.x + b.w, fy + 5, d.A, 1.4, 'solid');
  d.lines(b.x, fy + 5, b.w, fH - 5);
};

function table(d, b, cols, o = {}) {
  const c = d.cfg,
    hh = o.hh || 8,
    rh = o.rh || Math.max(c.spacing, 7),
    n = Math.max(1, Math.floor((b.h - hh - (o.foot || 0)) / rh)),
    bot = b.y + hh + n * rh;
  const tot = cols.reduce((s, k) => s + k.f, 0),
    xs = [b.x];
  cols.forEach(k => xs.push(xs[xs.length - 1] + (k.f / tot) * b.w));
  d.rect(b.x, b.y, b.w, hh, { fill: d.soft(0.85) });
  for (let r = 0; r < n; r++) {
    const yy = b.y + hh + r * rh;
    cols.forEach((k, i) => k.cell && k.cell(xs[i], yy, xs[i + 1] - xs[i], rh));
    d.line(b.x, yy + rh, b.x + b.w, yy + rh, null, 1, 'solid');
  }
  cols.forEach((k, i) => {
    const cx = (xs[i] + xs[i + 1]) / 2,
      mw = xs[i + 1] - xs[i] - 1.5;
    if (k.sub) {
      d.label(k.l, cx, b.y + hh * 0.47, { align: 'center', size: 2.4, max: mw });
      d.text(k.sub, cx, b.y + hh * 0.86, { size: 1.8, align: 'center', alpha: 0.55, max: mw });
    } else d.label(k.l, cx, b.y + hh * 0.62, { align: 'center', size: 2.5, max: mw });
    if (i) d.line(xs[i], b.y, xs[i], bot, k.strong ? d.A : null, k.strong ? 1.2 : 1, 'solid');
  });
  d.line(b.x, b.y + hh, b.x + b.w, b.y + hh, d.A, 1.3, 'solid');
  d.rect(b.x, b.y, b.w, bot - b.y, { stroke: d.A, m: 1.4 });
  return bot;
}
function cols(c, fb) {
  const a = (c.subjects || '')
    .split(/[,，]/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 10);
  return a.length ? a : fb;
}
T.ox = (d, b) => {
  const bot = table(
    d,
    b,
    [
      { l: '지문', f: 50 },
      {
        l: 'O / X',
        f: 7,
        cell: (x, y, w, h) =>
          d.text('O    X', x + w / 2, y + h / 2 + 0.9, { size: 2.4, align: 'center', alpha: 0.28 }),
      },
      {
        l: '틀린 횟수',
        f: 13,
        cell: (x, y, w, h) => {
          for (let i = 0; i < 4; i++)
            d.rect(x + w / 2 - 7.3 + i * 3.9, y + h / 2 - 1.4, 2.8, 2.8, {
              stroke: d.soft(0.4),
              m: 1.1,
              r: 0.5,
            });
        },
      },
      { l: '출제', sub: '연도·회차', f: 10 },
      { l: '근거', sub: '조문·판례', f: 20 },
    ],
    { foot: 6, hh: 9 }
  );
  d.text('틀린 횟수 3칸 이상은 시험 전날 다시 보기', b.x, bot + 4.6, {
    size: 2.3,
    alpha: 0.65,
    color: d.A,
  });
};
T.mock = (d, b) => {
  const s = cols(d.cfg, ['국어', '영어', '한국사', '과목 4', '과목 5']);
  table(
    d,
    b,
    [
      { l: '회차', f: 7 },
      { l: '날짜', f: 9 },
      ...s.map(x => ({ l: x, sub: '점수', f: 9 })),
      { l: '총점', f: 9, strong: true },
      { l: '과목 순서', sub: '푼 순서', f: 13 },
      { l: '메모', sub: '징크스·컨디션', f: Math.max(12, 44 - s.length * 5) },
    ],
    { hh: 10, rh: Math.max(d.cfg.spacing, 9) }
  );
};
T.fitness = (d, b) => {
  const s = cols(d.cfg, ['종목 1', '종목 2', '종목 3', '종목 4', '종목 5']);
  table(
    d,
    b,
    [
      { l: '날짜', f: 10 },
      ...s.map(x => ({ l: x, sub: '기록 · 점수', f: 12 })),
      {
        l: '컨디션',
        f: 12,
        cell: (x, y, w, h) => {
          for (let i = 0; i < 5; i++)
            d.circle(x + w / 2 - 4.8 + i * 2.4, y + h / 2, 0.85, { stroke: d.soft(0.35), m: 1.1 });
        },
      },
      { l: '수면', sub: '시간', f: 7 },
      { l: '메모', f: 20 },
    ],
    { hh: 10, rh: Math.max(d.cfg.spacing, 8.5) }
  );
};
T.blank = (d, b, land) => {
  const c = d.cfg,
    rw = land ? 42 : 34,
    mw = b.w - rw - 5,
    rx = b.x + mw + 5,
    sh = 13;
  d.label('주제', b.x, b.y + 4);
  d.line(b.x + 9, b.y + 5, b.x + mw, b.y + 5, null, 1, 'solid');
  d.lines(b.x, b.y + 7, mw, b.h - 7 - sh - 3);
  const sy = b.y + b.h - sh;
  d.rect(b.x, sy, mw, sh, { fill: d.soft(0.88), r: 2 });
  d.label('원문 확인', b.x + 3, sy + 4.8);
  let ix = b.x + 20;
  ['조문', '판례', '기출 OX'].forEach(t => {
    d.check(ix, sy + 2.6, 2.6);
    d.text(t, ix + 3.6, sy + 4.8, { size: 2.5 });
    ix += d.measure(t, { size: 2.5 }) + 9;
  });
  d.line(b.x + 3, sy + 10, b.x + mw - 3, sy + 10, d.soft(0.5), 1, 'solid');
  d.rect(rx, b.y, rw, b.h, { fill: d.soft(0.9), r: 2 });
  d.label('복습 주기', rx + 3, b.y + 5);
  const st = ['1일 뒤', '4일 뒤', '7일 뒤', '15일 뒤'],
    bh = (b.h - 9) / 4;
  st.forEach((t, i) => {
    const y = b.y + 8 + i * bh;
    d.text(t, rx + 3, y + 5, { size: 3.2, weight: 700, color: d.A });
    d.check(rx + rw - 6.5, y + 2.2, 3.2);
    d.text('월 / 일', rx + 3, y + 10, { size: 2.2, alpha: 0.55 });
    d.line(rx + 13, y + 10.6, rx + rw - 3, y + 10.6, c.line, 1, 'solid');
    d.text('빈칸 정답', rx + 3, y + 16, { size: 2.2, alpha: 0.55 });
    d.text('/', rx + rw - 9, y + 16, { size: 2.6, alpha: 0.55 });
    if (i < 3) d.line(rx + 3, y + bh - 1, rx + rw - 3, y + bh - 1, d.soft(0.6), 1, 'dashed');
  });
};
T.cycle = (d, b) => {
  const c = d.cfg,
    stages = [
      [24, '정독'],
      [12, '2배속'],
      [6, '틀린 것 위주'],
      [3, '틀린 것 위주'],
      [1, '전 범위 최종'],
    ],
    lh = 6.5,
    g = 2.5,
    rowsN = 6,
    ch = (b.h - stages.length * lh - (stages.length - 1) * g) / rowsN;
  let y = b.y;
  stages.forEach(([n, s]) => {
    d.text(`${n}일 회독`, b.x, y + 4.6, { size: 3, weight: 700, color: d.A });
    d.text(s, b.x + d.measure(`${n}일 회독`, { size: 3, weight: 700 }) + 3, y + 4.6, {
      size: 2.3,
      alpha: 0.6,
    });
    y += lh;
    const per = Math.min(n, 12),
      rows = Math.ceil(n / per),
      cw = b.w / per;
    for (let k = 0; k < n; k++) {
      const cx = b.x + (k % per) * cw,
        cy = y + Math.floor(k / per) * ch;
      d.rect(cx, cy, cw, ch, { stroke: c.line, m: 1 });
      d.text(`D${k + 1}`, cx + 1.4, cy + 3.4, { size: 2.1, weight: 700, color: d.A, alpha: 0.8 });
      d.check(cx + cw - 4, cy + 1.2, 2.6);
      d.line(cx + 1.4, cy + ch - 2.2, cx + cw - 1.4, cy + ch - 2.2, d.soft(0.6), 1, 'dotted');
      d.text('범위', cx + 1.4, cy + ch - 3.2, { size: 1.8, alpha: 0.45 });
    }
    y += rows * ch + g;
  });
};
T.answer = (d, b, land) => {
  const c = d.cfg,
    x = b.x;
  let y = b.y;
  [
    ['과목', 0, 0.3],
    ['문제', 0.32, 0.58],
    ['제한', 0.6, 0.78],
    ['실제', 0.8, 1],
  ].forEach(([l, a, e]) => {
    d.label(l, x + b.w * a, y + 4);
    d.line(
      x + b.w * a + 8,
      y + 5,
      x + b.w * e - (l.length && a >= 0.6 ? 5 : 0),
      y + 5,
      null,
      1,
      'solid'
    );
    if (a >= 0.6) d.text('분', x + b.w * e, y + 4, { size: 2.5, align: 'right', alpha: 0.6 });
  });
  y += 9;
  const fH = b.h * 0.17,
    top = { x, y, w: b.w, h: b.y + b.h - y - fH - 4 };
  let toc, ans;
  if (land) {
    toc = { x, y, w: b.w * 0.28, h: top.h };
    ans = { x: x + toc.w + 5, y, w: b.w - toc.w - 5, h: top.h };
  } else {
    toc = { x, y, w: b.w, h: top.h * 0.24 };
    ans = { x, y: y + toc.h + 4, w: b.w, h: top.h - toc.h - 4 };
  }
  d.rect(toc.x, toc.y, toc.w, toc.h, { stroke: d.soft(0.4), m: 1.2, r: 2 });
  d.label('쟁점 목차', toc.x + 3, toc.y + 4.6);
  d.text('쓰기 전에 먼저', toc.x + toc.w - 3, toc.y + 4.6, {
    size: 2.1,
    align: 'right',
    alpha: 0.55,
  });
  const R = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ'];
  let k = 0;
  for (let yy = toc.y + 5 + c.spacing; yy <= toc.y + toc.h - 1; yy += c.spacing) {
    d.line(toc.x + 7, yy, toc.x + toc.w - 3, yy);
    d.text(R[k % 10], toc.x + 3, yy - 1, { size: 2.3, weight: 700, color: d.A, alpha: 0.7 });
    k++;
  }
  d.label('답안', ans.x, ans.y + 3.6);
  let n = 0;
  for (let yy = ans.y + 5 + c.spacing; yy <= ans.y + ans.h + 0.01; yy += c.spacing) {
    n++;
    d.line(ans.x + 6, yy, ans.x + ans.w, yy);
    if (n % 5 === 0) d.text(n, ans.x + 4.4, yy - 1, { size: 1.9, align: 'right', alpha: 0.5 });
  }
  d.line(ans.x + 6, ans.y + 5, ans.x + 6, ans.y + ans.h, d.soft(0.55), 1, 'solid');
  const fy = b.y + b.h - fH;
  d.rect(x, fy, b.w, fH, { fill: d.soft(0.88), r: 2 });
  d.label('채점 · 빠뜨린 쟁점', x + 3, fy + 4.6);
  d.lines(x + 3, fy + 5, b.w - 6, fH - 6);
};
function calcBlock(d, bl) {
  const c = d.cfg,
    { x, y, w, h } = bl;
  let cy = y;
  d.label('출처', x, cy + 4);
  d.line(x + 9, cy + 5, x + w * 0.6, cy + 5, null, 1, 'solid');
  d.label('소요', x + w * 0.66, cy + 4);
  d.line(x + w * 0.66 + 9, cy + 5, x + w - 5, cy + 5, null, 1, 'solid');
  d.text('분', x + w, cy + 4, { size: 2.5, align: 'right', alpha: 0.6 });
  cy += 8;
  const ah = 10,
    rest = h - 8 - ah - 3 - 3,
    pH = rest * 0.28,
    gH = rest - pH - 3;
  d.rect(x, cy, w, pH, { stroke: d.A, m: 1.2, st: 'dashed', r: 2 });
  d.label('Q.', x + 3, cy + 4.6, { size: 3.2 });
  cy += pH + 3;
  d.label('손풀이', x, cy + 3.4);
  const s = 5,
    gy = cy + 5,
    gc = Math.floor(w / s),
    gr = Math.floor((gH - 5) / s),
    gx = x + (w - gc * s) / 2;
  for (let i = 0; i <= gc; i++)
    d.line(gx + i * s, gy, gx + i * s, gy + gr * s, d.soft(0.82), 0.8, 'solid');
  for (let j = 0; j <= gr; j++)
    d.line(gx, gy + j * s, gx + gc * s, gy + j * s, d.soft(0.82), 0.8, 'solid');
  cy += gH + 3;
  const bw = (w - 6) / 3;
  [
    ['내 답', 0],
    ['정답', 1],
    ['실수 포인트', 2],
  ].forEach(([l, i]) => {
    const bx = x + i * (bw + 3);
    d.rect(bx, cy, bw, ah, {
      fill: i === 2 ? d.soft(0.88) : null,
      stroke: d.soft(0.45),
      m: 1.2,
      r: 2,
    });
    d.label(l, bx + 2.5, cy + 4.2, { size: 2.4 });
  });
}
T.calc = (d, b, land) => {
  const bl = split(b, d.cfg.repeat, land);
  bl.forEach(x => calcBlock(d, x));
  sep(d, bl, land);
};

function chipRow(d, x, y, w, label, items, o = {}) {
  const s = o.size || 2.5,
    lw = d.measure(label, { size: 2.7, weight: 700 }) + 4;
  d.label(label, x, y + 3.6);
  let ix = x + lw,
    yy = y;
  items.forEach(t => {
    const tw = d.measure(t, { size: s });
    if (ix + 4 + tw > x + w) {
      ix = x + lw;
      yy += 5.5;
    }
    d.check(ix, yy + 1.4, 2.5);
    d.text(t, ix + 3.4, yy + 3.6, { size: s });
    ix += 3.4 + tw + 3.6;
  });
  return yy - y + 7;
}
function blankRow(d, x, y, w, items) {
  let ix = x;
  items.forEach(([l, f, unit]) => {
    const ww = w * f;
    d.label(l, ix, y + 4);
    const lx = ix + d.measure(l, { size: 2.7, weight: 700 }) + 2;
    d.line(lx, y + 5, ix + ww - 4 - (unit ? 4 : 0), y + 5, null, 1, 'solid');
    if (unit) d.text(unit, ix + ww - 4, y + 4, { size: 2.4, align: 'right', alpha: 0.6 });
    ix += ww;
  });
}
const CIRCUIT = {
  police: {
    st: [
      ['장애물코스 달리기', '340m × 6바퀴 · 매트 1.5m·허들 0.6m·계단 5단 · 1.5m 장벽은 2바퀴째만'],
      ['장대허들 넘기', '0.9m 허들 · 엎드렸다 일어나 넘고 뒤로 눕기 × 3회'],
      ['당기기·밀기', '32kg 기구 · 당기며 반원 3회 + 밀며 반원 3회'],
      ['구조하기', '72kg 인형 10.7m 끌기'],
      ['방아쇠 당기기', '주 사용손 16회 · 반대손 15회'],
    ],
    cols: [
      ...[1, 2, 3, 4, 5, 6].map(i => ({ l: `${i}바퀴`, sub: i === 2 ? '장벽 포함' : '랩', f: 6 })),
      { l: '장대허들', sub: '3회', f: 7 },
      { l: '당기기·밀기', sub: '3+3', f: 8 },
      { l: '구조하기', sub: '10.7m', f: 7 },
      { l: '방아쇠', sub: '16+15', f: 7 },
    ],
    goal: '440초 (4:40) 이하',
    note: '4.2kg 조끼 착용 · 1~5번을 쉬지 않고 연속 · 4:40 이하 우수(합격) · 4:40~5:10 보통, 5:10 초과 미흡(불합격) · 6분 넘으면 실격 가능 · 콘 건드리면 원위치, 허들 바 떨어뜨리면 첫 장애물부터',
  },
  fire: {
    st: [
      ['당기기', ''],
      ['오르기', ''],
      ['끌기', ''],
      ['다시 당기기', ''],
      ['옮기기', ''],
    ],
    cols: ['당기기', '오르기', '끌기', '다시 당기기', '옮기기'].map((l, i) => ({
      l,
      sub: `${i + 1}과정`,
      f: 9,
    })),
    goal: '',
    note: '2028년 재직자부터 도입 예정 · 신규 채용 적용 시기와 세부 기준은 아직 발표 전',
  },
};
function wrap(d, s, maxW, o) {
  const out = [];
  let cur = '';
  s.split(' · ').forEach(seg => {
    const t = cur ? cur + ' · ' + seg : seg;
    if (cur && d.measure(t, o) > maxW) {
      out.push(cur);
      cur = seg;
    } else cur = t;
  });
  if (cur) out.push(cur);
  return out;
}
function arrow(d, x1, y, x2) {
  d.line(x1, y, x2 - 1, y, d.cfg.accent, 1.5, 'solid');
  const ctx = d.ctx;
  ctx.beginPath();
  ctx.moveTo(x2, y);
  ctx.lineTo(x2 - 1.8, y - 1.2);
  ctx.lineTo(x2 - 1.8, y + 1.2);
  ctx.closePath();
  ctx.fillStyle = d.cfg.accent;
  ctx.fill();
}
function policeFlow(d, b) {
  const c = d.cfg;
  let y = b.y;
  d.label('1  장애물코스 달리기', b.x, y + 3.6, { size: 2.9 });
  d.text(
    '6바퀴 · 총 340m · 바퀴마다 매트(1.5m) · 허들(0.6m) · 계단(5단, 한 발에 한 칸)',
    b.x + d.measure('1  장애물코스 달리기', { size: 2.9, weight: 700 }) + 4,
    y + 3.6,
    { size: 2.2, alpha: 0.75 }
  );
  y += 6;
  const g = 3.5,
    lw = (b.w - g * 5) / 6,
    lh = 14;
  for (let i = 0; i < 6; i++) {
    const x = b.x + i * (lw + g),
      wall = i === 1;
    d.rect(x, y, lw, lh, {
      fill: d.soft(wall ? 0.78 : 0.88),
      stroke: wall ? c.accent : null,
      m: 1.3,
      r: 2,
    });
    d.text(`${i + 1}바퀴`, x + 2.5, y + 4.6, { size: 2.8, weight: 700, color: c.accent });
    d.check(x + lw - 5, y + 1.8, 2.8);
    d.text('매트 · 허들 · 계단', x + 2.5, y + 8.6, { size: 2.1, alpha: 0.8, max: lw - 4 });
    if (wall)
      d.text('+ 1.5m 장벽 (이 바퀴만)', x + 2.5, y + 12.2, {
        size: 2.15,
        weight: 700,
        color: c.accent,
        max: lw - 4,
      });
    else
      d.text(i === 5 ? '끝나면 바로 2번' : '', x + 2.5, y + 12.2, {
        size: 2.1,
        alpha: 0.6,
        max: lw - 4,
      });
    if (i < 5) arrow(d, x + lw + 0.6, y + lh / 2, x + lw + g - 0.6);
  }
  y += lh + 5;
  const sg = 4,
    sw = (b.w - sg * 3) / 4,
    sh = 19;
  const st = [
    [
      '2  장대허들 넘기',
      '0.9m · 엎드림 → 일어나 짚고 넘기 → 뒤로 눕기',
      [
        ['1회', 1],
        ['2회', 1],
        ['3회', 1],
      ],
    ],
    [
      '3  당기기·밀기',
      '32kg 기구 · 빨간 표시 보이면 실패',
      [
        ['당기며 반원', 3],
        ['밀며 반원', 3],
      ],
    ],
    ['4  구조하기', '72kg 인형 · 10.7m · 인형 전체가 도착선 안으로', [['도착', 1]]],
    [
      '5  방아쇠 당기기',
      '지름 23cm 원 안에 총구',
      [
        ['주 사용손', 16],
        ['반대손', 15],
      ],
    ],
  ];
  st.forEach(([t, sub, ticks], i) => {
    const x = b.x + i * (sw + sg);
    d.rect(x, y, sw, sh, { fill: d.soft(0.88), r: 2 });
    d.text(t, x + 2.5, y + 4.6, { size: 2.8, weight: 700, color: c.accent, max: sw - 4 });
    d.text(sub, x + 2.5, y + 8.4, { size: 2.05, alpha: 0.75, max: sw - 4 });
    let ty = y + 12;
    ticks.forEach(([l, n], k) => {
      const yy = ty + k * (ticks.length > 2 ? 0 : 3.4);
      const lx = ticks.length > 2 ? x + 2.5 + k * ((sw - 5) / 3) : x + 2.5;
      d.text(l, lx, yy + 1.2 + (ticks.length > 2 ? 0 : 0), { size: 2.05, weight: 700 });
      const sx = lx + d.measure(l, { size: 2.05, weight: 700 }) + 1.6,
        step = n > 6 ? Math.min(1.9, (x + sw - 3 - sx) / n) : 3;
      for (let q = 0; q < n; q++) {
        if (n > 6)
          d.rect(sx + q * step, yy - 0.6, step * 0.72, 1.9, { stroke: c.accent, m: 0.9, r: 0.3 });
        else d.circle(sx + 1 + q * step, yy + 0.35, 1, { stroke: c.accent, m: 1.1 });
      }
    });
    if (i < 3) arrow(d, x + sw + 0.6, y + sh / 2, x + sw + sg - 0.6);
  });
  return y + sh + 2.5;
}
T.circuit = (d, b, land) => {
  const c = d.cfg,
    police = c.circuit !== 'fire',
    K = CIRCUIT[police ? 'police' : 'fire'];
  let y;
  if (police) y = policeFlow(d, b);
  else {
    y = b.y;
    const n = K.st.length,
      g = 5,
      bw = (b.w - g * (n - 1)) / n,
      sh = 12;
    K.st.forEach(([s], i) => {
      const x = b.x + i * (bw + g);
      d.rect(x, y, bw, sh, { fill: d.soft(0.86), r: 2 });
      d.circle(x + 4, y + 6, 2.5, { fill: c.accent });
      d.text(i + 1, x + 4, y + 6.1, {
        size: 2.5,
        weight: 700,
        color: c.bg,
        align: 'center',
        base: 'middle',
      });
      d.text(s, x + 8, y + 7, { size: 2.8, weight: 700, max: bw - 10 });
      if (i < n - 1) arrow(d, x + bw + 0.6, y + sh / 2, x + bw + g - 0.6);
    });
    y += sh + 2.5;
  }
  const nl = wrap(d, K.note, b.w - 60, { size: 2.2 });
  nl.forEach((t, j) => d.text(t, b.x, y + 3.2 + j * 3, { size: 2.2, alpha: 0.75 }));
  d.label('목표 기록', b.x + b.w - 46, y + 3.2);
  if (K.goal) d.text(K.goal, b.x + b.w, y + 3.2, { size: 2.6, weight: 700, align: 'right' });
  else d.line(b.x + b.w - 32, y + 4, b.x + b.w, y + 4, null, 1, 'solid');
  y += Math.max(1, nl.length) * 3 + 4;
  const foot = land ? 0 : 30;
  table(
    d,
    { x: b.x, y, w: b.w, h: b.y + b.h - y - foot },
    [
      { l: '날짜', f: 8 },
      ...K.cols,
      { l: '총 기록', sub: '분 : 초', f: 9, strong: true },
      { l: '목표 대비', sub: '+ / −', f: 8 },
      { l: '메모', sub: '느린 구간', f: 14 },
    ],
    { hh: 10, rh: Math.max(c.spacing, 8) }
  );
  if (foot) {
    const fy = b.y + b.h - 26;
    d.label('느린 구간과 다음 훈련', b.x, fy + 3.6);
    d.line(b.x, fy + 5, b.x + b.w, fy + 5, c.accent, 1.4, 'solid');
    d.lines(b.x, fy + 5, b.w, 21);
  }
};
const FIRE6 = {
  m: [
    [
      '악력',
      'kg',
      [
        '45.3~48.0',
        '48.1~50.0',
        '50.1~51.5',
        '51.6~52.8',
        '52.9~54.1',
        '54.2~55.4',
        '55.5~56.7',
        '56.8~58.0',
        '58.1~59.9',
        '60.0~',
      ],
    ],
    [
      '배근력',
      'kg',
      [
        '147~153',
        '154~158',
        '159~165',
        '166~169',
        '170~173',
        '174~178',
        '179~185',
        '186~194',
        '195~205',
        '206~',
      ],
    ],
    [
      '앉아윗몸앞으로굽히기',
      'cm',
      [
        '16.1~17.3',
        '17.4~18.3',
        '18.4~19.8',
        '19.9~20.6',
        '20.7~21.6',
        '21.7~22.4',
        '22.5~23.2',
        '23.3~24.2',
        '24.3~25.7',
        '25.8~',
      ],
    ],
    [
      '제자리멀리뛰기',
      'cm',
      [
        '223~231',
        '232~236',
        '237~239',
        '240~242',
        '243~245',
        '246~249',
        '250~254',
        '255~257',
        '258~262',
        '263~',
      ],
    ],
    ['윗몸일으키기', '회/분', ['43', '44', '45', '46', '47', '48', '49', '50', '51', '52~']],
    [
      '왕복오래달리기',
      '회',
      ['57~59', '60~61', '62~63', '64~67', '68~71', '72~74', '75', '76', '77', '78~'],
    ],
  ],
  f: [
    [
      '악력',
      'kg',
      [
        '27.6~28.9',
        '29.0~30.2',
        '30.3~31.1',
        '31.2~31.9',
        '32.0~32.9',
        '33.0~33.7',
        '33.8~34.6',
        '34.7~35.7',
        '35.8~36.9',
        '37.0~',
      ],
    ],
    [
      '배근력',
      'kg',
      [
        '85~91',
        '92~95',
        '96~98',
        '99~101',
        '102~104',
        '105~107',
        '108~110',
        '111~114',
        '115~120',
        '121~',
      ],
    ],
    [
      '앉아윗몸앞으로굽히기',
      'cm',
      [
        '19.5~20.6',
        '20.7~21.6',
        '21.7~22.6',
        '22.7~23.4',
        '23.5~24.8',
        '24.9~25.4',
        '25.5~26.1',
        '26.2~26.7',
        '26.8~27.9',
        '28.0~',
      ],
    ],
    [
      '제자리멀리뛰기',
      'cm',
      [
        '160~164',
        '165~168',
        '169~172',
        '173~176',
        '177~180',
        '181~184',
        '185~188',
        '189~193',
        '194~198',
        '199~',
      ],
    ],
    ['윗몸일으키기', '회/분', ['33', '34', '35', '36', '37', '38', '39', '40', '41', '42~']],
    [
      '왕복오래달리기',
      '회',
      ['28', '29~30', '31', '32~33', '34~36', '37~39', '40', '41', '42', '43~'],
    ],
  ],
};
T.fire6 = (d, b, land) => {
  const c = d.cfg,
    D = FIRE6[c.sex === 'f' ? 'f' : 'm'],
    x = b.x;
  let y = b.y;
  d.label(
    `점수표 (${c.sex === 'f' ? '여자' : '남자'}) · 종목당 1~10점 · 6종목 60점 만점 · 30점 이상 합격`,
    x,
    y + 3.6,
    { size: 2.7 }
  );
  y += 5.5;
  const nw = b.w * 0.17,
    uw = b.w * 0.05,
    cw = (b.w - nw - uw) / 10,
    hh = 6,
    rh = land ? 5.6 : 6.2;
  d.rect(x, y, b.w, hh, { fill: d.soft(0.82) });
  d.text('종목', x + 2, y + 4.2, { size: 2.3, weight: 700, color: c.accent });
  d.text('단위', x + nw + uw / 2, y + 4.2, { size: 2.1, align: 'center', alpha: 0.7 });
  for (let k = 0; k < 10; k++)
    d.text(`${k + 1}점`, x + nw + uw + cw * k + cw / 2, y + 4.2, {
      size: 2.3,
      weight: 700,
      align: 'center',
      color: k === 9 ? c.accent : c.ink,
    });
  D.forEach(([n, u, v], r) => {
    const yy = y + hh + r * rh;
    if (r % 2) d.rect(x, yy, b.w, rh, { fill: d.soft(0.94) });
    d.text(n, x + 2, yy + rh / 2 + 0.9, { size: 2.3, weight: 700, max: nw - 3 });
    d.text(u, x + nw + uw / 2, yy + rh / 2 + 0.9, { size: 2, align: 'center', alpha: 0.7 });
    v.forEach((t, k) =>
      d.text(t, x + nw + uw + cw * k + cw / 2, yy + rh / 2 + 0.9, {
        size: 2.15,
        align: 'center',
        max: cw - 1,
      })
    );
  });
  const th = hh + 6 * rh;
  for (let k = 0; k <= 10; k++)
    d.line(x + nw + uw + cw * k, y, x + nw + uw + cw * k, y + th, null, 1, 'solid');
  d.line(x + nw, y, x + nw, y + th, null, 1, 'solid');
  d.rect(x, y, b.w, th, { stroke: c.accent, m: 1.3 });
  y += th + 2;
  d.text(
    '출처: 인천소방본부 안내(2023.10 갱신, 소방공무원임용령 근거) · 응시하는 시·도 공고로 최신 기준을 꼭 확인하세요',
    x,
    y + 2.6,
    { size: 2, alpha: 0.6 }
  );
  y += 7;
  table(
    d,
    { x, y, w: b.w, h: b.y + b.h - y },
    [
      { l: '날짜', f: 8 },
      ...D.map(([n]) => ({
        l: n,
        sub: '기록 / 점수',
        f: 11,
        cell: (cx, cy, w, h) =>
          d.line(cx + w * 0.62, cy + h - 1.2, cx + w * 0.72, cy + 1.2, d.soft(0.6), 1, 'solid'),
      })),
      { l: '총점', sub: '/ 60', f: 7, strong: true },
      {
        l: '합격',
        sub: '30점 이상',
        f: 7,
        cell: (cx, cy, w, h) => d.check(cx + w / 2 - 1.3, cy + h / 2 - 1.3, 2.6),
      },
      { l: '메모', f: 12 },
    ],
    { hh: 9, rh: Math.max(c.spacing, 7.5) }
  );
};
T.sheet = (d, b) => {
  const c = d.cfg;
  blankRow(d, b.x, b.y, b.w, [
    ['과목', 0.32],
    ['문제', 0.3],
    ['시간', 0.2, '분'],
    ['쪽', 0.18],
  ]);
  const y = b.y + 9,
    h = b.h - 9;
  d.rect(b.x, y, b.w, h, { stroke: c.accent, m: 1.4 });
  d.line(b.x + 9, y, b.x + 9, y + h, d.soft(0.5), 1, 'solid');
  let n = 0;
  for (let yy = y + c.spacing; yy <= y + h - 0.5; yy += c.spacing) {
    n++;
    d.line(b.x + 9, yy, b.x + b.w, yy);
    d.text(n, b.x + 7, yy - 1.2, { size: 2, align: 'right', alpha: 0.5 });
  }
};
T.record = (d, b) => {
  let y = b.y;
  y += chipRow(d, b.x, y, b.w, '문서', [
    '소장',
    '답변서',
    '준비서면',
    '공소장',
    '검토의견서',
    '변론요지서',
  ]);
  fields(
    d,
    { x: b.x, y: y + 1, w: b.w, h: b.y + b.h - y - 1 },
    [
      ['당사자·사건', 0.9],
      ['청구취지·공소사실', 1.8],
      ['청구원인·쟁점 검토', 3.4],
      ['결론', 1.1],
      ['입증·첨부', 0.8],
      ['놓친 점', 1.3, 'tint'],
    ],
    30
  );
};
const TOEIC = [
  ['Part 1', 6],
  ['Part 2', 25],
  ['Part 3', 39],
  ['Part 4', 30],
  ['Part 5', 30],
  ['Part 6', 16],
  ['Part 7', 54],
];
T.toeic = (d, b, land) => {
  const c = d.cfg;
  let y = b.y;
  const g = 2,
    bw = (b.w - g * 6) / 7;
  TOEIC.forEach(([p, q], i) => {
    const x = b.x + i * (bw + g);
    d.rect(x, y, bw, 11, { fill: d.soft(i < 4 ? 0.88 : 0.78), r: 1.5 });
    d.text(p, x + bw / 2, y + 4.3, { size: 2.6, weight: 700, align: 'center', color: c.accent });
    d.text(`틀림      / ${q}`, x + bw / 2, y + 8.8, { size: 2.1, align: 'center', alpha: 0.7 });
  });
  d.text('LC', b.x, y + 14.6, { size: 2.1, weight: 700, alpha: 0.55 });
  d.text('RC', b.x + 4 * (bw + g), y + 14.6, { size: 2.1, weight: 700, alpha: 0.55 });
  y += 17;
  const vh = land ? 0 : b.h * 0.24,
    tw = land ? b.w * 0.66 : b.w;
  table(
    d,
    { x: b.x, y, w: tw, h: b.y + b.h - y - (land ? 0 : vh + 5) },
    [
      { l: '번호', f: 7 },
      { l: 'Part', f: 7 },
      { l: '유형', sub: '문법·어휘·추론', f: 14 },
      {
        l: '내 답 / 정답',
        f: 11,
        cell: (x, yy, w, h) =>
          d.text('/', x + w / 2, yy + h / 2 + 1, { size: 2.4, align: 'center', alpha: 0.3 }),
      },
      { l: '틀린 이유', f: 20 },
      { l: '근거 문장·핵심 표현', f: 41 },
    ],
    { hh: 9, rh: Math.max(c.spacing, 8) }
  );
  const vb = land
    ? { x: b.x + tw + 5, y, w: b.w - tw - 5, h: b.y + b.h - y }
    : { x: b.x, y: b.y + b.h - vh, w: b.w, h: vh };
  d.label('VOCA', vb.x, vb.y + 3.6);
  d.line(vb.x, vb.y + 5, vb.x + vb.w, vb.y + 5, c.accent, 1.4, 'solid');
  const cn = land ? 1 : 2,
    cw = (vb.w - (cn - 1) * 5) / cn;
  for (let k = 0; k < cn; k++) {
    const x = vb.x + k * (cw + 5);
    d.lines(x, vb.y + 5, cw, vb.h - 5);
    d.line(x + cw * 0.4, vb.y + 5, x + cw * 0.4, vb.y + vb.h, d.soft(0.6), 1, 'dashed');
  }
};
T.opic = (d, b) => {
  const c = d.cfg;
  let y = b.y;
  d.label('주제', b.x, y + 4);
  d.line(b.x + 9, y + 5, b.x + b.w * 0.55, y + 5, null, 1, 'solid');
  let gx = b.x + b.w * 0.6;
  d.label('목표', gx, y + 4);
  gx += 10;
  ['IM2', 'IM3', 'IH', 'AL'].forEach(t => {
    d.circle(gx + 1.3, y + 2.9, 1.3, { stroke: c.accent, m: 1.2 });
    d.text(t, gx + 3.6, y + 4, { size: 2.5 });
    gx += d.measure(t, { size: 2.5 }) + 7;
  });
  y += 8;
  {
    const seq = [
        ['1', '자기소개'],
        ['2–4', '설문 콤보'],
        ['5–7', '설문·돌발 콤보'],
        ['↻', '난이도 재선택'],
        ['8–10', '돌발 콤보'],
        ['11–13', '롤플레이'],
        ['14–15', '어드밴스'],
      ],
      g = 1.5,
      sw = (b.w - g * 6) / 7;
    seq.forEach(([n, l], i) => {
      const x = b.x + i * (sw + g);
      d.rect(x, y, sw, 9, {
        fill: d.soft(n === '↻' ? 0.95 : 0.86),
        stroke: n === '↻' ? d.soft(0.5) : null,
        st: 'dashed',
        m: 1,
        r: 1.5,
      });
      d.text(n, x + sw / 2, y + 3.8, { size: 2.5, weight: 700, align: 'center', color: c.accent });
      d.text(l, x + sw / 2, y + 7.4, { size: 2, align: 'center', max: sw - 1.5 });
    });
    y += 11;
    d.text(
      '난이도 1~2는 12문항, 3~6은 15문항 · 14~15번 어드밴스는 5~6 선택 시 · 콤보는 보통 묘사로 시작해 과거 경험으로 끝나요',
      b.x,
      y + 2.4,
      { size: 2.05, alpha: 0.65, max: b.w }
    );
    y += 5;
  }
  blankRow(d, b.x, y, b.w * 0.35, [['문항 번호', 1]]);
  y += 7;
  y += chipRow(d, b.x, y, b.w, '유형', [
    '자기소개',
    '설문-묘사',
    '설문-습관',
    '설문-과거 경험',
    '설문-비교',
    '돌발',
    '롤플레이-질문하기',
    '롤플레이-대안 제시',
    '롤플레이-관련 경험',
    '어드밴스',
  ]);
  const qh = c.spacing * 2 + 6;
  d.rect(b.x, y, b.w, qh, { stroke: d.soft(0.45), m: 1.2, r: 2 });
  d.label('Q.', b.x + 3, y + 4.6, { size: 3.2 });
  d.lines(b.x + 3, y + 5, b.w - 6, qh - 6);
  y += qh + 4;
  const fh = 11;
  fields(
    d,
    { x: b.x, y, w: b.w, h: b.y + b.h - y - fh - 3 },
    [
      ['도입', 1],
      ['본문', 3.2],
      ['마무리', 1],
      ['만능 표현', 1.4, 'tint'],
    ],
    22
  );
  const fy = b.y + b.h - fh + 2;
  blankRow(d, b.x, fy, b.w, [
    ['답변 시간', 0.28, '초'],
    ['필러', 0.22, '회'],
    ['막힌 곳', 0.5],
  ]);
};
T.econ = (d, b, land) => {
  const c = d.cfg;
  let y = b.y;
  blankRow(d, b.x, y, b.w, [
    ['기사', 0.5],
    ['출처', 0.26],
    ['날짜', 0.24],
  ]);
  y += 8;
  y += chipRow(d, b.x, y, b.w, 'TESAT 영역', ['경제이론', '시사경제·경영', '응용복합(추론·판단)']);
  const sh = c.spacing * 3 + 6;
  d.rect(b.x, y, b.w, sh, { stroke: d.soft(0.45), m: 1.2, r: 2 });
  d.label('세 줄 요약', b.x + 3, y + 4.6);
  d.lines(b.x + 3, y + 5, b.w - 6, sh - 6);
  y += sh + 4;
  const rem = b.y + b.h - y,
    mh = rem * 0.52,
    gw = (b.w - 5) / 2;
  const tx = b.x;
  d.label('경제 용어', tx, y + 3.6);
  d.line(tx, y + 5, tx + gw, y + 5, c.accent, 1.4, 'solid');
  d.lines(tx, y + 5, gw, mh - 5);
  d.line(tx + gw * 0.35, y + 5, tx + gw * 0.35, y + mh, d.soft(0.6), 1, 'dashed');
  const gx0 = b.x + gw + 5;
  d.label('그래프로 그려 보기', gx0, y + 3.6);
  const gy = y + 6,
    gh = mh - 6,
    s = 5;
  d.rect(gx0, gy, gw, gh, { stroke: d.soft(0.45), m: 1.2, r: 2 });
  for (let xx = gx0 + s; xx < gx0 + gw - 0.5; xx += s)
    d.line(xx, gy + 0.5, xx, gy + gh - 0.5, d.soft(0.9), 0.8, 'solid');
  for (let yy = gy + s; yy < gy + gh - 0.5; yy += s)
    d.line(gx0 + 0.5, yy, gx0 + gw - 0.5, yy, d.soft(0.9), 0.8, 'solid');
  const ox = gx0 + 7,
    oy = gy + gh - 6,
    ctx = d.ctx;
  d.line(ox, oy, ox, gy + 4, c.ink, 1.6, 'solid');
  d.line(ox, oy, gx0 + gw - 4, oy, c.ink, 1.6, 'solid');
  ctx.fillStyle = c.ink;
  ctx.beginPath();
  ctx.moveTo(ox, gy + 3);
  ctx.lineTo(ox - 1.1, gy + 5.2);
  ctx.lineTo(ox + 1.1, gy + 5.2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(gx0 + gw - 3, oy);
  ctx.lineTo(gx0 + gw - 5.2, oy - 1.1);
  ctx.lineTo(gx0 + gw - 5.2, oy + 1.1);
  ctx.fill();
  d.text('P', ox - 2.4, gy + 5.5, { size: 2.6, weight: 700, align: 'right' });
  d.text('Q', gx0 + gw - 3, oy + 4, { size: 2.6, weight: 700, align: 'right' });
  d.text('O', ox - 1.2, oy + 3.2, { size: 2.2, align: 'right', alpha: 0.6 });
  y += mh + 4;
  const bh = b.y + b.h - y;
  d.rect(b.x, y, b.w, bh, { fill: d.soft(0.88), r: 2 });
  d.label('내 생각 · 연결되는 개념', b.x + 3, y + 4.6);
  d.lines(b.x + 3, y + 5, b.w - 6, bh - 6);
};
const STUDIO = {
  pilates: {
    cls: ['매트', '리포머', '캐딜락', '체어', '바렐'],
    part: ['코어', '골반', '척추', '어깨', '고관절', '햄스트링'],
    cond: ['유연성', '코어 힘', '균형', '호흡'],
  },
  yoga: {
    cls: ['하타', '빈야사', '아쉬탕가', '인 요가', '플라잉'],
    part: ['고관절', '척추', '어깨', '햄스트링', '골반', '손목'],
    cond: ['유연성', '균형', '호흡', '집중'],
  },
};
T.studio = (d, b, land) => {
  const c = d.cfg,
    K = STUDIO[c.studio] || STUDIO.pilates;
  let y = b.y;
  y += chipRow(d, b.x, y, b.w, '수업', K.cls);
  y += chipRow(d, b.x, y, b.w, '집중 부위', K.part);
  blankRow(d, b.x, y, b.w * 0.62, [
    ['시간', 0.45, '분'],
    ['강사', 0.55],
  ]);
  let ix = b.x + b.w * 0.66;
  d.label('강도', ix, y + 4);
  ix += 10;
  for (let k = 0; k < 5; k++) d.circle(ix + k * 4.2, y + 2.9, 1.4, { stroke: c.accent, m: 1.2 });
  y += 10;
  const bh = land ? 0 : b.h * 0.27,
    tw = land ? b.w * 0.62 : b.w;
  table(
    d,
    { x: b.x, y, w: tw, h: b.y + b.h - y - (land ? 0 : bh + 5) },
    [
      { l: '동작', f: 38 },
      { l: '반복·유지', sub: '회 / 초', f: 14 },
      {
        l: '난이도',
        f: 13,
        cell: (x, yy, w, h) => {
          for (let k = 0; k < 3; k++)
            d.circle(x + w / 2 - 3.6 + k * 3.6, yy + h / 2, 1, { stroke: d.soft(0.35), m: 1.1 });
        },
      },
      { l: '느낌·메모', f: 35 },
    ],
    { hh: 9, rh: Math.max(c.spacing, 8) }
  );
  const cb = land
    ? { x: b.x + tw + 5, y, w: b.w - tw - 5, h: b.y + b.h - y }
    : { x: b.x, y: b.y + b.h - bh, w: b.w, h: bh };
  const cw = land ? cb.w : cb.w * 0.42;
  d.rect(cb.x, cb.y, cw, land ? cb.h * 0.4 : cb.h, { fill: d.soft(0.88), r: 2 });
  d.label('몸 상태', cb.x + 3, cb.y + 4.6);
  K.cond.forEach((t, i) => {
    const yy = cb.y + 10 + i * 6.2;
    d.text(t, cb.x + 3, yy, { size: 2.5 });
    for (let k = 0; k < 5; k++)
      d.circle(cb.x + cw - 22 + k * 4.2, yy - 0.9, 1.2, { stroke: c.accent, m: 1.1 });
  });
  const fx = land ? cb.x : cb.x + cw + 5,
    fy = land ? cb.y + cb.h * 0.4 + 5 : cb.y,
    fw = land ? cb.w : cb.w - cw - 5,
    fh = land ? cb.h * 0.6 - 5 : cb.h;
  d.label('오늘의 느낌 · 불편한 곳', fx, fy + 3.6);
  d.line(fx, fy + 5, fx + fw, fy + 5, c.accent, 1.4, 'solid');
  d.lines(fx, fy + 5, fw, fh - 5);
};

const IND = '코스피,코스닥,원/달러 환율,미국 10년물 금리,S&P 500,나스닥,WTI 유가,금 시세';
function won(d, x, y, w, label) {
  d.label(label, x, y + 4);
  d.line(
    x + d.measure(label, { size: 2.7, weight: 700 }) + 2,
    y + 5,
    x + w - 5,
    y + 5,
    null,
    1,
    'solid'
  );
  d.text('원', x + w, y + 4, { size: 2.4, align: 'right', alpha: 0.6 });
}
T.budget = (d, b, land) => {
  const c = d.cfg,
    x = b.x;
  let y = b.y;
  const cats = cols(c, [
    '식비',
    '카페·간식',
    '생활용품',
    '교통',
    '쇼핑',
    '문화·여가',
    '경조사',
    '돌발 지출',
  ]);
  blankRow(d, x, y, b.w, [
    ['집계 기간', 0.5],
    ['월급일', 0.22, '일'],
    ['지출 성격', 0.28],
  ]);
  y += 8;
  const iw = (b.w - 8) / 3;
  ['수입 합계', '목표 저축', '쓸 수 있는 돈'].forEach((l, i) => {
    const bx = x + i * (iw + 4);
    d.rect(bx, y, iw, 11, { fill: d.soft(i === 1 ? 0.8 : 0.9), r: 2 });
    d.label(l, bx + 3, y + 4.3, { size: 2.5 });
    d.line(bx + 3, y + 9, bx + iw - 7, y + 9, null, 1, 'solid');
    d.text('원', bx + iw - 3, y + 8.6, { size: 2.3, align: 'right', alpha: 0.6 });
  });
  y += 15;
  const lw2 = land ? b.w * 0.42 : b.w,
    fixH = land ? b.y + b.h - y - 30 : Math.min(62, (b.y + b.h - y) * 0.36);
  d.label('고정지출 · 납부일 체크', x, y + 3.6);
  table(
    d,
    { x, y: y + 5, w: lw2, h: fixH - 5 },
    [
      { l: '항목', f: 34 },
      { l: '납부일', f: 16 },
      { l: '금액', f: 30 },
      {
        l: '납부',
        f: 12,
        cell: (cx, cy, w, h) => d.check(cx + w / 2 - 1.3, cy + h / 2 - 1.3, 2.6),
      },
    ],
    { hh: 7, rh: Math.max(c.spacing, 6.5) }
  );
  ['월세·관리비', '통신비', '보험', '구독 서비스', '교통 정기권', '적금·청약'].forEach((t, i) => {
    const yy = y + 5 + 7 + i * Math.max(c.spacing, 6.5);
    if (yy + Math.max(c.spacing, 6.5) <= y + fixH)
      d.text(t, x + 1.6, yy + Math.max(c.spacing, 6.5) / 2 + 0.9, { size: 2.3, alpha: 0.75 });
  });
  let vx = x,
    vy = y + fixH + 4,
    vw = b.w;
  if (land) {
    vx = x + lw2 + 6;
    vy = y;
    vw = b.w - lw2 - 6;
  }
  const vh = land ? b.y + b.h - vy - 30 : b.y + b.h - vy - 30;
  d.label('변동지출 예산', vx, vy + 3.6);
  table(
    d,
    { x: vx, y: vy + 5, w: vw, h: vh - 5 },
    [
      { l: '카테고리', f: 26 },
      { l: '예산', f: 20 },
      { l: '실제', f: 20 },
      { l: '남은 돈', f: 20, strong: true },
      { l: '%', f: 14 },
    ],
    { hh: 7, rh: Math.max(c.spacing, 7) }
  );
  cats.forEach((t, i) => {
    const rh = Math.max(c.spacing, 7),
      yy = vy + 5 + 7 + i * rh;
    if (yy + rh <= vy + vh) d.text(t, vx + 1.6, yy + rh / 2 + 0.9, { size: 2.4, weight: 700 });
  });
  const fy = b.y + b.h - 26,
    fw = (b.w - 8) / 3;
  [['잘한 소비'], ['아쉬운 소비'], ['다음 달 바꿀 것']].forEach(([l], i) => {
    const fx = x + i * (fw + 4);
    d.rect(fx, fy, fw, 26, { fill: d.soft(0.9), r: 2 });
    d.label(l, fx + 3, fy + 4.6);
    d.lines(fx + 3, fy + 5, fw - 6, 20, { sp: Math.min(c.spacing, 6.5) });
  });
};
T.ledger = (d, b, land) => {
  const c = d.cfg,
    x = b.x;
  let y = b.y;
  const sw = land ? b.w * 0.3 : 0,
    tw = b.w - (land ? sw + 6 : 0),
    bh = land ? 0 : 44;
  table(
    d,
    { x, y, w: tw, h: b.h - bh },
    [
      { l: '날짜', f: 9 },
      { l: '내용', f: 30 },
      { l: '카테고리', f: 14 },
      { l: '결제', sub: '현금·카드·이체', f: 13 },
      { l: '금액', f: 16 },
      {
        l: '필수·고민·충동',
        f: 18,
        cell: (cx, cy, w, h) => {
          for (let k = 0; k < 3; k++)
            d.circle(cx + w / 2 - 4.2 + k * 4.2, cy + h / 2, 1.1, { stroke: d.soft(0.35), m: 1.1 });
        },
      },
    ],
    { hh: 9, rh: Math.max(c.spacing, 7) }
  );
  const sx = land ? x + tw + 6 : x,
    sy = land ? y : b.y + b.h - bh + 5,
    sW = land ? sw : b.w * 0.56;
  d.label('무지출 챌린지', sx, sy + 3.6);
  const per = land ? 7 : 16,
    cs = Math.min(7, sW / per);
  for (let k = 0; k < 31; k++) {
    const cx = sx + (k % per) * cs,
      cy = sy + 6 + Math.floor(k / per) * cs;
    d.rect(cx + 0.4, cy + 0.4, cs - 0.8, cs - 0.8, { stroke: c.line, m: 1, r: 1 });
    d.text(k + 1, cx + 1.2, cy + 2.6, { size: 1.7, alpha: 0.6 });
  }
  const wy = land ? sy + 6 + Math.ceil(31 / per) * cs + 6 : sy,
    wx = land ? sx : sx + sW + 6,
    wW = land ? sw : b.w - sW - 6;
  d.label('주간 합계', wx, wy + 3.6);
  for (let k = 0; k < 5; k++) {
    const yy = wy + 5 + k * 6.4;
    d.text(`${k + 1}주`, wx, yy + 4.3, { size: 2.4, weight: 700, color: c.accent });
    d.line(wx + 8, yy + 5, wx + wW - 5, yy + 5, null, 1, 'solid');
    d.text('원', wx + wW, yy + 4.3, { size: 2.2, align: 'right', alpha: 0.6 });
  }
};
T.networth = (d, b, land) => {
  const c = d.cfg,
    x = b.x;
  let y = b.y;
  const rows = [
    '현금·입출금',
    '예금',
    '적금',
    '주식·ETF',
    '연금',
    '청약',
    '기타 자산',
    '자산 합계',
    '카드값',
    '대출',
    '부채 합계',
    '순자산',
  ];
  const mN = land ? 12 : 6;
  const gh = 16;
  d.rect(x, y, b.w, gh, { fill: d.soft(0.88), r: 2 });
  d.label('목표 금액', x + 3, y + 5);
  d.line(x + 20, y + 6, x + b.w * 0.4, y + 6, null, 1, 'solid');
  d.text('원', x + b.w * 0.4 + 4, y + 5, { size: 2.4, alpha: 0.6 });
  d.label('달성', x + b.w * 0.48, y + 5);
  for (let k = 0; k < 10; k++)
    d.rect(
      x + b.w * 0.48 + 10 + k * ((b.w * 0.5 - 14) / 10),
      y + 2.2,
      (b.w * 0.5 - 14) / 10 - 1,
      4,
      { stroke: c.accent, m: 1, r: 0.6 }
    );
  d.text('단기 · 중기 · 장기 목표', x + 3, y + 12.5, { size: 2.3, alpha: 0.6 });
  d.line(x + 30, y + 13, x + b.w - 3, y + 13, null, 1, 'solid');
  y += gh + 4;
  const fH = land ? 0 : b.h * 0.2;
  table(
    d,
    { x, y, w: b.w, h: b.y + b.h - y - fH - (land ? 0 : 5) },
    [
      { l: '항목', f: 18 },
      ...Array.from({ length: mN }, (_, i) => ({
        l: land ? `${i + 1}월` : `${i + 1}월`,
        f: 82 / mN,
      })),
    ],
    { hh: 8, rh: (b.y + b.h - y - fH - (land ? 0 : 5) - 8) / rows.length }
  );
  const rh = (b.y + b.h - y - fH - (land ? 0 : 5) - 8) / rows.length;
  rows.forEach((t, i) => {
    const yy = y + 8 + i * rh,
      sum = /합계|순자산/.test(t);
    if (sum)
      d.rect(x + 0.3, yy + 0.3, b.w - 0.6, rh - 0.6, { fill: d.soft(t === '순자산' ? 0.75 : 0.9) });
    d.text(t, x + 1.8, yy + rh / 2 + 0.9, {
      size: 2.4,
      weight: sum ? 700 : 400,
      color: sum ? c.accent : c.ink,
    });
  });
  if (!land) {
    const fy = b.y + b.h - fH;
    d.label('이번 분기 돌아보기', x, fy + 3.6);
    d.line(x, fy + 5, x + b.w, fy + 5, c.accent, 1.4, 'solid');
    d.lines(x, fy + 5, b.w, fH - 5);
  }
};
T.tablepage = (d, b) => {
  const s = cols(d.cfg, ['항목', '내용', '메모']);
  table(
    d,
    b,
    s.map((l, i) => ({ l, f: i === s.length - 1 ? 22 : Math.max(10, 78 / (s.length - 1)) })),
    { hh: 9, rh: Math.max(d.cfg.spacing, 7.5) }
  );
};
T.examsheet = (d, b) => {
  const c = d.cfg,
    x = b.x;
  let y = b.y;
  const cell = (cx, cy, w, h, l, fill) => {
    d.rect(cx, cy, w, h, { fill: fill ? d.soft(0.85) : null, stroke: c.ink, m: 1.1 });
    if (l)
      d.text(l, cx + w / 2, cy + h / 2 + 0.9, {
        size: 2.6,
        weight: 700,
        align: 'center',
        color: c.ink,
        max: w - 1,
      });
  };
  if (c.sheetPage === 'cont') {
    const lw = b.w / 6,
      rh = 8;
    [
      ['과목', 0],
      ['학번', 2],
      ['이름', 4],
    ].forEach(([l, i]) => {
      cell(x + lw * i, y, lw * 0.4, rh, l, 1);
      cell(x + lw * i + lw * 0.4, y, lw * 1.6, rh);
    });
    y += rh + 4;
  } else {
    const rh = 8.5,
      lw = b.w * 0.14,
      vw = b.w * 0.36;
    [[['과목명', '담당교수']], [['학과', '학번']], [['이름', '서명']]].forEach(([p], r) => {
      p.forEach((l, i) => {
        cell(x + i * (lw + vw), y + r * rh, lw, rh, l, 1);
        cell(x + i * (lw + vw) + lw, y + r * rh, vw, rh);
      });
    });
    y += rh * 3 + 3;
    d.label('시험 구분', x, y + 3.6);
    let ix = x + 18;
    ['중간고사', '기말고사', '퀴즈', '과제', '기타'].forEach(t => {
      d.check(ix, y + 1.3, 2.6);
      d.text(t, ix + 3.6, y + 3.6, { size: 2.5 });
      ix += d.measure(t, { size: 2.5 }) + 8;
    });
    if (ix + 46 < x + b.w * 0.62) {
      blankRow(d, x + b.w * 0.62, y - 1, b.w * 0.38, [['시험일', 1]]);
      y += 7;
    } else {
      y += 6;
      blankRow(d, x, y - 1, b.w * 0.5, [['시험일', 1]]);
      y += 7;
    }
    const q = c.qs,
      qw = (b.w - 16 - 22) / q,
      sh = 7;
    cell(x, y, 16, sh, '문항', 1);
    cell(x, y + sh, 16, sh, '배점', 1);
    cell(x, y + 2 * sh, 16, sh * 1.4, '득점', 1);
    for (let i = 0; i < q; i++) {
      cell(x + 16 + qw * i, y, qw, sh, String(i + 1), 1);
      cell(x + 16 + qw * i, y + sh, qw, sh);
      cell(x + 16 + qw * i, y + 2 * sh, qw, sh * 1.4);
    }
    cell(x + b.w - 22, y, 22, sh, '총점', 1);
    cell(x + b.w - 22, y + sh, 22, sh, '/ 100');
    cell(x + b.w - 22, y + 2 * sh, 22, sh * 1.4);
    d.text('채점자', x + b.w - 22, y + 3.4 * sh + 3.2, { size: 2.2, alpha: 0.7 });
    d.line(x + b.w - 14, y + 3.4 * sh + 3.6, x + b.w, y + 3.4 * sh + 3.6, null, 1, 'solid');
    d.text(
      '· 학번과 이름을 모든 장에 적어 주세요   · 문항 번호를 왼쪽 칸에 쓰고 답을 적어 주세요   · 답안지는 모두 제출합니다',
      x,
      y + 3.4 * sh + 3.2,
      { size: 2.1, alpha: 0.65, max: b.w - 26 }
    );
    y += 3.4 * sh + 7;
  }
  const fh = 6,
    h = b.y + b.h - y - fh;
  d.rect(x, y, b.w, h, { stroke: c.ink, m: 1.3 });
  d.line(x + 10, y, x + 10, y + h, c.ink, 1, 'solid');
  d.text('문항', x + 5, y + 3.6, { size: 2, align: 'center', alpha: 0.6 });
  for (let yy = y + c.spacing; yy <= y + h - 0.5; yy += c.spacing) d.line(x + 10, yy, x + b.w, yy);
  d.text('(          /          ) 쪽', x + b.w / 2, b.y + b.h - 1, {
    size: 2.5,
    align: 'center',
    alpha: 0.7,
  });
};
const SPLIT = { v2: [2, 1], h2: [1, 2], v3: [3, 1], h3: [1, 3], q4: [2, 2], s6: [2, 3] };
T.drawsplit = (d, b, land) => T.split(d, b, land, true);
T.split = (d, b, land, custom) => {
  const c = d.cfg;
  if (custom) {
    const f = c.splitFill;
    if (f === 'lined') d.lines(b.x, b.y, b.w, b.h);
    else if (f === 'grid' || f === 'dot') (f === 'grid' ? T.grid : T.dot)(d, b);
    const L = c.customLines || [];
    L.forEach(l => {
      if (l.o === 'h') {
        const y = b.y + l.p * b.h;
        d.rect(b.x + l.a * b.w, y - 2.6, (l.b - l.a) * b.w, 5.2, { fill: c.bg });
      } else {
        const x = b.x + l.p * b.w;
        d.rect(x - 2.6, b.y + l.a * b.h, 5.2, (l.b - l.a) * b.h, { fill: c.bg });
      }
    });
    L.forEach(l => {
      if (l.o === 'h') {
        const y = b.y + l.p * b.h;
        d.line(b.x + l.a * b.w, y, b.x + l.b * b.w, y, c.accent, 1.6, 'solid');
      } else {
        const x = b.x + l.p * b.w;
        d.line(x, b.y + l.a * b.h, x, b.y + l.b * b.h, c.accent, 1.6, 'solid');
      }
    });
    if (!L.length && d.preview)
      d.text('여기에 가로·세로로 대충 그어 보세요', b.x + b.w / 2, b.y + b.h / 2, {
        size: 3.2,
        align: 'center',
        alpha: 0.35,
        color: c.accent,
      });
    return;
  }
  let [cn, rn] = SPLIT[c.split] || SPLIT.q4;
  if (c.split === 's6' && land) [cn, rn] = [3, 2];
  const g = 6,
    cw = (b.w - g * (cn - 1)) / cn,
    ch = (b.h - g * (rn - 1)) / rn;
  for (let r = 0; r < rn; r++)
    for (let k = 0; k < cn; k++) {
      const x = b.x + k * (cw + g),
        y = b.y + r * (ch + g);
      let iy = y;
      if (c.splitLabel) {
        d.circle(x + 2, y + 3, 1.5, { fill: d.soft(0.5) });
        d.line(x + 5, y + 5, x + cw * 0.6, y + 5, d.soft(0.4), 1.3, 'solid');
        iy = y + 8;
      }
      const inner = { x, y: iy, w: cw, h: y + ch - iy },
        f = c.splitFill;
      if (f === 'lined')
        d.lines(
          inner.x,
          inner.y - (c.splitLabel ? 2 : 0),
          inner.w,
          inner.h + (c.splitLabel ? 2 : 0)
        );
      else if (f === 'grid' || f === 'dot') (f === 'grid' ? T.grid : T.dot)(d, inner);
    }
  for (let k = 1; k < cn; k++) {
    const lx = b.x + k * (cw + g) - g / 2;
    d.line(lx, b.y, lx, b.y + b.h, c.accent, 1.6, 'solid');
  }
  for (let r = 1; r < rn; r++) {
    const ly = b.y + r * (ch + g) - g / 2;
    d.line(b.x, ly, b.x + b.w, ly, c.accent, 1.6, 'solid');
  }
};
T.morning = (d, b, land) => {
  const c = d.cfg,
    x = b.x;
  let y = b.y;
  const inds = cols(c, IND.split(',')).slice(0, 8);
  blankRow(d, x, y, b.w, [
    ['기상', 0.22],
    ['시작', 0.22],
    ['끝', 0.22],
    ['읽은 곳', 0.34],
  ]);
  y += 8;
  y += chipRow(d, x, y, b.w, '루틴', [
    '물 한 잔',
    '헤드라인 훑기',
    '기사 1개 정독',
    '지표 확인',
    '용어 1개',
    '한 줄 정리',
  ]);
  const half = land ? b.w * 0.42 : b.w * 0.46,
    gap = 5,
    rw = b.w - half - gap,
    topH = Math.max(inds.length * 6.5 + 10, c.spacing * 3 + 40);
  table(
    d,
    { x, y, w: half, h: topH },
    [
      { l: '지표', f: 46, cell: null },
      { l: '오늘', f: 30 },
      {
        l: '전일 대비',
        f: 24,
        cell: (cx, cy, w, h) =>
          d.text('▲  ▼', cx + w / 2, cy + h / 2 + 0.9, { size: 2.2, align: 'center', alpha: 0.3 }),
      },
    ],
    { hh: 7, rh: 6.5 }
  );
  inds.forEach((n, i) =>
    d.text(n, x + 1.6, y + 7 + i * 6.5 + 4.3, { size: 2.3, weight: 700, max: half * 0.46 - 2 })
  );
  const rx = x + half + gap;
  d.label('오늘의 헤드라인', rx, y + 3.6);
  d.line(rx, y + 5, rx + rw, y + 5, c.accent, 1.4, 'solid');
  const hl = 3,
    hh = (topH - 6) / hl;
  for (let i = 0; i < hl; i++) {
    const yy = y + 6 + i * hh;
    d.circle(rx + 2.2, yy + 3.4, 2, { fill: d.soft(0.75) });
    d.text(i + 1, rx + 2.2, yy + 3.5, {
      size: 2.3,
      weight: 700,
      align: 'center',
      base: 'middle',
      color: c.accent,
    });
    let ix = rx + 6;
    ['거시', '금융', '산업', '국제'].forEach(t => {
      d.text(t, ix, yy + 4.2, { size: 2, alpha: 0.55 });
      ix += d.measure(t, { size: 2 }) + 3;
    });
    d.lines(rx + 6, yy + 4.5, rw - 6, hh - 5.5);
    if (i < hl - 1) d.line(rx, yy + hh, rx + rw, yy + hh, d.soft(0.6), 1, 'dashed');
  }
  y += topH + 4;
  const rem = b.y + b.h - y,
    tH = rem * 0.36,
    iH = rem - tH - 4 - 11;
  d.rect(x, y, b.w, tH, { fill: d.soft(0.88), r: 2 });
  d.label('오늘의 경제 용어', x + 3, y + 4.6);
  [
    ['용어', 0.0],
    ['뜻', 0.3],
  ].forEach(([l, f]) =>
    d.text(l, x + 3 + (b.w - 6) * f, y + 9.5, { size: 2.3, weight: 700, alpha: 0.7 })
  );
  d.line(
    x + 3 + (b.w - 6) * 0.28,
    y + 6.5,
    x + 3 + (b.w - 6) * 0.28,
    y + tH - 2,
    d.soft(0.5),
    1,
    'dashed'
  );
  d.lines(x + 3, y + 10, b.w - 6, tH - 11);
  y += tH + 4;
  d.label('한 줄 인사이트 · 내 돈과 연결하면?', x, y + 3.6);
  d.line(x, y + 5, x + b.w, y + 5, c.accent, 1.4, 'solid');
  d.lines(x, y + 5, b.w, iH - 5);
  y += iH + 4;
  y = b.y + b.h - 6;
  d.label('이번 주 루틴', x, y + 4);
  const ds = ['월', '화', '수', '목', '금', '토', '일'];
  let ix = x + 22;
  ds.forEach(t => {
    d.circle(ix + 2.4, y + 2.9, 2.4, { stroke: c.accent, m: 1.2 });
    d.text(t, ix + 2.4, y + 3, { size: 2.1, align: 'center', base: 'middle' });
    ix += 7;
  });
  d.label('연속', ix + 4, y + 4);
  d.line(ix + 12, y + 5, ix + 24, y + 5, null, 1, 'solid');
  d.text('일째', ix + 25, y + 4, { size: 2.4, alpha: 0.7 });
  const qx = Math.max(ix + 36, x + b.w * 0.6);
  if (qx + 40 < x + b.w) {
    d.label('궁금한 것', qx, y + 4);
    d.line(qx + 16, y + 5, x + b.w, y + 5, null, 1, 'solid');
  }
};
T.econweek = (d, b, land) => {
  const c = d.cfg,
    x = b.x;
  let y = b.y;
  const inds = cols(c, IND.split(',')).slice(0, 8),
    days = ['월', '화', '수', '목', '금'];
  const tH = Math.min(b.h * 0.42, 9 + inds.length * 7.2);
  table(
    d,
    { x, y, w: b.w, h: tH },
    [
      { l: '지표', f: 20 },
      ...days.map(t => ({ l: t, f: 12 })),
      { l: '주간 변화', sub: '▲ / ▼', f: 12, strong: true },
      { l: '메모', f: 16 },
    ],
    { hh: 9, rh: 7 }
  );
  inds.forEach((n, i) =>
    d.text(n, x + 1.6, y + 9 + i * 7 + 4.6, { size: 2.4, weight: 700, max: b.w * 0.2 - 2 })
  );
  y += tH + 5;
  const rem = b.y + b.h - y,
    cw = (b.w - 5) / 2,
    top = rem * 0.55;
  const box = (bx, by, w, h, l, tint) => {
    if (tint) d.rect(bx, by, w, h, { fill: d.soft(0.88), r: 2 });
    d.label(l, bx + (tint ? 3 : 0), by + 4);
    d.line(bx, by + 5.4, bx + w, by + 5.4, c.accent, 1.4, 'solid');
    d.lines(bx + (tint ? 3 : 0), by + 5.4, w - (tint ? 6 : 0), h - 6);
  };
  box(x, y, cw, top, '이번 주 핵심 이슈 3');
  box(x + cw + 5, y, cw, top, '새로 배운 용어');
  y += top + 5;
  const bh = b.y + b.h - y;
  d.label('다음 주 일정', x, y + 4);
  d.line(x, y + 5.4, x + cw, y + 5.4, c.accent, 1.4, 'solid');
  let yy = y + 5.4;
  ['금리 결정', '물가 지표', '고용 지표', '실적 발표', '기타'].forEach(t => {
    const rh = (bh - 5.4) / 5;
    yy += rh;
    d.check(x, yy - rh / 2 - 1.3, 2.6);
    d.text(t, x + 4, yy - rh / 2 + 0.9, { size: 2.4 });
    d.line(x + 22, yy - 1, x + cw, yy - 1, null, 1);
  });
  box(x + cw + 5, y, cw, bh, '이번 주 한 줄 결론', true);
};

function autoTitle(c) {
  if (c.title) return c.title;
  if (c.template === 'drawsplit') return '분할 노트';
  if (c.template === 'split') {
    const n = {
      v2: '세로 이분할',
      h2: '가로 이분할',
      v3: '세로 삼분할',
      h3: '가로 삼분할',
      q4: '사분할 노트',
      s6: '육분할 노트',
      custom: '분할 노트',
    };
    return n[c.split] || '분할 노트';
  }
  if (c.template === 'studio') return c.studio === 'yoga' ? '요가 기록' : '필라테스 기록';
  if (c.template === 'circuit')
    return c.circuit === 'fire' ? '소방 순환식 체력' : '경찰 순환식 체력';
  if (c.template === 'monthly') {
    const [Y, M] = parseMonth(c.month);
    return `${Y}. ${String(M).padStart(2, '0')}`;
  }
  return TPL[c.template].n;
}
function ddayText(c) {
  if (!c.ddayName && !c.ddayDate) return '';
  let s = 'D-';
  if (c.ddayDate) {
    const t = new Date(c.ddayDate + 'T00:00:00'),
      t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const n = Math.round((t - t0) / 864e5);
    s = n > 0 ? `D-${n}` : n === 0 ? 'D-DAY' : `D+${-n}`;
  } else s = 'D-    ';
  return (c.ddayName ? c.ddayName + '  ' : '') + s;
}
const logoCache = {};
function logoImg(src, onload) {
  if (!src) return null;
  let im = logoCache[src];
  if (!im) {
    im = new Image();
    im.onload = onload;
    im.src = src;
    logoCache[src] = im;
  }
  return im.complete && im.naturalWidth ? im : null;
}
function drawSchool(d, cx, cy, r, alpha = 1) {
  const c = d.cfg,
    u = UNIV.find(u => u[0] === c.school);
  if (!u && !c.schoolLogo) return;
  const ctx = d.ctx;
  ctx.save();
  ctx.globalAlpha = alpha;
  const im = logoImg(c.schoolLogo, scheduleAll);
  if (im) {
    const s = Math.min((2 * r) / im.naturalWidth, (2 * r) / im.naturalHeight),
      w = im.naturalWidth * s,
      h = im.naturalHeight * s;
    ctx.drawImage(im, cx - w / 2, cy - h / 2, w, h);
  } else if (u) {
    const col = HEX.test(c.schoolColor) ? c.schoolColor : u[4];
    d.circle(cx, cy, r, { fill: col });
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = r * 0.05;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
    ctx.stroke();
    const k = u[2];
    d.text(k, cx, cy - r * 0.08, {
      size: (r * (k.length <= 2 ? 0.6 : 0.46)) / d.F.mul,
      weight: 700,
      color: '#FFFFFF',
      align: 'center',
      base: 'middle',
      font: '"Gowun Batang", serif',
    });
    d.text(u[3], cx, cy + r * 0.5, {
      size: (r * (u[3].length > 7 ? 0.15 : 0.19)) / d.F.mul,
      weight: 700,
      color: '#FFFFFF',
      align: 'center',
      base: 'middle',
      font: '"IBM Plex Sans KR", sans-serif',
      max: r * 1.4,
    });
  }
  ctx.restore();
}
function drawHeader(d, W, m, hh) {
  const c = d.cfg,
    x = m,
    y = m,
    w = W - 2 * m,
    band = c.headerStyle === 'band',
    mid = y + (hh - 3) / 2;
  if (band) d.rect(x, y, w, hh - 3, { fill: d.soft(0.84), r: 2.5 });
  let right = x + w - (band ? 3 : 0);
  if ((c.school || c.schoolLogo) && c.schoolPos === 'header') {
    const r = (hh - 6) / 2;
    drawSchool(d, right - r, mid, r);
    right -= 2 * r + 4;
  }
  const tsize = Math.min(6.2, hh * 0.3),
    lx = x + (band ? 4 : 0);
  d.text((c.brand ? c.brand + '  ·  ' : '') + TPL[c.template].en, lx, mid - tsize * 0.62, {
    size: 2,
    weight: 700,
    color: band ? c.ink : c.accent,
    alpha: 0.6,
    font: '"IBM Plex Sans KR", sans-serif',
  });
  d.text(autoTitle(c), lx, mid + tsize * 0.55, {
    size: (tsize / d.F.mul) * Math.min(d.F.mul, 1.2),
    weight: 700,
    color: band ? c.ink : c.accent,
    max: Math.max(30, right - lx - 46),
  });
  const r1 = y + (hh - 3) * 0.38,
    r2 = y + (hh - 3) * 0.8;
  if (c.dateMode === 'today') {
    d.text(
      `${now.getFullYear()}. ${now.getMonth() + 1}. ${now.getDate()} (${'일월화수목금토'[now.getDay()]})`,
      right,
      r1,
      { size: 2.8, align: 'right' }
    );
  } else if (c.dateMode === 'blank') {
    d.label('DATE', right - 37, r1, { size: 2.4 });
    d.line(right - 28, r1 + 0.9, right, r1 + 0.9, c.line, 1.3, 'solid');
    d.text('.', right - 18, r1, { size: 2.8 });
    d.text('.', right - 8, r1, { size: 2.8 });
  }
  let r2right = right;
  if (c.template === 'daily') {
    const ds = weekNames(c);
    for (let i = ds.length - 1; i >= 0; i--) {
      const n = ds[i],
        cx = r2right - 1.9;
      d.circle(cx, r2 - 1, 2, { stroke: c.line, m: 1.2 });
      d.text(WK[n], cx, r2 - 0.9, {
        size: 2.2,
        align: 'center',
        base: 'middle',
        color: n === 'SUN' ? RED : n === 'SAT' ? BLUE : c.ink,
      });
      r2right -= 4.6;
    }
    r2right -= 2;
  }
  const dd = ddayText(c);
  if (dd) {
    const tw = d.measure(dd, { size: 2.5, weight: 700 }) + 5;
    d.rect(r2right - tw, r2 - 3.6, tw, 5, { fill: c.accent, r: 2.5 });
    d.text(dd, r2right - tw / 2, r2 - 1, {
      size: 2.5,
      weight: 700,
      color: c.bg,
      align: 'center',
      base: 'middle',
    });
  }
  if (c.headerStyle === 'line') d.line(x, y + hh - 3, x + w, y + hh - 3, c.accent, 3, 'solid');
}
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
function drawChar(ctx, k, col) {
  const O = '#4A3B32';
  ctx.lineWidth = 3;
  ctx.strokeStyle = O;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  const C = (x, y, r, f, s = 1) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    if (f) {
      ctx.fillStyle = f;
      ctx.fill();
    }
    if (s) ctx.stroke();
  };
  const E = (x, y, rx, ry, f, s = 1) => {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, 7);
    if (f) {
      ctx.fillStyle = f;
      ctx.fill();
    }
    if (s) ctx.stroke();
  };
  const poly = (pts, f, s = 1) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    if (f) {
      ctx.fillStyle = f;
      ctx.fill();
    }
    if (s) ctx.stroke();
  };
  const eyes = (y, dx) => {
    C(-dx, y, 3.4, O, 0);
    C(dx, y, 3.4, O, 0);
  };
  const blush = (y, dx) => {
    E(-dx, y, 5, 3, 'rgba(240,120,135,.5)', 0);
    E(dx, y, 5, 3, 'rgba(240,120,135,.5)', 0);
  };
  const smile = y => {
    ctx.beginPath();
    ctx.moveTo(-5, y);
    ctx.quadraticCurveTo(-2.5, y + 4, 0, y);
    ctx.quadraticCurveTo(2.5, y + 4, 5, y);
    ctx.stroke();
  };
  switch (k) {
    case 'bear':
      C(-29, -28, 14, '#C99A6B');
      C(29, -28, 14, '#C99A6B');
      C(-29, -28, 6.5, '#EAC7A3', 0);
      C(29, -28, 6.5, '#EAC7A3', 0);
      C(0, 5, 39, '#D8AC7C');
      E(0, 17, 16, 11, '#F4E2CB');
      eyes(1, 14);
      E(0, 12, 5, 3.4, O, 0);
      blush(13, 26);
      smile(18);
      break;
    case 'cat':
      poly(
        [
          [-38, -6],
          [-30, -44],
          [-6, -30],
        ],
        '#F3EFE9'
      );
      poly(
        [
          [38, -6],
          [30, -44],
          [6, -30],
        ],
        '#F3EFE9'
      );
      poly(
        [
          [-30, -34],
          [-27, -41],
          [-15, -31],
        ],
        '#F6B8C3',
        0
      );
      poly(
        [
          [30, -34],
          [27, -41],
          [15, -31],
        ],
        '#F6B8C3',
        0
      );
      E(0, 6, 42, 35, '#F3EFE9');
      ctx.strokeStyle = '#C9A27A';
      [-6, 0, 6].forEach(x => {
        ctx.beginPath();
        ctx.moveTo(x, -27);
        ctx.lineTo(x, -19);
        ctx.stroke();
      });
      ctx.strokeStyle = O;
      eyes(2, 15);
      poly(
        [
          [-3, 10],
          [3, 10],
          [0, 13],
        ],
        '#F08A9B',
        0
      );
      smile(14);
      ctx.lineWidth = 1.8;
      [
        [-20, 12, -40, 8],
        [-20, 16, -40, 18],
        [20, 12, 40, 8],
        [20, 16, 40, 18],
      ].forEach(a => {
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(a[2], a[3]);
        ctx.stroke();
      });
      break;
    case 'bunny':
      E(-14, -36, 9, 25, '#FFFFFF');
      E(14, -36, 9, 25, '#FFFFFF');
      E(-14, -34, 4, 16, '#F6B8C3', 0);
      E(14, -34, 4, 16, '#F6B8C3', 0);
      C(0, 14, 34, '#FFFFFF');
      eyes(10, 12);
      E(0, 17, 3.4, 2.4, '#F08A9B', 0);
      blush(20, 22);
      smile(21);
      break;
    case 'chick':
      C(0, 6, 38, '#FFD84D');
      ctx.beginPath();
      ctx.moveTo(-4, -31);
      ctx.quadraticCurveTo(-2, -44, 4, -40);
      ctx.moveTo(1, -32);
      ctx.quadraticCurveTo(6, -43, 11, -37);
      ctx.stroke();
      eyes(0, 13);
      poly(
        [
          [-6, 8],
          [6, 8],
          [0, 15],
        ],
        '#F29A2E'
      );
      blush(10, 24);
      ctx.beginPath();
      ctx.arc(-26, 22, 10, 0.3, 2.4);
      ctx.stroke();
      break;
    case 'cloud': {
      const cs = [
        [-26, 8, 18],
        [-6, -6, 22],
        [18, 0, 19],
        [30, 12, 14],
        [0, 14, 20],
      ];
      ctx.lineWidth = 7;
      ctx.strokeStyle = '#8FB3DE';
      cs.forEach(a => C(a[0], a[1], a[2], null, 1));
      cs.forEach(a => C(a[0], a[1], a[2], '#FFFFFF', 0));
      ctx.strokeStyle = O;
      ctx.lineWidth = 2.5;
      eyes(6, 9);
      blush(11, 17);
      smile(11);
      break;
    }
    case 'star': {
      const p = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 20 : 46,
          a = -Math.PI / 2 + (i * Math.PI) / 5;
        p.push([Math.cos(a) * r, Math.sin(a) * r + 4]);
      }
      poly(p, '#FFD45C');
      eyes(4, 8);
      blush(10, 15);
      smile(9);
      break;
    }
    case 'dumbbell':
      ctx.fillStyle = '#9AA1AB';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(-30, -4, 60, 8, 3) : ctx.rect(-30, -4, 60, 8);
      ctx.fill();
      ctx.stroke();
      [
        [-46, -22, 11, 44],
        [-35, -16, 7, 32],
        [35 - 7 + 7, -22, 11, 44],
        [28, -16, 7, 32],
      ].forEach(r => {
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(r[0], r[1], r[2], r[3], 3) : ctx.rect(r[0], r[1], r[2], r[3]);
        ctx.fillStyle = '#3E4652';
        ctx.fill();
        ctx.stroke();
      });
      break;
    case 'book':
      poly(
        [
          [-48, -20],
          [0, -14],
          [48, -20],
          [48, 32],
          [0, 38],
          [-48, 32],
        ],
        col
      );
      poly(
        [
          [-44, -26],
          [0, -19],
          [0, 32],
          [-44, 25],
        ],
        '#FFFFFF'
      );
      poly(
        [
          [44, -26],
          [0, -19],
          [0, 32],
          [44, 25],
        ],
        '#FFFFFF'
      );
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = '#B8B0A6';
      for (let i = 0; i < 4; i++) {
        const yy = -12 + i * 9;
        ctx.beginPath();
        ctx.moveTo(-38, yy - 3);
        ctx.lineTo(-7, yy + 1);
        ctx.moveTo(7, yy + 1);
        ctx.lineTo(38, yy - 3);
        ctx.stroke();
      }
      break;
    case 'scale':
      ctx.strokeStyle = '#7A5D18';
      ctx.beginPath();
      ctx.moveTo(0, -34);
      ctx.lineTo(0, 30);
      ctx.moveTo(-38, -24);
      ctx.lineTo(38, -24);
      ctx.moveTo(-38, -24);
      ctx.lineTo(-50, 6);
      ctx.moveTo(-38, -24);
      ctx.lineTo(-26, 6);
      ctx.moveTo(38, -24);
      ctx.lineTo(26, 6);
      ctx.moveTo(38, -24);
      ctx.lineTo(50, 6);
      ctx.stroke();
      [[-38], [38]].forEach(([x]) => {
        ctx.beginPath();
        ctx.moveTo(x - 14, 6);
        ctx.quadraticCurveTo(x, 22, x + 14, 6);
        ctx.closePath();
        ctx.fillStyle = '#E9CD7A';
        ctx.fill();
        ctx.stroke();
      });
      E(0, 33, 20, 5, '#C9A44A');
      C(0, -36, 4.5, '#C9A44A');
      break;
    case 'calc':
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(-30, -44, 60, 88, 9) : ctx.rect(-30, -44, 60, 88);
      ctx.fillStyle = '#56636C';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(-22, -36, 44, 17, 3) : ctx.rect(-22, -36, 44, 17);
      ctx.fillStyle = '#CFE3C8';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.stroke();
      for (let r = 0; r < 4; r++)
        for (let q = 0; q < 3; q++) {
          ctx.beginPath();
          ctx.roundRect
            ? ctx.roundRect(-22 + q * 16, -12 + r * 13, 12, 9, 2.5)
            : ctx.rect(-22 + q * 16, -12 + r * 13, 12, 9);
          ctx.fillStyle = r === 3 && q === 2 ? '#F29A2E' : '#EEF0F2';
          ctx.fill();
        }
      break;
    case 'stamp':
      ctx.rotate(-0.2);
      ctx.strokeStyle = '#D8423A';
      ctx.lineWidth = 5;
      C(0, 0, 42, null, 1);
      ctx.lineWidth = 2;
      C(0, 0, 35, null, 1);
      ctx.fillStyle = '#D8423A';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 26px "Gowun Batang", serif';
      ctx.fillText('합격', 0, -2);
      ctx.font = '700 9px "IBM Plex Sans KR", sans-serif';
      ctx.fillText('PASS', 0, 19);
      break;
    case 'tape': {
      ctx.globalAlpha *= 0.62;
      const p = [];
      const zz = (x0, dir) => {
        for (let i = 0; i <= 6; i++) p.push([x0 + (i % 2 ? 3 * dir : 0), -13 + (i * 26) / 6]);
      };
      p.push([-50, -13], [50, -13]);
      for (let i = 0; i <= 6; i++) p.push([50 - (i % 2 ? 3 : 0), -13 + (i * 26) / 6]);
      p.push([-50, 13]);
      for (let i = 6; i >= 0; i--) p.push([-50 + (i % 2 ? 3 : 0), -13 + (i * 26) / 6]);
      poly(p, col, 0);
      ctx.globalAlpha /= 0.62 * 1;
      ctx.globalAlpha *= 0.25;
      ctx.fillStyle = '#FFFFFF';
      for (let x = -44; x < 46; x += 10) {
        ctx.fillRect(x, -13, 4, 26);
      }
      break;
    }
  }
}
function drawSticker(ctx, st, W, H, cfg) {
  ctx.save();
  ctx.translate(st.x * W, st.y * H);
  ctx.rotate(((st.r || 0) * Math.PI) / 180);
  if (st.t === 'e') {
    ctx.font = `${st.s}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(st.v, 0, st.s * 0.06);
  } else {
    ctx.scale(st.s / 100, st.s / 100);
    drawChar(ctx, st.v, HEX.test(st.c || '') ? st.c : cfg.accent);
  }
  ctx.restore();
}
function stBox(st) {
  return { hw: st.s / 2, hh: st.t === 'c' && st.v === 'tape' ? st.s * 0.15 : st.s / 2 };
}

function render(ctx, cfg, scale, opt = {}) {
  const S = SIZES[cfg.size] || SIZES.a4p,
    W = S.w,
    H = S.h,
    land = W > H,
    m = cfg.margin;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = cfg.bg;
  ctx.fillRect(0, 0, W, H);
  const d = kit(ctx, cfg);
  d.preview = !!opt.preview;
  if ((cfg.school || cfg.schoolLogo) && cfg.schoolPos === 'watermark')
    drawSchool(d, W / 2, H / 2, Math.min(W, H) * 0.27, 0.07);
  if (cfg.frame !== 'none')
    d.rect(m / 2, m / 2, W - m, H - m, {
      stroke: cfg.accent,
      m: 1.6,
      r: cfg.frame === 'round' ? 5 : 0,
    });
  const hh = cfg.header ? Math.min(21, Math.max(15, H * 0.072)) : 0;
  if (cfg.header) drawHeader(d, W, m, hh);
  const b = bodyRect(cfg);
  try {
    (T[cfg.template] || T.lined)(d, b, land);
  } catch (e) {
    console.error(e);
  }
  if ((cfg.school || cfg.schoolLogo) && cfg.schoolPos === 'footer') {
    const r = Math.min(4.5, m * 0.38),
      u = UNIV.find(u => u[0] === cfg.school);
    drawSchool(d, W - m - r, H - m / 2, r);
    if (u)
      d.text(u[1], W - m - 2 * r - 2, H - m / 2, {
        size: 2.4,
        align: 'right',
        base: 'middle',
        alpha: 0.7,
      });
  }
  if (opt.stroke && opt.stroke.length > 1) {
    ctx.save();
    ctx.strokeStyle = '#1F8CFF';
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 0.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    ctx.beginPath();
    opt.stroke.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();
    ctx.restore();
  }
  (cfg.stickers || []).forEach((st, i) => {
    drawSticker(ctx, st, W, H, cfg);
    if (opt.sel === i) {
      const { hw, hh } = stBox(st);
      ctx.save();
      ctx.translate(st.x * W, st.y * H);
      ctx.rotate(((st.r || 0) * Math.PI) / 180);
      ctx.strokeStyle = '#1F8CFF';
      ctx.lineWidth = (2 / scale) * 1.2;
      ctx.setLineDash([4 / scale, 3 / scale]);
      ctx.strokeRect(-hw - 1, -hh - 1, 2 * hw + 2, 2 * hh + 2);
      ctx.restore();
    }
  });
}
function bodyRect(cfg) {
  const S = SIZES[cfg.size] || SIZES.a4p,
    m = cfg.margin,
    hh = cfg.header ? Math.min(21, Math.max(15, S.h * 0.072)) : 0;
  return {
    x: m,
    y: m + hh + (cfg.header ? 2 : 0),
    w: S.w - 2 * m,
    h: S.h - 2 * m - hh - (cfg.header ? 2 : 0),
  };
}
function renderTo(cfg, pxPerMm) {
  const S = SIZES[cfg.size],
    c = document.createElement('canvas');
  c.width = Math.round(S.w * pxPerMm);
  c.height = Math.round(S.h * pxPerMm);
  render(c.getContext('2d'), cfg, pxPerMm);
  return c;
}
