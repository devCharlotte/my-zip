(function () {
  'use strict';
  const VERSION = '5.1.1';
  const CDN = 'https://cdn.jsdelivr.net/npm/';
  const SCRIPT = CDN + 'tesseract.js@' + VERSION + '/dist/tesseract.min.js';
  const CORE = CDN + 'tesseract.js-core@5.0.0';
  const LANG = 'https://tessdata.projectnaptha.com/4.0.0';
  let loaded;
  function loadEngine() {
    if (window.Tesseract?.createWorker) return Promise.resolve(window.Tesseract);
    if (!loaded) loaded = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT;
      script.crossOrigin = 'anonymous';
      script.onload = () => window.Tesseract?.createWorker ? resolve(window.Tesseract) : reject(new Error('문자인식 모듈을 사용할 수 없습니다.'));
      script.onerror = () => reject(new Error('문자인식 모듈 다운로드에 실패했습니다. 네트워크 연결을 확인해 주세요.'));
      document.head.append(script);
    }).catch(err => { loaded = null; throw err; });
    return loaded;
  }
  function parseNumber(value) {
    const cleaned = String(value).replace(/[,，\s]/g,'').replace(/[^\d.]/g,'');
    if (!cleaned || (cleaned.match(/\./g)||[]).length > 1) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) && n > 0 && n < 1e12 ? n : null;
  }
  function extractDate(text) {
    const re = /(?:20\d{2})\s*[年.\/-]\s*\d{1,2}\s*[月.\/-]\s*\d{1,2}\s*日?/g;
    for (const match of text.matchAll(re)) {
      const nums = match[0].match(/\d+/g).map(Number);
      if (nums.length !== 3) continue;
      const [y,m,d] = nums;
      const date = new Date(Date.UTC(y,m-1,d));
      if (date.getUTCFullYear() === y && date.getUTCMonth() === m-1 && date.getUTCDate() === d) {
        return y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
      }
    }
    return '';
  }
  function identifyCurrency(text, language) {
    if (/\b(?:JPY|JPN|YEN)\b/i.test(text)||/\d\s*円/.test(text)) return 'JPY';
    if (/\bKRW\b|₩|\d\s*원/.test(text)) return 'KRW';
    if (/\bEUR\b|€/.test(text)) return 'EUR';
    if (/\bGBP\b|£/.test(text)) return 'GBP';
    if (/\bTWD\b|NT\$/.test(text)) return 'TWD';
    if (/\bTHB\b|฿/.test(text)) return 'THB';
    if (/\bVND\b|₫/.test(text)) return 'VND';
    if (/\bCNY\b|\bRMB\b|人民币/.test(text)) return 'CNY';
    if (/\bHKD\b|HK\$/.test(text)) return 'HKD';
    if (/\bSGD\b|S\$/.test(text)) return 'SGD';
    if (/\bUSD\b|US\$/.test(text)) return 'USD';
    if (/[¥￥]/.test(text))return language==='chi_sim'?'CNY':language==='jpn'?'JPY':'';
    if (/\d\s*元/.test(text))return language==='chi_sim'?'CNY':language==='chi_tra'?'TWD':'';
    return '';
  }
  function extractTotal(text) {
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const key = /(?:총\s*결제|총\s*금액|결제\s*금액|합\s*계|총\s*액|grand\s*total|amount\s*(?:due|paid)|total(?:\s*amount)?|ご請求|お会計|合\s*計|総\s*額|お支払)/i;
    const ignore = /(?:subtotal|sub\s*total|소계|小計|お釣|거스름|change|cash|현금\s*수납|預かり)/i;
    const moneyPattern = /(?:[₩¥￥$€£]\s*)?\d{1,3}(?:[,，]\d{3})+(?:\.\d{1,2})?|(?:[₩¥￥$€£]\s*)?\d{1,9}(?:\.\d{1,2})?/g;
    const candidates = [];
    for (let i=0;i<lines.length;i++) {
      const line = lines[i];
      if (ignore.test(line)) continue;
      const isTotal = key.test(line);
      if (!isTotal) continue;
      for (const [offset,target] of [[0,line],[1,lines[i+1]||'']]) {
        const sanitized = target.replace(/20\d{2}[\/.-]\d{1,2}[\/.-]\d{1,2}/g,' ');
        const numbers = [...sanitized.matchAll(moneyPattern)].map(m => ({n:parseNumber(m[0]), raw:m[0]})).filter(x=>x.n!==null);
        if (numbers.length) {
          const item = numbers[numbers.length-1];
          candidates.push({amount:item.n,source:line+(offset?' / '+target:''),score:(offset?2:5)+(isTotal?10:0)+(/grand|ご請求|총\s*결제|결제\s*금액/i.test(line)?3:0)});
        }
      }
    }
    candidates.sort((a,b)=>b.score-a.score);
    return candidates[0]||null;
  }
  function extractMerchant(text) {
    const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const ignore = /(?:receipt|レシート|領収書|領収証|カード|card|tax|tel[:：]|電話|事業者|등록번호|사업자|invoice|판매\s*정보|합계|total|^[\d\s.,:/\-¥￥$₩€£]+$)/i;
    return lines.slice(0,7).find(s=>s.length>=2&&s.length<=75&&!ignore.test(s))||'';
  }
  const knownMerchants=[
  [/^一蘭|ICHIRAN/i,'이치란'],[/^スターバックス|^STARBUCKS/i,'스타벅스'],[/^セブン[‐-]?イレブン|^7[\s-]?ELEVEN/i,'세븐일레븐'],
  [/^ローソン|^LAWSON/i,'로손'],[/^ファミリーマート|^FAMILY\s*MART/i,'패밀리마트'],
  [/^ドン[・･\s]?キホーテ|^DON\s*QUIJOTE/i,'돈키호테'],[/^マクドナルド|^MCDONALD/i,'맥도날드'],
  [/^無印良品|^MUJI\b/i,'무인양품'],[/^ユニクロ|^UNIQLO/i,'유니클로']
];
function koreanMerchant(original){
  const name=String(original||'').trim();
  if(!name)return {text:'',mapped:false};
  if(/[가-힣]/.test(name))return {text:name,mapped:true};
  for(const [pattern,label] of knownMerchants){
    if(pattern.test(name))return {text:name.replace(pattern,label),mapped:true};
  }
  return {text:name,mapped:false};
}
function parse(text, language) {
    const total = extractTotal(text);
    const merchant=extractMerchant(text),korean=koreanMerchant(merchant);
    return {date:extractDate(text),currency:identifyCurrency(text,language),amount:total?.amount||null,amountEvidence:total?.source||'',merchant,merchantKorean:korean.text,koreanMapped:korean.mapped,text:text.trim()};
  }
  async function recognize(file, language, onProgress) {
    if (!file||!file.type.startsWith('image/')) throw Error('이미지 파일만 인식할 수 있습니다.');
    if (file.size > 8*1024*1024) throw Error('8MB 이하 영수증 이미지를 선택해 주세요.');
    const engine=await loadEngine();
    const supported=new Set(['kor','jpn','eng','chi_sim','chi_tra','tha','vie','fra','spa','deu','ita','por','ind','rus','ara']);
    if(!supported.has(language))throw Error('지원되지 않는 언어 설정입니다.');
    const langs=language==='eng'?['eng']:[language,'eng'];
    const worker=await engine.createWorker(langs,1,{
      workerPath: CDN+'tesseract.js@'+VERSION+'/dist/worker.min.js',
      corePath: CORE,
      langPath: LANG,
      logger: m=>onProgress?.(m)
    });
    try {
      const {data}=await worker.recognize(file);
      return {...parse(data.text||'',language),confidence:data.confidence};
    } finally { await worker.terminate(); }
  }
  window.ReceiptOCR = Object.freeze({recognize,parse});
})();
