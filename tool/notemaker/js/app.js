'use strict';
const KEY = 'sokji-draft-v1';
let cfg = clone(DEFAULT);
try {
  const s = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (s) cfg = sanitize(s);
} catch (e) {}
let sel = -1;
function sanitize(o) {
  const c = clone(DEFAULT);
  if (!o || typeof o !== 'object') return c;
  for (const k in DEFAULT) {
    if (!(k in o)) continue;
    const v = o[k],
      t = typeof DEFAULT[k];
    if (k === 'schoolLogo') {
      if (
        typeof v === 'string' &&
        /^data:image\/(png|jpeg|svg\+xml);base64,/.test(v) &&
        v.length < 200000
      )
        c[k] = v;
      continue;
    }
    if (k === 'customLines') {
      if (Array.isArray(v))
        c[k] = v
          .slice(0, 40)
          .filter(l => l && (l.o === 'h' || l.o === 'v'))
          .map(l => ({
            o: l.o,
            p: clamp(+l.p || 0.5, 0, 1),
            a: clamp(+l.a || 0, 0, 1),
            b: clamp(+l.b || 1, 0, 1),
          }));
      continue;
    }
    if (k === 'stickers') {
      if (Array.isArray(v))
        c[k] = v
          .slice(0, 40)
          .filter(
            s => s && (s.t === 'e' || s.t === 'c') && typeof s.v === 'string' && s.v.length < 16
          )
          .map(s => ({
            t: s.t,
            v: s.v,
            x: clamp(+s.x || 0.5, 0, 1),
            y: clamp(+s.y || 0.5, 0, 1),
            s: clamp(+s.s || 10, 3, 90),
            r: clamp(+s.r || 0, -180, 180),
            ...(HEX.test(s.c || '') ? { c: s.c } : {}),
          }));
      continue;
    }
    if (t === 'number' && typeof v === 'number' && isFinite(v)) c[k] = v;
    else if (t === 'boolean' && typeof v === 'boolean') c[k] = v;
    else if (t === 'string' && typeof v === 'string') c[k] = v.slice(0, 60);
  }
  ['bg', 'line', 'accent', 'ink'].forEach(k => {
    if (!HEX.test(c[k])) c[k] = DEFAULT[k];
  });
  if (c.schoolColor && !HEX.test(c.schoolColor)) c.schoolColor = '';
  if (!TPL[c.template]) c.template = 'lined';
  if (!SIZES[c.size]) c.size = 'a4p';
  if (!FONTS[c.font]) c.font = 'gowun';
  c.spacing = clamp(c.spacing, 4, 14);
  c.lw = clamp(c.lw, 0.1, 0.8);
  c.margin = clamp(c.margin, 6, 22);
  c.rounds = clamp(Math.round(c.rounds), 3, 10);
  c.repeat = clamp(Math.round(c.repeat), 1, 3);
  c.sets = clamp(Math.round(c.sets), 3, 8);
  c.qs = clamp(Math.round(c.qs), 1, 12);
  c.hours = clamp(Math.round(c.hours), 12, 22);
  c.startHour = clamp(Math.round(c.startHour), 4, 10);
  return c;
}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch (e) {}
}

const cv = $('#page'),
  desk = $('#desk');
let pScale = 1,
  raf = 0;
function sizePreview() {
  const S = SIZES[cfg.size],
    dpr = window.devicePixelRatio || 1;
  const cs = getComputedStyle(desk);
  const aw = desk.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const ah = window.innerWidth > 760 ? Math.min(window.innerHeight - 170, 1100) : aw * 1.6;
  const k = Math.max(0.5, Math.min(aw / S.w, ah / S.h));
  cv.style.width = Math.round(S.w * k) + 'px';
  cv.style.height = Math.round(S.h * k) + 'px';
  cv.width = Math.round(S.w * k * dpr);
  cv.height = Math.round(S.h * k * dpr);
  pScale = k * dpr;
}
function draw() {
  raf = 0;
  sizePreview();
  render(cv.getContext('2d'), cfg, pScale, { sel, stroke, preview: true });
}
function schedule() {
  if (!raf) raf = requestAnimationFrame(draw);
}
function scheduleAll() {
  schedule();
  refreshThumbs();
}
new ResizeObserver(schedule).observe(desk);
function changed() {
  persist();
  schedule();
  syncVis();
}

function toMM(e) {
  const r = cv.getBoundingClientRect(),
    S = SIZES[cfg.size];
  return { x: ((e.clientX - r.left) / r.width) * S.w, y: ((e.clientY - r.top) / r.height) * S.h };
}
function hit(p) {
  const S = SIZES[cfg.size];
  for (let i = cfg.stickers.length - 1; i >= 0; i--) {
    const st = cfg.stickers[i],
      a = (-(st.r || 0) * Math.PI) / 180,
      dx = p.x - st.x * S.w,
      dy = p.y - st.y * S.h,
      lx = dx * Math.cos(a) - dy * Math.sin(a),
      ly = dx * Math.sin(a) + dy * Math.cos(a),
      { hw, hh } = stBox(st);
    if (Math.abs(lx) <= hw + 1 && Math.abs(ly) <= hh + 1) return i;
  }
  return -1;
}
let drag = null;
function snapStroke(pts) {
  const b = bodyRect(cfg);
  if (pts.length < 2) {
    schedule();
    return;
  }
  const xs = pts.map(q => q.x),
    ys = pts.map(q => q.y),
    x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    y0 = Math.min(...ys),
    y1 = Math.max(...ys),
    w = x1 - x0,
    h = y1 - y0;
  if (Math.max(w, h) < b.w * 0.08) {
    status('조금 더 길게 그어 주세요.');
    schedule();
    return;
  }
  const o = w >= h * 1.6 ? 'h' : h >= w * 1.6 ? 'v' : null;
  if (!o) {
    status('가로나 세로로 그어 주세요. 대각선은 나누기로 못 바꿔요.');
    schedule();
    return;
  }
  const L = cfg.customLines || (cfg.customLines = []),
    q = v => Math.round(v * 24) / 24,
    cl = v => clamp(v, 0, 1);
  const along =
    o === 'h' ? [(x0 - b.x) / b.w, (x1 - b.x) / b.w] : [(y0 - b.y) / b.h, (y1 - b.y) / b.h];
  const pos =
    o === 'h'
      ? (ys.reduce((a, v) => a + v, 0) / ys.length - b.y) / b.h
      : (xs.reduce((a, v) => a + v, 0) / xs.length - b.x) / b.w;
  const cross = L.filter(l => l.o !== o)
    .map(l => l.p)
    .concat([0, 1]);
  const snapEnd = (v, isStart) => {
    const near = cross
      .filter(c => {
        const l = L.find(z => z.o !== o && z.p === c);
        return !l || (pos >= l.a - 0.03 && pos <= l.b + 0.03);
      })
      .sort((a, b2) => Math.abs(a - v) - Math.abs(b2 - v))[0];
    if (near !== undefined && Math.abs(near - v) < 0.12) return near;
    return isStart && v < 0.1 ? 0 : !isStart && v > 0.9 ? 1 : cl(q(v));
  };
  let p = cl(q(pos));
  if (p <= 0.02 || p >= 0.98) {
    status('가장자리에는 선을 둘 수 없어요.');
    schedule();
    return;
  }
  const same = L.find(l => l.o === o && Math.abs(l.p - p) < 0.03);
  if (same) p = same.p;
  L.push({ o, p, a: snapEnd(cl(along[0]), true), b: snapEnd(cl(along[1]), false) });
  status(o === 'h' ? '가로선을 반듯하게 맞췄어요.' : '세로선을 반듯하게 맞췄어요.');
  changed();
}
let stroke = null;
const drawMode = () => cfg.template === 'drawsplit';
cv.addEventListener('pointerdown', e => {
  const p = toMM(e),
    i = hit(p),
    S = SIZES[cfg.size];
  if (i < 0 && drawMode()) {
    stroke = [p];
    sel = -1;
    syncSel();
    cv.setPointerCapture(e.pointerId);
    return;
  }
  sel = i;
  if (i >= 0) {
    const st = cfg.stickers[i];
    drag = { i, dx: p.x - st.x * S.w, dy: p.y - st.y * S.h };
    cv.setPointerCapture(e.pointerId);
  }
  syncSel();
  schedule();
});
cv.addEventListener('pointermove', e => {
  const p = toMM(e),
    S = SIZES[cfg.size];
  if (stroke) {
    stroke.push(p);
    schedule();
    return;
  }
  if (drag) {
    const st = cfg.stickers[drag.i];
    st.x = clamp((p.x - drag.dx) / S.w, 0, 1);
    st.y = clamp((p.y - drag.dy) / S.h, 0, 1);
    schedule();
  } else cv.style.cursor = hit(p) >= 0 ? 'move' : drawMode() ? 'crosshair' : 'default';
});
cv.addEventListener('pointerup', () => {
  if (stroke) {
    const st = stroke;
    stroke = null;
    snapStroke(st);
    return;
  }
  if (drag) {
    drag = null;
    persist();
  }
});
cv.addEventListener('pointercancel', () => {
  stroke = null;
  drag = null;
  schedule();
});
cv.addEventListener('keydown', e => {
  if (sel < 0) return;
  const st = cfg.stickers[sel],
    k = e.shiftKey ? 0.02 : 0.004;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    cfg.stickers.splice(sel, 1);
    sel = -1;
    syncSel();
    changed();
    e.preventDefault();
    return;
  }
  const mv = { ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, -k], ArrowDown: [0, k] }[e.key];
  if (mv) {
    st.x = clamp(st.x + mv[0], 0, 1);
    st.y = clamp(st.y + mv[1], 0, 1);
    changed();
    e.preventDefault();
  }
});

function chips(el, items, key, after) {
  el.innerHTML = '';
  items.forEach(([v, l]) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = l;
    b.dataset.v = v;
    b.onclick = () => {
      cfg[key] = typeof DEFAULT[key] === 'boolean' ? v === 'true' : v;
      markChips(el, key);
      after && after();
      changed();
    };
    el.appendChild(b);
  });
  el.dataset.key = key;
}
function markChips(el, key) {
  [...el.children].forEach(b =>
    b.setAttribute('aria-pressed', String(String(cfg[key]) === b.dataset.v))
  );
}
const EXT = new Set(['workout', 'studio', 'circuit', 'fire6', 'fitness']);
const EXG = [
  ['workout', '헬스', {}],
  ['studio', '필라테스', { studio: 'pilates' }],
  ['studio', '요가', { studio: 'yoga' }],
  ['circuit', '경찰 순환식', { circuit: 'police' }],
  ['fire6', '소방 체력 6종목', {}],
  ['circuit', '소방 순환식 (개편 예정)', { circuit: 'fire' }],
  ['fitness', '국정원 체력', { subjects: '20m 왕복오래달리기,팔굽혀펴기,윗몸일으키기' }],
  ['fitness', '종목 직접 입력', { subjects: '' }],
];
function exOn(t, p) {
  if (cfg.template !== t) return false;
  if (p.studio) return cfg.studio === p.studio;
  if (p.circuit) return cfg.circuit === p.circuit;
  if (t === 'fitness') return (cfg.subjects || '').startsWith('20m') === !!p.subjects;
  return true;
}
const PREF = {
  review: 'l',
  mock: 'l',
  fitness: 'l',
  fire6: 'l',
  circuit: 'l',
  networth: 'l',
  habit: 'l',
  econweek: 'l',
  cycle: 'l',
  examsheet: 'p',
  sheet: 'p',
  morning: 'p',
  budget: 'p',
  opic: 'p',
  econ: 'p',
  memorize: 'p',
  blank: 'p',
};
const SUBG = {
  review: 'course',
  mock: 'course',
  morning: 'ind',
  econweek: 'ind',
  fitness: 'fit',
  tablepage: 'table',
};
const TOL = { a4p: 'a4l', b5p: 'a4l', a5p: 'a4l', tabp: 'tabl' },
  TOP = { a4l: 'a4p', tabl: 'tabp' };
function setTemplate(t, p) {
  const prev = cfg.template;
  if (prev !== t || p) {
    if (prev !== t) {
      cfg.title = '';
      if (SUBG[prev] !== SUBG[t] || !SUBG[t]) cfg.subjects = '';
    }
    cfg.template = t;
    if (p) Object.assign(cfg, p);
    const land = SIZES[cfg.size].w > SIZES[cfg.size].h;
    if (PREF[t] === 'l' && !land) cfg.size = TOL[cfg.size] || 'a4l';
    if (PREF[t] === 'p' && land) cfg.size = TOP[cfg.size] || 'a4p';
    cfg.stickers = cfg.stickers.filter(st => !(st.t === 'c' && st.v === 'tape'));
    sel = -1;
    syncAll();
  }
  changed();
}
function buildTpl() {
  const el = $('#tplChips');
  el.innerHTML = '';
  [
    ...Object.entries(TPL)
      .filter(([k]) => !EXT.has(k))
      .map(([k, v]) => [k, v.n]),
    ['__ex', '운동 · 체력'],
  ].forEach(([k, l]) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = l;
    b.setAttribute(
      'aria-pressed',
      String(k === '__ex' ? EXT.has(cfg.template) : cfg.template === k)
    );
    b.onclick = () => {
      if (k === '__ex') {
        if (!EXT.has(cfg.template)) setTemplate('workout');
      } else setTemplate(k);
    };
    el.appendChild(b);
  });
  const ex = $('#exChips');
  ex.innerHTML = '';
  EXG.forEach(([t, l, p]) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = l;
    b.setAttribute('aria-pressed', String(exOn(t, p)));
    b.onclick = () => setTemplate(t, p);
    ex.appendChild(b);
  });
}
chips(
  $('#sizeChips'),
  Object.entries(SIZES).map(([k, v]) => [k, v.n]),
  'size'
);
chips(
  $('#styleChips'),
  [
    ['solid', '실선'],
    ['dashed', '점선'],
    ['dotted', '도트선'],
  ],
  'lineStyle'
);
chips(
  $('#hstyleChips'),
  [
    ['line', '밑줄'],
    ['band', '색 띠'],
    ['plain', '없음'],
  ],
  'headerStyle'
);
chips(
  $('#dateChips'),
  [
    ['blank', '빈칸'],
    ['today', '오늘 날짜'],
    ['none', '숨기기'],
  ],
  'dateMode'
);
chips(
  $('#weekStartChips'),
  [
    ['mon', '월요일'],
    ['sun', '일요일'],
  ],
  'weekStart'
);
chips(
  $('#splitChips'),
  [
    ['v2', '세로 이분할'],
    ['h2', '가로 이분할'],
    ['v3', '세로 삼분할'],
    ['h3', '가로 삼분할'],
    ['q4', '사분할 (십자)'],
    ['s6', '육분할'],
  ],
  'split'
);
chips(
  $('#splitFillChips'),
  [
    ['lined', '줄'],
    ['grid', '모눈'],
    ['dot', '도트'],
    ['blank', '무지'],
  ],
  'splitFill'
);
chips(
  $('#sheetChips'),
  [
    ['first', '첫 장 (인적사항·채점표)'],
    ['cont', '이어 쓰는 장'],
  ],
  'sheetPage'
);
chips(
  $('#sexChips'),
  [
    ['m', '남자'],
    ['f', '여자'],
  ],
  'sex'
);
chips(
  $('#posChips'),
  [
    ['header', '머리말'],
    ['watermark', '워터마크'],
    ['footer', '아래 여백'],
  ],
  'schoolPos'
);
const fontSel = $('#font');
Object.entries(FONTS).forEach(([k, v]) => fontSel.add(new Option(v.n, k)));
const schoolSel = $('#school');
schoolSel.add(new Option('선택 안 함', ''));
UNIV.forEach(u => schoolSel.add(new Option(u[1], u[0])));
const RANGES = {
  qs: v => v + '문항',
  spacing: v => v.toFixed(1) + ' mm',
  lw: v => v.toFixed(2) + ' mm',
  margin: v => v + ' mm',
  startHour: v => v + '시',
  hours: v => v + '칸',
  rounds: v => v + '회',
  repeat: v => v + '개',
  sets: v => v + '세트',
};
Object.keys(RANGES).forEach(k => {
  const el = $('#' + k);
  el.addEventListener('input', () => {
    cfg[k] = parseFloat(el.value);
    $('#' + k + 'V').textContent = RANGES[k](cfg[k]);
    changed();
  });
});
['bg', 'line', 'accent', 'ink'].forEach(k =>
  $('#' + k).addEventListener('input', e => {
    cfg[k] = e.target.value;
    changed();
  })
);
['title', 'ddayName', 'subjects', 'brand'].forEach(k =>
  $('#' + k).addEventListener('input', e => {
    cfg[k] = e.target.value;
    changed();
  })
);
['ddayDate', 'month'].forEach(k =>
  $('#' + k).addEventListener('change', e => {
    cfg[k] = e.target.value;
    changed();
  })
);
['checks', 'major', 'marginLine', 'header', 'splitLabel'].forEach(k =>
  $('#' + k).addEventListener('change', e => {
    cfg[k] = e.target.checked;
    changed();
  })
);
fontSel.addEventListener('change', () => {
  cfg.font = fontSel.value;
  changed();
});
$('#frame').addEventListener('change', e => {
  cfg.frame = e.target.value;
  changed();
});
schoolSel.addEventListener('change', () => {
  cfg.school = schoolSel.value;
  const u = UNIV.find(u => u[0] === cfg.school);
  cfg.schoolColor = u ? u[4] : '';
  $('#schoolColor').value = u ? u[4] : '#888888';
  if (u && cfg.schoolTheme) {
    schoolTheme(u[4]);
    syncAll();
    status(`${u[1]} 색으로 속지 색을 맞췄어요. 색 칸에서 따로 고칠 수 있어요.`);
  }
  changed();
});
$('#schoolTheme').addEventListener('change', e => {
  cfg.schoolTheme = e.target.checked;
  if (cfg.schoolTheme && cfg.school) {
    schoolTheme(cfg.schoolColor || (UNIV.find(u => u[0] === cfg.school) || [])[4]);
    syncAll();
  }
  changed();
});
$('#schoolColor').addEventListener('input', e => {
  cfg.schoolColor = e.target.value;
  if (cfg.schoolTheme && cfg.school) {
    schoolTheme(e.target.value);
    ['bg', 'line', 'accent', 'ink'].forEach(k => ($('#' + k).value = cfg[k]));
  }
  changed();
});
$('#logoFile').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, 240 / Math.max(im.width, im.height)),
        c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(im.width * k));
      c.height = Math.max(1, Math.round(im.height * k));
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      cfg.schoolLogo = c.toDataURL('image/png');
      syncAll();
      changed();
    };
    im.onerror = () => status('이미지를 읽지 못했어요. PNG나 JPG 파일로 다시 올려 주세요.');
    im.src = rd.result;
  };
  rd.readAsDataURL(f);
  e.target.value = '';
});
$('#logoClear').onclick = () => {
  cfg.schoolLogo = null;
  syncAll();
  changed();
};
const sw = $('#swatches');
PAL.forEach(p => {
  const b = document.createElement('button');
  b.className = 'sw';
  b.type = 'button';
  b.title = p[0];
  b.setAttribute('aria-label', p[0] + ' 팔레트');
  b.innerHTML = `<i style="background:${p[1]}"></i><i style="background:${p[3]}"></i><i style="background:${p[2]}"></i>`;
  b.onclick = () => {
    [cfg.bg, cfg.line, cfg.accent, cfg.ink] = p.slice(1);
    syncAll();
    changed();
  };
  sw.appendChild(b);
});

const stkTabs = $('#stkTabs'),
  stkGrid = $('#stkGrid');
let stkTab = '캐릭터';
function buildStk() {
  stkTabs.innerHTML = '';
  ['캐릭터', ...Object.keys(EMO)].forEach(t => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = t;
    b.setAttribute('aria-pressed', String(t === stkTab));
    b.onclick = () => {
      stkTab = t;
      buildStk();
    };
    stkTabs.appendChild(b);
  });
  stkGrid.innerHTML = '';
  if (stkTab === '캐릭터') {
    CHARS.forEach(([k, l]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = l;
      b.setAttribute('aria-label', l + ' 붙이기');
      const c = document.createElement('canvas');
      c.width = 56;
      c.height = 56;
      const x = c.getContext('2d');
      x.translate(28, 28);
      x.scale(0.5, 0.5);
      drawChar(x, k, cfg.accent);
      b.appendChild(c);
      b.onclick = () => addSticker({ t: 'c', v: k, s: k === 'tape' ? 40 : 16 });
      stkGrid.appendChild(b);
    });
  } else
    EMO[stkTab].forEach(e => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = e;
      b.setAttribute('aria-label', e + ' 붙이기');
      b.onclick = () => addSticker({ t: 'e', v: e, s: 10 });
      stkGrid.appendChild(b);
    });
}
function addSticker(s) {
  cfg.stickers.push(Object.assign({ x: 0.5, y: 0.5, r: 0 }, s));
  sel = cfg.stickers.length - 1;
  syncSel();
  changed();
  cv.focus({ preventScroll: true });
}
function syncSel() {
  const box = $('#selBox');
  if (sel < 0 || !cfg.stickers[sel]) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const st = cfg.stickers[sel];
  $('#stSize').value = st.s;
  $('#stSizeV').textContent = st.s + ' mm';
  $('#stRot').value = st.r || 0;
  $('#stRotV').textContent = (st.r || 0) + '°';
}
$('#stSize').addEventListener('input', e => {
  if (sel < 0) return;
  cfg.stickers[sel].s = +e.target.value;
  $('#stSizeV').textContent = e.target.value + ' mm';
  changed();
});
$('#stRot').addEventListener('input', e => {
  if (sel < 0) return;
  cfg.stickers[sel].r = +e.target.value;
  $('#stRotV').textContent = e.target.value + '°';
  changed();
});
$('#lineUndo').onclick = () => {
  (cfg.customLines || []).pop();
  changed();
};
$('#lineClear').onclick = () => {
  cfg.customLines = [];
  changed();
};
$('#stDel').onclick = () => {
  if (sel < 0) return;
  cfg.stickers.splice(sel, 1);
  sel = -1;
  syncSel();
  changed();
};
$('#stFront').onclick = () => {
  if (sel < 0) return;
  const [s] = cfg.stickers.splice(sel, 1);
  cfg.stickers.push(s);
  sel = cfg.stickers.length - 1;
  changed();
};
$('#stDup').onclick = () => {
  if (sel < 0) return;
  const s = clone(cfg.stickers[sel]);
  s.x = clamp(s.x + 0.04, 0, 1);
  s.y = clamp(s.y + 0.03, 0, 1);
  cfg.stickers.push(s);
  sel = cfg.stickers.length - 1;
  syncSel();
  changed();
};

function syncVis() {
  buildTpl();
  document
    .querySelectorAll('[data-show]')
    .forEach(el => (el.hidden = !el.dataset.show.split(',').includes(cfg.template)));
  $('#pdfLab').textContent = cfg.template === 'monthly' ? '개월 수' : '페이지 수';
  $('#logoClear').hidden = !cfg.schoolLogo;
}
function syncAll() {
  document.querySelectorAll('.chips[data-key]').forEach(el => markChips(el, el.dataset.key));
  Object.keys(RANGES).forEach(k => {
    $('#' + k).value = cfg[k];
    $('#' + k + 'V').textContent = RANGES[k](cfg[k]);
  });
  ['bg', 'line', 'accent', 'ink'].forEach(k => ($('#' + k).value = cfg[k]));
  ['title', 'ddayName', 'ddayDate', 'month', 'subjects', 'brand'].forEach(
    k => ($('#' + k).value = cfg[k] || '')
  );
  ['checks', 'major', 'marginLine', 'header', 'schoolTheme', 'splitLabel'].forEach(
    k => ($('#' + k).checked = !!cfg[k])
  );
  fontSel.value = cfg.font;
  $('#frame').value = cfg.frame;
  schoolSel.value = cfg.school;
  const u = UNIV.find(u => u[0] === cfg.school);
  $('#schoolColor').value = HEX.test(cfg.schoolColor) ? cfg.schoolColor : u ? u[4] : '#888888';
  syncVis();
  syncSel();
  buildStk();
}
function loadCfg(c) {
  const keep = {
    school: cfg.school,
    schoolColor: cfg.schoolColor,
    schoolPos: cfg.schoolPos,
    schoolLogo: cfg.schoolLogo,
  };
  const n = sanitize(Object.assign(clone(DEFAULT), c));
  if (!c.month) n.month = cfg.month;
  if (keep.school || keep.schoolLogo) Object.assign(n, keep);
  cfg = n;
  sel = -1;
  syncAll();
  changed();
  window.innerWidth <= 760 && desk.scrollIntoView({ behavior: 'smooth' });
}
$('#resetBtn').onclick = () => {
  cfg = clone(DEFAULT);
  sel = -1;
  syncAll();
  changed();
  status('빈 줄노트로 돌렸어요.');
};

let cat = 'all';
const cats = $('#cats'),
  cards = $('#cards');
function buildCats() {
  cats.innerHTML = '';
  CATS.forEach(([k, l]) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = l;
    b.setAttribute('aria-pressed', String(k === cat));
    b.onclick = () => {
      cat = k;
      buildCats();
      buildCards();
    };
    cats.appendChild(b);
  });
}
const thumbs = [];
function thumb(c) {
  const cvs = renderTo(c, 1.15);
  thumbs.push([cvs, c]);
  return cvs;
}
let thumbT = 0;
function refreshThumbs() {
  clearTimeout(thumbT);
  thumbT = setTimeout(
    () =>
      thumbs.forEach(([cvs, c]) => {
        if (cvs.isConnected) render(cvs.getContext('2d'), c, 1.15);
      }),
    150
  );
}
function buildCards() {
  cards.innerHTML = '';
  thumbs.length = 0;
  $('#refHead').dataset.count =
    (cat === 'all' ? PRESETS.length : PRESETS.filter(p => [].concat(p.cat).includes(cat)).length) +
    '장';
  PRESETS.filter(p => cat === 'all' || [].concat(p.cat).includes(cat)).forEach(p => {
    const c = sanitize(Object.assign(clone(DEFAULT), p.cfg));
    const b = document.createElement('button');
    b.className = 'card';
    b.type = 'button';
    b.setAttribute('aria-label', p.name + ' 불러오기');
    b.appendChild(thumb(c));
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = p.name;
    const m = document.createElement('div');
    m.className = 'm';
    m.textContent = `${TPL[c.template].n} · ${SIZES[c.size].n}`;
    b.append(t, m);
    b.onclick = () => {
      loadCfg(p.cfg);
      status(`'${p.name}' 꺼냈어요.`);
    };
    cards.appendChild(b);
  });
}

function status(t) {
  $('#status').textContent = t;
}
function fname() {
  return (autoTitle(cfg) + '_' + SIZES[cfg.size].n).replace(/[\\/:*?"<>|\s]+/g, '_');
}
function saveFile(name, blob) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  status('저장했어요: ' + name);
}
$('#pngBtn').onclick = async () => {
  status('PNG를 만드는 중이에요…');
  await document.fonts.ready;
  const c = renderTo(cfg, 9);
  c.toBlob(b => saveFile(fname() + '.png', b), 'image/png');
};
$('#pdfBtn').onclick = async () => {
  if (!window.jspdf) {
    status('PDF 도구를 불러오지 못했어요. 새로고침 후 다시 해 보세요.');
    return;
  }
  status('PDF를 만드는 중이에요…');
  await document.fonts.ready;
  const n = clamp(parseInt($('#pdfPages').value) || 1, 1, 31),
    S = SIZES[cfg.size],
    o = S.w > S.h ? 'l' : 'p';
  const pdf = new window.jspdf.jsPDF({ orientation: o, unit: 'mm', format: [S.w, S.h] });
  let [Y, M] = parseMonth(cfg.month);
  for (let i = 0; i < n; i++) {
    const c = clone(cfg);
    if (cfg.template === 'monthly') {
      const mm = M - 1 + i;
      c.month = `${Y + Math.floor(mm / 12)}-${String((mm % 12) + 1).padStart(2, '0')}`;
    }
    if (i) pdf.addPage([S.w, S.h], o);
    pdf.addImage(renderTo(c, 8).toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, S.w, S.h);
  }
  saveFile(fname() + '.pdf', pdf.output('blob'));
};

buildCats();
syncAll();
buildCards();
schedule();
const sample =
  '속지공방줄노트모눈도트코넬플래너위클리먼슬리오답암기회독판례분개운동습관트래커월화수목금토일출처단원틀린이유개념부족계산실수문제오독시간찍음풀이핵심사건쟁점사실관계판시사항판결요지관련조문나의정리법원선고내용접어서가리고외우기과목범위비고날짜차변대변계정금액체중수면컨디션물가슴등어깨하체팔코어유산소스트레칭아침점심저녁간식이번달돌아보기세트회합격대학교서울연세고려0123456789.:/×✓';
Promise.all(
  Object.values(FONTS)
    .map(f => document.fonts.load(`700 12px ${f.css}`, sample).catch(() => {}))
    .concat([document.fonts.load('700 12px "Gowun Batang"', sample).catch(() => {})])
).then(scheduleAll);
document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', scheduleAll);
