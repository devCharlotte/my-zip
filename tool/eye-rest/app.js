const REST = 20 * 1000
const $ = id => document.getElementById(id)

function load(key, fallback) {
  try {
    const v = localStorage.getItem('eye-rest.' + key)
    return v == null ? fallback : JSON.parse(v)
  } catch {
    return fallback
  }
}

function save(key, value) {
  try {
    localStorage.setItem('eye-rest.' + key, JSON.stringify(value))
  } catch {}
}

let on = load('on', false)
let sound = load('sound', true)
let doneNote = load('doneNote', true)
let voice = load('voice', true)
let recorded = load('recorded', true)
let pausedUntil = load('pausedUntil', 0)
let nextAt = null
let rest = null
let restSeq = 0
let audio = null

const supported = 'Notification' in window && 'serviceWorker' in navigator && window.isSecureContext
const swReady = supported
  ? navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).catch(() => null)
  : Promise.resolve(null)

const worker = new Worker('timer-worker.js')
worker.onmessage = e => {
  const m = e.data
  if (m.type === 'tick') {
    nextAt = m.next
    render()
  } else if (m.type === 'slot') {
    onSlot(m)
  } else if (m.type === 'wake') {
    finishRest(m.id)
  }
}

function permission() {
  return supported ? Notification.permission : 'unsupported'
}

function live() {
  return on && permission() === 'granted'
}

function hhmm(t) {
  const d = new Date(t)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

function firstSlotFrom(t) {
  const d = new Date(t)
  const m = d.getMinutes()
  if (m % 20 === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0) return t
  d.setMinutes(m - m % 20 + 20, 0, 0)
  return d.getTime()
}

function dayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function todayCount() {
  const c = load('count', null)
  return c && c.day === dayKey() ? c.n : 0
}

async function notify(title, body) {
  if (permission() !== 'granted') return
  const opts = { body, tag: 'eye-rest', renotify: true, lang: 'ko' }
  const reg = await swReady
  try {
    if (reg) await reg.showNotification(title, opts)
    else new Notification(title, opts)
  } catch {}
}

function unlockAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!audio && Ctx) audio = new Ctx()
  if (audio && audio.state === 'suspended') audio.resume().catch(() => {})
}

function beep(notes) {
  if (!sound || !audio || audio.state !== 'running') return
  const t = audio.currentTime
  notes.forEach((freq, i) => {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    const start = t + i * 0.22
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.16, start + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2)
    osc.connect(gain).connect(audio.destination)
    osc.start(start)
    osc.stop(start + 0.22)
  })
}

const COUNT_WORDS = ['', '하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉', '열',
  '열하나', '열둘', '열셋', '열넷', '열다섯', '열여섯', '열일곱', '열여덟', '열아홉', '스물']
const speech = 'speechSynthesis' in window ? window.speechSynthesis : null
let koVoice = null

function voiceRank(v) {
  if (/natural|online/i.test(v.name)) return 0
  if (/google/i.test(v.name)) return 1
  if (/premium|enhanced|neural/i.test(v.name)) return 2
  return v.localService === false ? 3 : 4
}

function pickVoice() {
  const ko = speech.getVoices().filter(v => v.lang.replace('_', '-').toLowerCase().startsWith('ko'))
  koVoice = ko.sort((a, b) => voiceRank(a) - voiceRank(b))[0] || null
}

if (speech) {
  pickVoice()
  speech.addEventListener('voiceschanged', pickVoice)
}

let clips = {}
const clipCache = new Map()
let clip = null

fetch('audio/index.json')
  .then(r => r.ok ? r.json() : {})
  .then(map => { clips = map || {} })
  .catch(() => {})

function voiceKey(text) {
  let a = 0xdeadbeef ^ text.length
  let b = 0x41c6ce57 ^ text.length
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 2654435761)
    b = Math.imul(b ^ c, 1597334677)
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)
  return ((b >>> 0).toString(16).padStart(8, '0') + (a >>> 0).toString(16).padStart(8, '0')).slice(0, 12)
}

function clipFor(text) {
  const key = voiceKey(text)
  if (!recorded || !clips[key]) return null
  if (!clipCache.has(key)) {
    const el = new Audio('audio/' + key + '.mp3')
    el.preload = 'auto'
    clipCache.set(key, el)
  }
  return clipCache.get(key)
}

function warmClips() {
  if (!voice) return
  clipFor('이십 초 동안 먼 곳을 봐요.')
  COUNT_WORDS.slice(1, 20).forEach(clipFor)
  clipFor('끝, 잘 쉬었어요.')
}

function stopVoice() {
  if (clip) {
    clip.pause()
    clip = null
  }
  speech?.cancel()
}

function speaking() {
  return Boolean(clip && !clip.paused && !clip.ended) || Boolean(speech?.speaking || speech?.pending)
}

function say(text) {
  if (!voice) return
  const el = clipFor(text)
  if (el) {
    stopVoice()
    clip = el
    el.currentTime = 0
    el.onerror = () => {
      if (clip !== el) return
      clip = null
      speak(text)
    }
    el.play().catch(() => {
      if (clip !== el) return
      clip = null
      speak(text)
    })
    return
  }
  speak(text)
}

function speak(text) {
  if (!speech) return
  if (!koVoice) pickVoice()
  const u = new SpeechSynthesisUtterance(text)
  if (koVoice) u.voice = koVoice
  u.lang = koVoice ? koVoice.lang : 'ko-KR'
  u.rate = 1
  u.pitch = 1
  speech.speak(u)
}

function count(left) {
  if (!rest || rest.said === left) return
  rest.said = left
  if (left === 20) say('이십 초 동안 먼 곳을 봐요.')
  else if (left > 0 && !speaking()) say(COUNT_WORDS[left])
}

function onSlot({ slot, late }) {
  if (load('lastSlot', 0) >= slot) return
  save('lastSlot', slot)
  if (!live() || Date.now() < pausedUntil) return
  startRest(late > 5000 ? 'late' : 'normal')
}

function startRest(kind) {
  if (rest) worker.postMessage({ type: 'cancel', id: rest.id })
  rest = { id: ++restSeq, end: Date.now() + REST, test: kind === 'test' }
  worker.postMessage({ type: 'wake', id: rest.id, at: rest.end })

  const bodies = {
    normal: '20초 동안 6m 넘게 떨어진 곳을 바라봐요.',
    late: '조금 늦었지만 지금 20초만 먼 곳을 봐요.',
    test: '이렇게 알림이 떠요. 20초 뒤에 끝 알림도 와요.'
  }
  notify(kind === 'test' ? '테스트 알림' : '눈 쉬기 시간이에요', bodies[kind])
  beep([660, 880])
  warmClips()
  $('overlay').hidden = false
  render()
}

function finishRest(id) {
  if (!rest || rest.id !== id) return
  if (!rest.test) save('count', { day: dayKey(), n: todayCount() + 1 })
  rest = null
  if (doneNote) notify('다시 작업해도 돼요', nextAt ? `잘 쉬었어요. 다음 알림은 ${hhmm(nextAt)}이에요.` : '잘 쉬었어요.')
  beep([880, 660])
  say('끝, 잘 쉬었어요.')
  render()
}

function skipRest() {
  if (!rest) return
  worker.postMessage({ type: 'cancel', id: rest.id })
  rest = null
  stopVoice()
  render()
}

const fixes = {
  denied: [
    '주소창 왼쪽 자물쇠(사이트 정보)를 누르고 알림을 <b>허용</b>으로 바꿔요.',
    '페이지를 새로고침한 뒤 알림 켜기를 다시 눌러요.',
    'Windows 설정 → 시스템 → 알림에서 Google Chrome 이 켜져 있는지 봐요.',
    '집중 지원(방해 금지)이 켜져 있으면 꺼 주세요.'
  ],
  unsupported: [
    'Windows 라면 Chrome 이나 Edge 최신 버전으로 열어 주세요.',
    '파일을 더블클릭한 file:// 주소에서는 안 돼요. http(s) 주소로 열어 주세요.'
  ]
}

let shownFix = null

function renderStatus() {
  const p = permission()
  const paused = Date.now() < pausedUntil
  let pill = '허용됨'
  let text = '권한은 있어요. 켜기를 누르면 시작해요.'

  if (p === 'unsupported') {
    pill = '미지원'
    text = '이 브라우저에서는 PC 알림을 쓸 수 없어요.'
  } else if (p === 'denied') {
    pill = '차단됨'
    text = '브라우저가 이 사이트의 알림을 막고 있어요.'
  } else if (p === 'default') {
    pill = '허용 전'
    text = '켜기를 누르면 Chrome 이 알림 허용을 물어봐요.'
  } else if (on) {
    text = paused ? '켜져 있지만 지금은 잠깐 멈춘 상태예요.' : '켜져 있어요. 창을 내려 둬도 알림이 와요.'
  }

  $('pill').textContent = pill
  $('pill').className = 'pill ' + p
  $('statusText').textContent = text

  const fix = fixes[p] ? p : null
  if (fix !== shownFix) {
    shownFix = fix
    $('fix').hidden = !fix
    $('fixList').innerHTML = fix ? fixes[fix].map(s => `<li>${s}</li>`).join('') : ''
  }

  const isLive = live()
  $('toggle').setAttribute('aria-pressed', String(isLive))
  $('toggle').classList.toggle('on', isLive)
  $('toggleText').textContent = isLive ? '알림 끄기' : '알림 켜기'
  $('toggle').disabled = p === 'unsupported'
}

function render() {
  const now = Date.now()
  const paused = now < pausedUntil
  const untilText = new Date(pausedUntil).getDate() !== new Date(now).getDate()
    ? '오늘은 쉬어요. 내일 다시 울려요.'
    : `${hhmm(pausedUntil)}까지 멈춤`
  renderStatus()

  const shown = paused ? firstSlotFrom(pausedUntil) : nextAt
  $('nextAt').textContent = shown ? hhmm(shown) : '--:--'
  if (!live()) {
    $('left').textContent = '알림이 꺼져 있어요'
  } else if (paused) {
    $('left').textContent = untilText
  } else if (nextAt) {
    const s = Math.max(0, Math.ceil((nextAt - now) / 1000))
    $('left').textContent = `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초 남음`
  }

  $('pauseBtns').hidden = paused
  $('pausedBox').hidden = !paused
  $('pausedText').textContent = untilText

  $('count').textContent = todayCount()

  if (rest) {
    const left = Math.max(0, Math.ceil((rest.end - now) / 1000))
    $('sec').textContent = left
    count(left)
    $('ring').style.setProperty('--p', left / 20)
    $('overlay').hidden = false
    document.title = `${left}초 먼 곳 보기`
  } else {
    $('overlay').hidden = true
    if (!live()) document.title = '꺼짐 | 눈 쉬기'
    else if (paused) document.title = '멈춤 | 눈 쉬기'
    else document.title = nextAt ? `다음 ${hhmm(nextAt)} | 눈 쉬기` : '눈 쉬기 알림'
  }
}

$('toggle').onclick = async () => {
  unlockAudio()
  if (live()) {
    on = false
  } else {
    if (permission() === 'default') await Notification.requestPermission()
    on = permission() === 'granted'
  }
  save('on', on)
  render()
}

document.querySelectorAll('[data-pause]').forEach(btn => {
  btn.onclick = () => {
    const d = new Date()
    pausedUntil = btn.dataset.pause === 'hour'
      ? Date.now() + 60 * 60 * 1000
      : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
    save('pausedUntil', pausedUntil)
    render()
  }
})

$('resume').onclick = () => {
  pausedUntil = 0
  save('pausedUntil', 0)
  render()
}

$('sound').checked = sound
$('sound').onchange = e => {
  sound = e.target.checked
  save('sound', sound)
  if (sound) {
    unlockAudio()
    beep([660])
  }
}

$('voice').checked = voice
$('voice').onchange = e => {
  voice = e.target.checked
  save('voice', voice)
  if (voice) say('카운트를 읽어 줄게요')
}

$('recorded').checked = recorded
$('recorded').onchange = e => {
  recorded = e.target.checked
  save('recorded', recorded)
  if (voice) say('카운트를 읽어 줄게요')
}

$('doneNote').checked = doneNote
$('doneNote').onchange = e => {
  doneNote = e.target.checked
  save('doneNote', doneNote)
}

$('test').onclick = async () => {
  unlockAudio()
  if (permission() === 'default') await Notification.requestPermission()
  startRest('test')
}

$('skip').onclick = skipRest
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') skipRest()
})

document.addEventListener('pointerdown', unlockAudio, { once: true })
document.addEventListener('keydown', unlockAudio, { once: true })

navigator.permissions?.query({ name: 'notifications' })
  .then(s => { s.onchange = render })
  .catch(() => {})

render()
