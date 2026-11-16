import { columns, isSeat, seatLabel, measure, assess, recommendOf } from './metrics.js';

export function drawSeatMap(el, hall, opts) {
  const { occupied, party, focus, showGrade, highlight, onPick } = opts;
  const hlRule = highlight == null ? null : hall.recommend[highlight];
  const cols = columns(hall);
  const key = (i, c) => `${i}-${c}`;
  const picked = new Map(party.map((s) => [key(s.i, s.c), s]));
  const focusKey = focus ? key(focus.i, focus.c) : null;

  const keep = el._hall === hall.id ? el.scrollLeft : null;
  const active = el.contains(document.activeElement) ? document.activeElement.dataset.label : null;
  el._hall = hall.id;
  el.innerHTML = '';
  el.classList.toggle('show-grade', showGrade);
  el.classList.toggle('has-hl', !!hlRule);
  if (hlRule) el.dataset.hl = hlRule.tag;

  el._cols = cols;
  const fit = () => {
    const avail = el.clientWidth - 44;
    let size = Math.min(30, Math.floor(avail / el._cols) - 3);
    if (size < 13) size = 10;
    el.style.setProperty('--s', `${size}px`);
    el.classList.toggle('tiny', size < 13);
  };

  const screenRatio = Math.min(1, hall.screen.width / (cols * hall.seatWidth));
  const scr = document.createElement('div');
  scr.className = 'map-screen';
  scr.innerHTML = `<span style="width:${(screenRatio * 100).toFixed(1)}%"></span><em>SCREEN ${hall.screen.width}m</em>`;
  el.appendChild(scr);

  const grid = document.createElement('div');
  grid.className = 'map-grid';
  grid.style.gridTemplateColumns = `14px repeat(${cols}, var(--s)) 14px`;

  hall.rows.forEach(([row, layout], i) => {
    const lab = document.createElement('span');
    lab.className = 'row-label';
    lab.textContent = row;
    grid.appendChild(lab);

    [...layout].forEach((ch, c) => {
      if (!isSeat(ch)) {
        const gap = document.createElement('span');
        gap.className = ch === '_' ? 'aisle' : 'void';
        grid.appendChild(gap);
        return;
      }
      const k = key(i, c);
      const label = seatLabel(hall, i, c);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'seat';
      b.textContent = label.slice(row.length);
      b.dataset.label = label;
      b.setAttribute('aria-label', ch === 'W' ? `${label} 휠체어석` : label);
      b.setAttribute('aria-pressed', 'false');
      if (ch === 'W') b.classList.add('wheel');

      const m = measure(hall, i, c);
      const a = assess(m, hall);
      if (hlRule && recommendOf(hall, i, c).includes(hlRule)) b.classList.add('hl');
      b.dataset.grade = a.grade;
      b.title = `${label} · 스크린까지 ${m.distance.toFixed(1)}m · 시야각 ${m.hAngle.toFixed(0)}°`;

      if (occupied.has(k)) {
        b.classList.add('taken');
        b.disabled = true;
        b.title = `${label} · 예매 완료`;
      } else if (picked.has(k)) {
        b.classList.add('picked');
        b.setAttribute('aria-pressed', 'true');
        if (k === focusKey) b.classList.add('focus');
      }
      b.addEventListener('click', () => onPick(i, c, label));
      grid.appendChild(b);
    });

    const lab2 = lab.cloneNode(true);
    grid.appendChild(lab2);
  });

  el.appendChild(grid);
  fit();
  el.scrollLeft = keep ?? (el.scrollWidth - el.clientWidth) / 2;
  if (active) {
    const again = grid.querySelector(`[data-label="${active}"]`);
    if (again) again.focus({ preventScroll: true });
  }
  if (!el._ro) {
    el._ro = new ResizeObserver(fit);
    el._ro.observe(el);
  }
}
