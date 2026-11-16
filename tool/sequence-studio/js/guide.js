const NUMBERS = ["하나", "둘", "셋", "넷", "다섯", "여섯", "일곱", "여덟", "아홉"];
const TENS = ["", "열", "스물", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔"];
const COUNTING = { 하나: "한", 둘: "두", 셋: "세", 넷: "네", 스물: "스무" };
const SINO = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const SINO_PLACES = ["", "십", "백", "천"];
const ROUGH_NATIVE = ["", "한두", "두세", "서너", "네다섯", "대여섯"];
const ROUGH_SINO = ["", "일이", "이삼", "삼사", "사오", "오륙", "육칠", "칠팔", "팔구"];
const LETTERS = {
  A: "에이", B: "비", C: "씨", D: "디", E: "이", F: "에프", G: "지", H: "에이치", I: "아이", J: "제이", K: "케이", L: "엘", M: "엠",
  N: "엔", O: "오", P: "피", Q: "큐", R: "알", S: "에스", T: "티", U: "유", V: "브이", W: "더블유", X: "엑스", Y: "와이", Z: "제트",
};
const NATIVE_UNITS = new Set(["회", "번", "번째", "호흡", "박", "카운트", "세트", "바퀴", "곳", "걸음", "뼘", "개", "가지", "시", "시간"]);
const UNIT_SOUNDS = { cm: "센티", m: "미터", "%": "퍼센트", 회: "번" };

function countWord(n) {
  if (n >= 100) return String(n);
  return TENS[Math.floor(n / 10)] + (n % 10 ? NUMBERS[(n % 10) - 1] : "");
}

function counterWord(n) {
  if (n >= 100) return sinoWord(n);
  const word = countWord(n);
  const tail = Object.keys(COUNTING).find((k) => word.endsWith(k));
  return tail ? word.slice(0, -tail.length) + COUNTING[tail] : word;
}

function timesWord(n) {
  return `${counterWord(n)} 번`;
}

function sinoWord(value) {
  const [whole, fraction] = String(value).split(".");
  let n = Number(whole);
  let out = "";
  if (n >= 10000) {
    const man = Math.floor(n / 10000);
    out = (man === 1 ? "" : sinoWord(man)) + "만";
    n %= 10000;
  }
  const digits = String(n).split("").reverse();
  let rest = "";
  digits.forEach((d, place) => {
    if (d === "0") return;
    rest = (d === "1" && place > 0 ? "" : SINO[d]) + SINO_PLACES[place] + rest;
  });
  out += rest || (out ? "" : "영");
  if (fraction) out += " 점 " + fraction.split("").map((d) => (d === "0" ? "영" : SINO[d])).join("");
  return out;
}

function hasFinal(word) {
  const ch = word.trim().slice(-1);
  if (/\d/.test(ch)) return "013678".includes(ch);
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return false;
  return code % 28 !== 0;
}

function finalIsRieul(word) {
  const code = word.trim().slice(-1).charCodeAt(0) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 === 8;
}

const isIt = (word) => word + (hasFinal(word) ? "이에요" : "예요");
const toward = (word) => word + (hasFinal(word) && !finalIsRieul(word) ? "으로" : "로");
const pick = (list, seed) => list[((seed % list.length) + list.length) % list.length];

function politeEnd(ch) {
  if (ch === "는") return "습니다";
  if (ch === "이") return "입니다";
  const code = ch.charCodeAt(0) - 0xac00;
  const final = code % 28;
  if (final === 4 || final === 8) return String.fromCharCode(ch.charCodeAt(0) - final + 17) + "니다";
  if (final === 0) return String.fromCharCode(ch.charCodeAt(0) + 17) + "니다";
  return ch + "습니다";
}

function linkEnd(ch) {
  if (ch === "는") return "고";
  const code = ch.charCodeAt(0) - 0xac00;
  if (code % 28 === 4) return String.fromCharCode(ch.charCodeAt(0) - 4) + "고";
  return ch + "고";
}

function spoken(text = "") {
  return text
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/([가-힣])다, /g, (m, ch) => linkEnd(ch) + ", ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim().replace(/([가-힣])다(\.?)$/, (m, ch, dot) => (ch === "니" ? m : politeEnd(ch) + (dot || "."))))
    .map((s) => s.replace(/않게(\.?)$/, "않게 해요$1").replace(/([^.!?])$/, "$1."))
    .join(" ")
    .trim();
}

function firstSentence(text = "") {
  return spoken(text.split(/(?<=[.!?])\s+/)[0]);
}

function timeWords(sec) {
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}분 ${s}초` : `${m}분`;
}

function numberWords(text) {
  return text.replace(
    /(\d+(?:\.\d+)?)(?:\s*[~∼]\s*(\d+(?:\.\d+)?))?(?:\s?(cm|m(?![a-z])|%|번째|번|회(?!전)|호흡|박|카운트|세트|바퀴|곳|걸음|뼘|개|가지|시간|시|초|분|도|인치|배|점|센티|자))?/g,
    (match, a, b, unit = "", offset, whole) => {
      const after = whole.slice(offset + match.length);
      const native = NATIVE_UNITS.has(unit) && !(unit === "번" && /^\s*포지션/.test(after)) && !a.includes(".");
      const sound = UNIT_SOUNDS[unit] || unit;
      const one = (n) => (native ? (unit === "번째" && n === "1" ? "첫" : counterWord(Number(n))) : unit === "자" && n === "11" ? "일일" : sinoWord(n));
      const gap = sound ? " " : "";
      if (!b) return one(a) + gap + sound;
      const lo = Number(a);
      const hi = Number(b);
      if (hi === lo + 1 && native && ROUGH_NATIVE[lo]) return ROUGH_NATIVE[lo] + gap + sound;
      if (hi === lo + 1 && !native && ROUGH_SINO[lo] && !a.includes(".")) return ROUGH_SINO[lo] + gap + sound;
      return native ? `${one(a)}${gap}${sound}에서 ${one(b)}${gap}${sound}` : `${one(a)}에서 ${one(b)}${gap}${sound}`;
    },
  );
}

export function speechText(text = "") {
  return numberWords(
    text
      .replace(/\s*\([^)]*\)/g, "")
      .replace(/[\p{Extended_Pictographic}️‍]/gu, "")
      .replace(/(\d+)\s*\/\s*(\d+)/g, "$1 $2"),
  )
    .replace(/(?<![A-Za-z])([A-Z]{1,4})(?![A-Za-z])(?=([가-힣])?)/g, (m, word, next) => [...word].map((c) => LETTERS[c]).join("") + (next ? " " : ""))
    .replace(/\s*[→⇒➜➔]\s*/g, ", ")
    .replace(/\s*[·•]\s*/g, ", ")
    .replace(/\s*\/\s*/g, ", ")
    .replace(/\s*~\s*/g, "에서 ")
    .replace(/([가-힣])\s*[-–—]\s*(?=[가-힣])/g, "$1 ")
    .replace(/['"‘’“”「」『』]/g, "")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/(\s\S*[^.!?\s])$/, "$1.");
}

export function sentences(text) {
  return speechText(text)
    .split(/(?<=[.!?])\s+/)
    .flatMap((sentence) => {
      if (sentence.length <= 90) return [sentence];
      return sentence.split(/(?<=,)\s+/).reduce((parts, piece) => {
        const last = parts.length - 1;
        if (last >= 0 && parts[last].length + piece.length < 70) parts[last] += " " + piece;
        else parts.push(piece);
        return parts;
      }, []);
    })
    .filter(Boolean);
}

const readTime = (text) => Math.ceil(text.length / 6) + 1;

function spread(lines, from, to, texts) {
  if (!texts.length) return;
  const gap = (to - from) / texts.length;
  texts.forEach((text, i) => lines.push({ at: Math.round(from + gap * i), text, kind: "talk" }));
}

function moveLine(seg) {
  const name = seg.pose.name;
  if (seg.kind === "ready") return `시작해 볼게요. 첫 자세는 ${isIt(name)}.`;
  if (seg.item.phase === "rest") return `이제 ${toward(name)} 쉬어 갈게요.`;
  return pick(
    [`다음은 ${isIt(name)}.`, `이어서 ${toward(name)} 갈게요.`, `이번에는 ${isIt(name)}.`, `${toward(name)} 넘어가 볼게요.`],
    seg.order,
  );
}

function startLine(seg, reps) {
  const { item, side } = seg;
  const amount = reps ? timesWord(item.dur) : timeWords(seg.seconds);
  const seed = seg.order;
  if (seg.second) {
    return reps
      ? pick([`${toward(side)} 바꿔요. 똑같이 ${amount} 해요.`, `이번엔 ${isIt(side)}. ${amount} 반복할게요.`, `반대쪽, ${side}도 같은 방법으로 ${amount} 해 볼게요.`], seed)
      : pick([`${toward(side)} 바꿔요. 똑같이 ${amount} 머물러요.`, `이번엔 ${isIt(side)}. ${amount} 유지할게요.`, `반대쪽, ${side}도 같은 방법으로 ${amount} 머물러요.`], seed);
  }
  const from = side ? `${side}부터 ` : "";
  return reps
    ? pick([`${from}${amount} 해 볼게요.`, `${from}${amount} 반복해요.`, `좋아요, ${from}${amount} 갈게요.`], seed)
    : pick([`${from}${amount} 머물러요.`, side ? `${from}${amount} 유지할게요.` : `그대로 ${amount} 유지할게요.`, `좋아요, ${from}${amount} 동안 편하게 숨 쉬어요.`], seed);
}

export function buildScript(seg, level) {
  const { pose, item } = seg;
  const total = seg.seconds;
  const lines = [];
  const say = (at, text, kind = "talk") => text && lines.push({ at: Math.max(0, Math.round(at)), text, kind });
  const seed = seg.order * 2 + (seg.second ? 1 : 0);

  if (seg.kind !== "work") {
    const intro = moveLine(seg);
    say(0, intro);
    const lead = item.cue || (level !== "short" ? firstSentence(pose.setup) : "");
    say(2, lead);
    const setup = firstSentence(pose.setup);
    const used = 2 + readTime(lead) + 1;
    if (level === "full" && item.cue && setup && used + readTime(setup) <= total) say(Math.max(total / 2, used), setup);
    return lines;
  }

  const reps = pose.dose?.type === "reps";
  say(0, startLine(seg, reps));

  const stepCount = seg.second ? 0 : { short: 0, standard: 2, full: 6 }[level];
  const steps = (pose.steps || []).slice(0, stepCount).map(spoken);
  const cueCount = { short: 1, standard: 2, full: 4 }[level];
  const cues = (seg.second ? [...(pose.cues || [])].reverse() : pose.cues || []).slice(0, cueCount).map(spoken);
  const breath = level === "short" ? "" : firstSentence(pose.breath);
  const countdown = !reps && total >= 8;

  if (reps) {
    let t = 3;
    for (const step of steps) {
      if (t + readTime(step) > total * 0.3) break;
      say(t, step);
      t += readTime(step);
    }
    const gap = (total - 1 - t) / item.dur;
    const voiced = level !== "short" && gap >= 2;
    const talk = [...cues];
    if (breath) talk.splice(1, 0, breath);
    for (let n = 1; n <= item.dur; n++) {
      const at = Math.round(t + gap * (n - 1));
      if (!voiced) lines.push({ at, text: "", kind: "tick" });
      else lines.push({ at, text: n === item.dur ? `마지막 ${countWord(n)}` : countWord(n), kind: "count" });
    }
    if (!voiced) {
      const last = t + gap * (item.dur - 3);
      say(t, pick(["일정한 박자로 이어 가요.", "같은 박자로 편하게 계속해요.", "호흡에 맞춰 일정하게 이어 갈게요."], seed));
      if (item.dur >= 8) say(last, pick(["마지막 세 번이에요.", "이제 세 번 남았어요.", "세 번만 더 해요."], seed));
      if (last - t > 12) spread(lines, t + 4, last - 4, talk.slice(0, Math.floor((last - t) / 8)));
    } else if (gap >= 4.5) {
      talk.forEach((c, i) => say(t + gap * Math.floor(((i + 1) * item.dur) / (talk.length + 1)) + 1.2, c));
    }
  } else {
    const stepEnd = steps.length ? Math.min(total * 0.45, 3 + steps.reduce((s, x) => s + readTime(x), 0)) : 3;
    spread(lines, 3, stepEnd, steps);
    const pool = [...cues];
    if (breath) pool.splice(1, 0, breath);
    if (total < 15) pool.splice(1);
    spread(lines, Math.max(stepEnd, 4), total - (countdown ? 5 : 2), pool);
  }

  if (countdown) {
    say(total - 3, "셋", "final");
    say(total - 2, "둘", "final");
    say(total - 1, "하나", "final");
  }
  return lines.sort((a, b) => a.at - b.at);
}
