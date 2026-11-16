import { THEATERS, HALLS, MOVIES } from './data.js';
import { measure, assess, seatCount, GRADE_LABEL, recommendOf, subtitleNote } from './metrics.js';
import { drawSeatMap } from './seatmap.js';
import { SeatViewer } from './viewer.js';

const $ = (id) => document.getElementById(id);
const won = (n) => `${n.toLocaleString('ko-KR')}원`;
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

const TAG_LABEL = { best: '명당', good: '추천', sub: '자막 편함', avoid: '피하기' };
const audio = (m) => (m.subtitle ? ' · 자막' : m.dub ? ' · 더빙' : '');

const state = {
  theater: THEATERS[0],
  highlight: null,
  subOn: true,
  date: null,
  movie: null,
  time: null,
  hall: null,
  occupied: new Set(),
  partySize: 2,
  party: [],
  focus: null,
  showGrade: false,
};

let viewer = null;

function go(step) {
  document.querySelectorAll('.page').forEach((p) => {
    p.hidden = Number(p.dataset.page) !== step;
  });
  document.querySelectorAll('#steps li').forEach((li) => {
    const n = Number(li.dataset.step);
    li.classList.toggle('on', n === step);
    li.classList.toggle('done', n < step);
  });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bookedSeats(hall, seed, rate) {
  const rnd = seeded(seed);
  const fill = rate ?? 0.25 + rnd() * 0.45;
  const set = new Set();
  const rows = hall.rows.length;
  hall.rows.forEach(([, layout], i) => {
    [...layout].forEach((ch, c) => {
      if (ch !== 'S') return;
      const mid = Math.abs(c - (layout.length - 1) / 2) / (layout.length / 2);
      const depth = i / rows;
      const pull = 1 - mid * 0.6 + (depth > 0.35 && depth < 0.85 ? 0.25 : -0.15);
      if (rnd() < fill * pull) set.add(`${i}-${c}`);
    });
  });
  return set;
}

function freeLabel(hall, seed, rate) {
  const total = seatCount(hall);
  const free = total - bookedSeats(hall, seed, rate).size;
  return free === total ? '전석 예매 가능' : `${free}/${total}석`;
}

function renderDates() {
  const box = $('dates');
  const today = new Date();
  box.innerHTML = '';
  for (let d = 0; d < 7; d++) {
    const day = new Date(today);
    day.setDate(today.getDate() + d);
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'date';
    if (day.getDay() === 0) b.classList.add('sun');
    if (day.getDay() === 6) b.classList.add('sat');
    b.innerHTML = `<small>${d === 0 ? '오늘' : DAYS[day.getDay()]}</small><b>${day.getDate()}</b>`;
    b.dataset.iso = iso;
    b.dataset.label = `${day.getMonth() + 1}월 ${day.getDate()}일 (${DAYS[day.getDay()]})`;
    b.addEventListener('click', () => {
      state.date = { iso, label: b.dataset.label };
      box.querySelectorAll('.date').forEach((x) => x.classList.toggle('on', x === b));
      renderMovies();
    });
    box.appendChild(b);
    if (d === 0) state.date = { iso, label: b.dataset.label };
  }
  box.firstChild.classList.add('on');
}

function renderTheaters() {
  const box = $('theaters');
  box.innerHTML = '';
  THEATERS.forEach((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theater';
    b.classList.toggle('on', t === state.theater);
    b.innerHTML = `<b>${t.name}</b><small>${t.sub}</small>`;
    b.addEventListener('click', () => {
      state.theater = t;
      renderTheaters();
      renderMovies();
    });
    box.appendChild(b);
  });
  $('theaterDesc').textContent = state.theater.desc;
}

function renderMovies() {
  const ul = $('movies');
  ul.innerHTML = '';
  MOVIES.forEach((src) => {
    const shows = src.shows.filter(([, h]) => state.theater.halls.includes(h)).sort((a, b) => a[0].localeCompare(b[0]));
    const mv = { ...src, shows };
    if (!mv.shows.length) return;
    const li = document.createElement('li');
    li.className = 'movie';
    li.innerHTML = `
      <div class="poster" style="--a:${mv.tone[0]};--b:${mv.tone[1]}"><span>${mv.title}</span></div>
      <div class="movie-body">
        <h3><i class="age age-${mv.rating}">${mv.rating === 'ALL' ? '전체' : mv.rating}</i>${mv.title}</h3>
        <p>${mv.genre} · ${mv.runtime}분${audio(mv)} · ${mv.released.replaceAll('-', '.')} 개봉</p>
        <div class="times"></div>
      </div>`;
    addPoster(li.querySelector('.poster'), mv);
    const times = li.querySelector('.times');
    mv.shows.forEach(([time, hallId, rate]) => {
      const hall = HALLS[hallId];
      const seed = `${state.date.iso}|${mv.id}|${time}|${hallId}`;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'time';
      b.innerHTML = `<b>${time}</b><small>${hall.name} ${hall.format}</small><small>${freeLabel(hall, seed, rate)}</small>`;
      b.addEventListener('click', () => openShow(mv, time, hall, seed, rate));
      times.appendChild(b);
    });
    ul.appendChild(li);
  });
}

function addPoster(box, movie) {
  if (!movie.poster) return;
  const img = new Image();
  img.alt = `${movie.title} 포스터`;
  img.addEventListener('load', () => box.classList.add('has-img'));
  img.addEventListener('error', () => img.remove());
  img.src = movie.poster;
  box.prepend(img);
}

function openShow(movie, time, hall, seed, rate) {
  state.movie = movie;
  state.time = time;
  state.hall = hall;
  state.occupied = bookedSeats(hall, seed, rate);
  state.party = [];
  state.focus = null;
  state.highlight = null;

  const end = new Date(`2000-01-01T${time}:00`);
  end.setMinutes(end.getMinutes() + movie.runtime);
  const endStr = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
  $('showTitle').textContent = movie.title;
  $('showMeta').textContent = `${state.date.label} ${time}~${endStr} · ${state.theater.name} ${hall.name} ${hall.format}${audio(movie)}`;

  renderHallSpec(hall);
  go(2);

  if (!viewer) {
    viewer = new SeatViewer($('viewer'));
  }
  viewer.load(hall, { occupied: state.occupied, party: [], frame: frameFor(movie) });
  $('btnSub').hidden = !movie.subtitle;
  $('btnSub').classList.toggle('on', state.subOn);
  renderRecs(hall);
  $('viewerEmpty').hidden = false;
  $('btnMySeat').disabled = true;
  $('metrics').hidden = true;
  refreshSeats();
}

function frameFor(movie) {
  return { scene: movie.scene, art: movie.art, subtitle: movie.subtitle && state.subOn ? movie.subtitle[0] : null };
}

function renderRecs(hall) {
  const box = $('recs');
  const list = hall.recommend || [];
  box.hidden = !list.length;
  const chips = list.map((r, k) => `<button type="button" class="rec rec-${r.tag}${state.highlight === k ? ' on' : ''}" data-k="${k}"><i>${TAG_LABEL[r.tag]}</i>${r.title}</button>`).join('');
  const cur = state.highlight == null ? null : list[state.highlight];
  box.innerHTML = `<p class="recs-head">후기 추천 자리<small>눌러서 배치도에 표시</small></p><div class="rec-chips">${chips}</div>${cur ? `<p class="rec-note">${cur.note}</p>` : ''}`;
  box.querySelectorAll('.rec').forEach((b) => {
    b.addEventListener('click', () => {
      const k = Number(b.dataset.k);
      state.highlight = state.highlight === k ? null : k;
      renderRecs(hall);
      drawMap();
    });
  });
}

function renderHallSpec(hall) {
  const { room, screen } = hall;
  const est = hall.estimated || [];
  const rows = [
    ['객석', `${seatCount(hall)}석`],
    ['좌석 배치', `${hall.rows.length}열`, 'rows'],
    ['상영관 크기', `폭 ${room.width}m · 깊이 ${room.depth}m · 천장 ${room.height}m`, 'room'],
    ['스크린', `${screen.width} × ${screen.height}m (${(screen.width / screen.height).toFixed(2)}:1)`, 'screen'],
    ['스크린 높이', `바닥에서 ${screen.bottom}m ~ ${(screen.bottom + screen.height).toFixed(2)}m`, 'screenBottom'],
    ['첫 줄 거리', `${hall.firstRow}m`, 'firstRow'],
    ['열 간격 · 단차', `${hall.rowPitch}m · ${Math.round(hall.riser * 100)}cm`, 'riser'],
    ['앉은 눈높이', `${hall.eyeHeight}m`, 'eyeHeight'],
  ];
  $('hallSpec').innerHTML = rows
    .map(([k, v, key]) => `<div><dt>${k}</dt><dd>${v}${est.includes(key) ? '<i class="est">추정</i>' : ''}</dd></div>`)
    .join('');
  $('hallEst').hidden = !est.length;
}

function pick(i, c, label) {
  const k = `${i}-${c}`;
  const idx = state.party.findIndex((s) => `${s.i}-${s.c}` === k);

  if (idx >= 0) {
    const isFocus = state.focus && state.focus.i === i && state.focus.c === c;
    if (!isFocus) {
      state.focus = state.party[idx];
    } else {
      state.party.splice(idx, 1);
      state.focus = state.party[state.party.length - 1] || null;
    }
  } else {
    if (state.party.length >= state.partySize) {
      if (state.partySize === 1) {
        state.party = [];
      } else {
        toast(`${state.partySize}명까지 고를 수 있어요. 인원을 늘리거나 고른 좌석을 해제해 주세요.`);
        return;
      }
    }
    const seat = { i, c, label };
    state.party.push(seat);
    state.focus = seat;
  }
  refreshSeats();
}

function unpick(seat) {
  state.party = state.party.filter((s) => s !== seat);
  if (state.focus === seat) state.focus = state.party[state.party.length - 1] || null;
  refreshSeats();
}

function drawMap() {
  drawSeatMap($('seatmap'), state.hall, {
    occupied: state.occupied,
    party: state.party,
    focus: state.focus,
    showGrade: state.showGrade,
    highlight: state.highlight,
    onPick: pick,
  });
}

function refreshSeats() {
  drawMap();

  viewer.paintSeats(state.party, state.focus);
  if (state.focus) {
    viewer.focus(state.focus.i, state.focus.c);
    $('viewerEmpty').hidden = true;
    $('btnMySeat').disabled = false;
    renderMetrics(state.focus);
  } else {
    viewer.overview();
    $('viewerEmpty').hidden = false;
    $('btnMySeat').disabled = true;
    $('metrics').hidden = true;
  }
  renderPicked();
}

function renderMetrics(seat) {
  const m = measure(state.hall, seat.i, seat.c);
  const a = assess(m, state.hall);
  $('metrics').hidden = false;
  $('mSeat').textContent = `${seat.label} 좌석에서 본 화면`;
  const g = $('mGrade');
  g.textContent = GRADE_LABEL[a.grade];
  g.dataset.grade = a.grade;

  $('mDist').textContent = `${m.distance.toFixed(1)}m`;
  $('mH').textContent = `${m.hAngle.toFixed(0)}°`;
  $('mV').textContent = `중앙 ${m.toCenter.toFixed(0)}° · 상단 ${m.toTop.toFixed(0)}°`;
  $('mOff').textContent = m.offAxis < 1 ? '정중앙' : `${m.lateral < 0 ? '왼쪽' : '오른쪽'} ${m.offAxis.toFixed(0)}°`;
  $('mC').textContent = m.clearance === null ? '첫 줄' : `${(m.clearance * 100).toFixed(0)}cm`;
  $('mSub').textContent = m.subClear === null ? '첫 줄' : `${(m.subClear * 100).toFixed(0)}cm`;

  const notes = a.notes.length ? [...a.notes] : ['무난한 자리예요.'];
  if (state.movie.subtitle) {
    const sn = subtitleNote(m);
    if (sn) notes.push(sn);
  }
  const recs = recommendOf(state.hall, seat.i, seat.c);
  const rb = $('mRec');
  if (recs.length) {
    const r = recs[0];
    rb.hidden = false;
    rb.className = `rec-badge rec-${r.tag}`;
    let text = `후기 추천 ${TAG_LABEL[r.tag]} · ${r.title}`;
    if (r.tag === 'good') text = `후기 추천 · ${r.title}`;
    if (r.tag === 'avoid') text = `후기에서 피하라는 자리 · ${r.title}`;
    rb.textContent = text;
  } else {
    rb.hidden = true;
  }
  $('mNotes').innerHTML = notes.map((n) => `<li>${n}</li>`).join('');
  $('mEst').hidden = !(state.hall.estimated || []).length;
}

function renderPicked() {
  const box = $('pickedList');
  if (!state.party.length) {
    box.innerHTML = `<span class="muted">좌석을 ${state.partySize}개 선택해 주세요</span>`;
  } else {
    box.innerHTML = '';
    state.party.forEach((s) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      if (state.focus === s) chip.classList.add('on');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = s.label;
      b.setAttribute('aria-label', `${s.label} 시점 보기`);
      b.addEventListener('click', () => {
        state.focus = s;
        refreshSeats();
      });
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'chip-x';
      x.textContent = '×';
      x.setAttribute('aria-label', `${s.label} 선택 해제`);
      x.addEventListener('click', () => unpick(s));
      chip.append(b, x);
      box.appendChild(chip);
    });
    const left = state.partySize - state.party.length;
    if (left > 0) {
      const sp = document.createElement('span');
      sp.className = 'muted';
      sp.textContent = `${left}석 더`;
      box.appendChild(sp);
    }
  }
  const total = state.party.length * state.hall.price;
  $('totalPrice').textContent = won(total);
  $('toPay').disabled = state.party.length !== state.partySize;
}

function setParty(n) {
  state.partySize = Math.max(1, Math.min(8, n));
  $('partyCount').textContent = state.partySize;
  if (state.party.length > state.partySize) {
    state.party = state.party.slice(0, state.partySize);
    if (!state.party.includes(state.focus)) state.focus = state.party[state.party.length - 1] || null;
  }
  if (state.hall) refreshSeats();
}

function renderSummary() {
  const { movie, hall } = state;
  const seats = [...state.party].sort((a, b) => a.i - b.i || a.c - b.c).map((s) => s.label).join(', ');
  $('summary').innerHTML = `
    <div class="poster sm" style="--a:${movie.tone[0]};--b:${movie.tone[1]}"><span>${movie.title}</span></div>
    <dl>
      <div><dt>영화</dt><dd>${movie.title}</dd></div>
      <div><dt>일시</dt><dd>${state.date.label} ${state.time}</dd></div>
      <div><dt>극장</dt><dd>${state.theater.name} ${hall.name}</dd></div>
      <div><dt>좌석</dt><dd>${seats}</dd></div>
      <div><dt>인원</dt><dd>일반 ${state.party.length}명</dd></div>
      <div class="sum"><dt>결제 금액</dt><dd>${won(state.party.length * hall.price)}</dd></div>
    </dl>`;
  addPoster($('summary').querySelector('.poster'), movie);
}

function renderTicket() {
  const { movie, hall } = state;
  const seat = state.focus || state.party[0];
  const shot = viewer.capture(seat.i, seat.c);
  const seats = [...state.party].sort((a, b) => a.i - b.i || a.c - b.c).map((s) => s.label).join(', ');
  const no = `${state.date.iso.replaceAll('-', '').slice(2)}-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(100 + Math.random() * 900)}`;
  $('ticket').innerHTML = `
    <p class="done-msg">예매가 완료됐어요</p>
    <div class="ticket-card">
      <figure>
        <img src="${shot}" alt="${seat.label} 좌석에서 본 스크린">
        <figcaption>${seat.label} 자리에서 보이는 화면</figcaption>
      </figure>
      <div class="ticket-body">
        <h3>${movie.title}</h3>
        <dl>
          <div><dt>일시</dt><dd>${state.date.label} ${state.time}</dd></div>
          <div><dt>상영관</dt><dd>${state.theater.name} ${hall.name}</dd></div>
          <div><dt>좌석</dt><dd>${seats}</dd></div>
          <div><dt>예매번호</dt><dd>${no}</dd></div>
        </dl>
      </div>
    </div>`;
}

function bind() {
  document.querySelectorAll('[data-go]').forEach((b) => {
    b.addEventListener('click', () => go(Number(b.dataset.go)));
  });
  $('partyMinus').addEventListener('click', () => setParty(state.partySize - 1));
  $('partyPlus').addEventListener('click', () => setParty(state.partySize + 1));
  $('gradeToggle').addEventListener('change', (e) => {
    state.showGrade = e.target.checked;
    $('seatmap').classList.toggle('show-grade', state.showGrade);
    document.querySelector('.legend').classList.toggle('show-grade', state.showGrade);
  });
  $('btnSub').addEventListener('click', () => {
    state.subOn = !state.subOn;
    $('btnSub').classList.toggle('on', state.subOn);
    viewer.setFrame(frameFor(state.movie));
  });
  $('btnOverview').addEventListener('click', () => viewer && viewer.overview());
  $('btnMySeat').addEventListener('click', () => {
    if (viewer && state.focus) viewer.focus(state.focus.i, state.focus.c);
  });
  $('toPay').addEventListener('click', () => {
    renderSummary();
    go(3);
  });
  $('payNow').addEventListener('click', () => {
    renderTicket();
    go(4);
  });
  $('restart').addEventListener('click', () => {
    state.party = [];
    state.focus = null;
    go(1);
  });
}

renderDates();
renderTheaters();
renderMovies();
if (document.fonts) document.fonts.ready.then(() => viewer && state.movie && viewer.setFrame(frameFor(state.movie)));
bind();
go(1);
