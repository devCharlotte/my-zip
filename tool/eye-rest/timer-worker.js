const STEP = 20 * 60 * 1000
const LATE_LIMIT = 2 * 60 * 1000

function slotStart(t) {
  const d = new Date(t)
  d.setMinutes(d.getMinutes() - d.getMinutes() % 20, 0, 0)
  return d.getTime()
}

function check(now, last) {
  const slot = slotStart(now)
  if (last == null || slot <= last) return { last: last ?? slot, hit: null }
  const late = now - slot
  return { last: slot, hit: late <= LATE_LIMIT ? { slot, late } : null }
}

let last = null
let wakes = []

function tick() {
  const now = Date.now()
  const r = check(now, last)
  last = r.last
  if (r.hit) postMessage({ type: 'slot', slot: r.hit.slot, late: r.hit.late })

  const due = wakes.filter(w => w.at <= now)
  if (due.length) {
    wakes = wakes.filter(w => w.at > now)
    due.forEach(w => postMessage({ type: 'wake', id: w.id }))
  }

  postMessage({ type: 'tick', now, next: slotStart(now) + STEP })
}

onmessage = e => {
  const msg = e.data
  if (msg.type === 'wake') wakes.push({ id: msg.id, at: msg.at })
  if (msg.type === 'cancel') wakes = wakes.filter(w => w.id !== msg.id)
}

tick()
setInterval(tick, 1000)
