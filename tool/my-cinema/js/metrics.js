const toDeg = (r) => (r * 180) / Math.PI;

export function columns(hall) {
  return hall.rows[0][1].length;
}

export function rowGeometry(hall, i) {
  const z = hall.firstRow + i * hall.rowPitch;
  const floor = i < hall.flatRows ? 0 : (i - hall.flatRows + 1) * hall.riser;
  return { z, floor, eye: floor + hall.eyeHeight };
}

export function columnX(hall, c) {
  return (c - (columns(hall) - 1) / 2) * hall.seatWidth;
}

export function isSeat(ch) {
  return ch === 'S' || ch === 'W';
}

export function seatLabel(hall, i, c) {
  const [row, layout] = hall.rows[i];
  let n = 0;
  for (let k = 0; k <= c; k++) if (isSeat(layout[k])) n++;
  return `${row}${n}`;
}

export function seatNumber(hall, i, c) {
  const layout = hall.rows[i][1];
  let n = 0;
  for (let k = 0; k <= c; k++) if (isSeat(layout[k])) n++;
  return n;
}

export function blockOf(hall, i, c) {
  const layout = hall.rows[i][1];
  const parts = layout.split('_').length;
  const idx = layout.slice(0, c).split('_').length - 1;
  return parts >= 3 && idx === Math.floor(parts / 2) ? 'center' : parts >= 3 ? 'side' : 'center';
}

function hit(rule, hall, i, c) {
  const row = hall.rows[i][0];
  if (!rule.rows.includes(row)) return false;
  const n = seatNumber(hall, i, c);
  if (rule.from && n < rule.from) return false;
  if (rule.to && n > rule.to) return false;
  if (rule.block && blockOf(hall, i, c) !== rule.block) return false;
  return true;
}

export function recommendOf(hall, i, c) {
  return (hall.recommend || []).filter((r) => hit(r, hall, i, c) || (r.also || []).some((a) => hit(a, hall, i, c)));
}

export function seatCount(hall) {
  return hall.rows.reduce((sum, [, l]) => sum + [...l].filter(isSeat).length, 0);
}

export function measure(hall, i, c) {
  const { z, eye } = rowGeometry(hall, i);
  const x = columnX(hall, c);
  const s = hall.screen;
  const top = s.bottom + s.height;
  const mid = s.bottom + s.height / 2;

  const left = Math.atan((-s.width / 2 - x) / z);
  const right = Math.atan((s.width / 2 - x) / z);
  const horiz = Math.hypot(x, z);
  const toEdge = Math.hypot(Math.max(0, Math.abs(x) - s.width / 2), z);

  const m = {
    distance: Math.hypot(x, mid - eye, z),
    depth: z,
    lateral: x,
    eye,
    hAngle: toDeg(right - left),
    vAngle: toDeg(Math.atan((top - eye) / z) - Math.atan((s.bottom - eye) / z)),
    toCenter: toDeg(Math.atan((mid - eye) / horiz)),
    toTop: toDeg(Math.atan((top - eye) / toEdge)),
    offAxis: toDeg(Math.atan(Math.abs(x) / z)),
    widthRatio: z / s.width,
    clearance: null,
    subClear: null,
  };

  if (i > 0) {
    const front = rowGeometry(hall, i - 1);
    const t = (z - front.z) / z;
    const lineY = eye + (s.bottom - eye) * t;
    m.clearance = lineY - front.eye;
    const subY = s.bottom + s.height * (hall.subtitleAt ?? 0.08);
    m.subClear = eye + (subY - eye) * t - front.eye;
  }
  return m;
}

const PROFILE = {
  standard: { min: 30, best: [36, 48], max: 58, top: 35 },
  immersive: { min: 50, best: [66, 90], max: 100, top: 45 },
};

export function assess(m, hall) {
  const P = PROFILE[hall.profile] || PROFILE.standard;
  let score = 100;
  const notes = [];
  const h = m.hAngle;
  const H = h.toFixed(0);

  if (h < P.min) {
    score -= (P.min - h) * 2.5;
    notes.push(`스크린이 시야의 ${H}°만 채워요. 몰입감보다는 편하게 보는 자리예요.`);
  } else if (h < P.best[0]) {
    score -= (P.best[0] - h) * 0.8;
    notes.push(`스크린이 시야의 ${H}°를 채워요. 화면 전체가 한눈에 들어와요.`);
  } else if (h <= P.best[1]) {
    notes.push(`스크린이 시야의 ${H}°를 채워요. 이 상영관에서 가장 몰입감 있는 거리예요.`);
  } else if (h <= P.max) {
    score -= (h - P.best[1]) * 1.4;
    notes.push(`스크린이 시야의 ${H}°로 시야를 넘어서요. 양끝 장면은 고개를 돌려야 보여요.`);
  } else {
    score -= 15 + (h - P.max) * 1.8;
    notes.push(`스크린이 시야의 ${H}°로 너무 가까워요. 화면 일부는 계속 놓치게 돼요.`);
  }

  if (m.toTop > P.top) {
    score -= (m.toTop - P.top) * 2.2;
    notes.push(`화면 위끝까지 ${m.toTop.toFixed(0)}°를 올려봐야 해서 목이 뻐근할 수 있어요.`);
  } else if (m.toCenter > 25) {
    score -= (m.toCenter - 25) * 1.5;
    notes.push(`화면 중앙이 ${m.toCenter.toFixed(0)}° 위에 있어요. 살짝 올려보는 자세가 돼요.`);
  }

  if (m.offAxis > 15) {
    score -= (m.offAxis - 15) * 1.8;
    notes.push(`정면에서 ${m.offAxis.toFixed(0)}° 비껴 있어 화면이 비스듬하게 보여요.`);
  }

  if (m.clearance !== null) {
    const cm = m.clearance * 100;
    if (cm < 6) {
      score -= 18 + (6 - cm) * 1.5;
      notes.push('앞줄과 단차가 거의 없어요. 앞사람 머리에 화면 아래쪽이 가려질 수 있어요.');
    } else if (cm < 12) {
      score -= (12 - cm) * 1.5;
      notes.push('앞사람 키에 따라 화면 아래 끝이 살짝 걸릴 수 있어요.');
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  let grade = 'poor';
  if (score >= 86) grade = 'best';
  else if (score >= 72) grade = 'good';
  else if (score >= 55) grade = 'fair';

  return { score, grade, notes };
}

export function subtitleNote(m) {
  if (m.subClear === null) return '맨 앞줄이라 자막을 가리는 사람은 없어요.';
  const cm = m.subClear * 100;
  if (cm < 6) return '자막 줄이 앞사람 머리에 걸릴 수 있어요.';
  if (cm < 12) return '앞사람이 크면 자막 일부가 가릴 수 있어요.';
  return '';
}

export const GRADE_LABEL = {
  best: '명당',
  good: '좋음',
  fair: '보통',
  poor: '아쉬움',
};
