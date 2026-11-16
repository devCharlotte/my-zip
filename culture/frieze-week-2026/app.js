
const D = window.FRIEZE_DATA;
const C = window.FRIEZE_CONFIG || {};
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const ORDER = ["2026-08-31","2026-09-01","2026-09-02","2026-09-03"];
const saved = new Set(JSON.parse(localStorage.getItem("friezeSavedPlaces2026") || "[]"));
const state = { day:"all", filter:"all", q:"", savedOnly:false };

let naverMap = null;
let naverMarkers = [];

const AREA = {
  all:{lat:37.5565,lng:127.0155,zoom:11},
  "2026-08-31":{lat:37.5662,lng:126.9916,zoom:14},
  "2026-09-01":{lat:37.5352,lng:127.0030,zoom:13},
  "2026-09-02":{lat:37.5228,lng:127.0430,zoom:13},
  "2026-09-03":{lat:37.5804,lng:126.9820,zoom:14}
};

const esc = s => String(s ?? "").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const naverSearch = e => `https://map.naver.com/p/search/${encodeURIComponent(e.venue+" "+e.address)}`;
const parseKey = g => `${g.day}__${g.venueKey}`;

function kstNow(){
  const parts = new Intl.DateTimeFormat("en-CA",{
    timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"
  }).formatToParts(new Date());
  const o=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return {date:`${o.year}-${o.month}-${o.day}`, mins:+o.hour*60 + +o.minute, hm:`${o.hour}:${o.minute}`};
}

function exactMinutes(s){
  const m=String(s).match(/(\d{1,2}):(\d{2})/);
  return m ? (+m[1]*60 + +m[2]) : null;
}
function endMinutes(s){
  const ms=[...String(s).matchAll(/(\d{1,2}):(\d{2})/g)];
  if(ms.length>=2) return +ms[1][1]*60 + +ms[1][2];
  if(/24:00|~24/.test(s)) return 1440;
  if(/Late/i.test(s)) return 1439;
  return null;
}
function liveStatus(e){
  const n=kstNow();
  if(n.date!==e.day) return "";
  const st=exactMinutes(e.time), en=endMinutes(e.time);
  if(st===null) return "TODAY";
  if(n.mins < st) return st-n.mins<=90 ? "NEXT" : "TODAY";
  if(en!==null && n.mins<=en) return "NOW";
  if(en===null && n.mins<=st+90) return "NOW";
  return "ENDED";
}
function dateDelta(day){
  const today=kstNow().date;
  const a=new Date(today+"T00:00:00+09:00"), b=new Date(day+"T00:00:00+09:00");
  return Math.round((b-a)/86400000);
}
function accessKind(e){
  const a=(e.access||"").toLowerCase();
  if(a.includes("vip")||a.includes("초청")) return "VIP";
  if(a.includes("rsvp")||a.includes("예약")||a.includes("신청")) return "RSVP";
  if(a.includes("티켓")) return "TICKET";
  if(a.includes("누구나")||a.includes("무료")) return "PUBLIC";
  return "CHECK";
}
function closesLate(e){
  const en=endMinutes(e.time);
  return (en!==null && en>=1320) || /Late|24:00|23:00|22:30|22:00/.test(e.time);
}

function groupEvents(events){
  const m=new Map();
  events.forEach(e=>{
    const key=parseKey(e);
    if(!m.has(key)){
      m.set(key,{key,day:e.day,venue:e.venue,venueKey:e.venueKey,address:e.address,events:[],naver:e.naver});
    }
    m.get(key).events.push(e);
  });
  return [...m.values()].map(g=>{
    g.events.sort((a,b)=>a.sort.localeCompare(b.sort));
    g.food=g.events.some(e=>e.food==="food");
    g.drinks=g.events.some(e=>e.food==="drinks");
    g.afterWork=g.events.some(e=>e.afterWork);
    g.featured=g.events.some(e=>e.featured);
    g.public=g.events.some(e=>accessKind(e)==="PUBLIC");
    g.rsvp=g.events.some(e=>accessKind(e)==="RSVP");
    g.late=g.events.some(closesLate);
    return g;
  });
}

function rawMatch(e){
  if(state.day!=="all"&&e.day!==state.day)return false;
  if(state.filter==="afterwork"&&!e.afterWork)return false;
  if(state.filter==="food"&&e.food!=="food")return false;
  if(state.filter==="drinks"&&e.food!=="drinks")return false;
  if(state.filter==="public"&&accessKind(e)!=="PUBLIC")return false;
  if(state.filter==="late"&&!closesLate(e))return false;
  if(state.filter==="extra"&&e.scope!=="extra")return false;
  if(!["all","afterwork","food","drinks","public","late","extra"].includes(state.filter)&&!e.types.includes(state.filter))return false;
  if(state.savedOnly&&!saved.has(e.venueKey))return false;
  if(state.q){
    const h=[e.venue,e.title,e.program,e.address,e.time,e.access,e.foodDetail,e.verificationNote,...e.types].join(" ").toLowerCase();
    if(!h.includes(state.q.toLowerCase()))return false;
  }
  return true;
}


function b64EncodeUnicode(str){
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function b64DecodeUnicode(str){
  const s=str.replace(/-/g,"+").replace(/_/g,"/");
  return decodeURIComponent(escape(atob(s + "===".slice((s.length+3)%4))));
}
function importSharedPicks(){
  const p=new URLSearchParams(location.search).get("p");
  if(!p)return;
  try{
    const arr=JSON.parse(b64DecodeUnicode(p));
    if(Array.isArray(arr)){
      arr.forEach(k=>saved.add(k));
      localStorage.setItem("friezeSavedPlaces2026",JSON.stringify([...saved]));
    }
  }catch(_){}
}
function sharePicks(){
  if(!saved.size){toast("먼저 장소를 저장해주세요.");return;}
  const u=new URL(location.href);
  u.hash="";
  u.searchParams.set("p",b64EncodeUnicode(JSON.stringify([...saved])));
  const text="2026 FRIEZE WEEK, 같이 볼 장소를 골라뒀어요.";
  if(navigator.share){
    navigator.share({title:"2026 FRIEZE WEEK, MY PLACES",text,url:u.toString()}).catch(()=>{});
  }else if(navigator.clipboard){
    navigator.clipboard.writeText(u.toString()).then(()=>toast("MY PLACES 공유 링크를 복사했습니다."));
  }
}
function icsEscape(s){
  return String(s||"").replace(/\\/g,"\\\\").replace(/\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");
}
function toICSDate(day,time){
  const m=String(time).match(/(\d{1,2}):(\d{2})/);
  if(!m)return null;
  return day.replace(/-/g,"")+"T"+String(m[1]).padStart(2,"0")+m[2]+"00";
}
function exportCalendar(){
  const selected=D.events.filter(e=>saved.has(e.venueKey));
  if(!selected.length){toast("먼저 장소를 저장해주세요.");return;}
  const rows=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//2026 FRIEZE WEEK//KO","CALSCALE:GREGORIAN"];
  selected.forEach(e=>{
    const start=toICSDate(e.day,e.time);
    if(!start)return;
    const times=[...String(e.time).matchAll(/(\d{1,2}):(\d{2})/g)];
    let end=null;
    if(times.length>1) end=e.day.replace(/-/g,"")+"T"+String(times[1][1]).padStart(2,"0")+times[1][2]+"00";
    rows.push("BEGIN:VEVENT");
    rows.push("UID:"+icsEscape(e.id)+"@2026-frieze-week");
    rows.push("DTSTART;TZID=Asia/Seoul:"+start);
    if(end)rows.push("DTEND;TZID=Asia/Seoul:"+end);
    rows.push("SUMMARY:"+icsEscape(e.venue+", "+e.title));
    rows.push("LOCATION:"+icsEscape(e.address));
    rows.push("DESCRIPTION:"+icsEscape(e.program+"\\nNAVER MAP: "+(e.naver?naverSearch(e):"")));
    rows.push("END:VEVENT");
  });
  rows.push("END:VCALENDAR");
  const blob=new Blob([rows.join("\r\n")],{type:"text/calendar;charset=utf-8"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="2026-frieze-week-my-places.ics";a.click();URL.revokeObjectURL(url);
}


function tabs(){
  $("#dayTabs").innerHTML=
    `<button class="day-tab" data-day="all"><b>ALL DATES</b><small>08.31 — 09.03</small></button>`+
    ORDER.map(d=>`<button class="day-tab" data-day="${d}"><b>${esc(D.days[d].label)}</b><small>${esc(D.days[d].name)}</small></button>`).join("");
  $$(".day-tab").forEach(b=>b.onclick=()=>setDay(b.dataset.day));
  syncTabs();
}
function syncTabs(){
  $$(".day-tab").forEach(b=>b.classList.toggle("active",b.dataset.day===state.day));
}
function setDay(day){
  state.day=day;
  state.filter="all";
  $$(".chip").forEach(x=>x.classList.toggle("active",x.dataset.filter==="all"));
  syncTabs();
  render();
  updateMapViewport();
}

function foodSummary(g){
  const foods=g.events.filter(e=>e.food==="food");
  const drinks=g.events.filter(e=>e.food==="drinks");
  if(foods.length){
    const details=[...new Set(foods.map(e=>e.foodDetail).filter(Boolean))].join(", ");
    return `<div class="food-callout"><span class="food-badge">FOOD</span><b>${esc(details||"케이터링/다과")}</b></div>`;
  }
  if(drinks.length){
    const details=[...new Set(drinks.map(e=>e.foodDetail).filter(Boolean))].join(", ");
    return `<div class="drink-callout"><span class="drink-badge">DRINKS</span><b>${esc(details||"드링크 리셉션")}</b></div>`;
  }
  return "";
}
function programRows(g){
  return g.events.map(e=>{
    const st=liveStatus(e);
    return `<div class="mini-program">
      <time>${esc(e.time)}</time>
      <div><b>${esc(e.title)}</b><span>${esc(e.program)}</span></div>
      ${st?`<em class="live ${st.toLowerCase()}">${st}</em>`:""}
    </div>`;
  }).join("");
}
function groupCard(g){
  const on=saved.has(g.venueKey);
  const kinds=[...new Set(g.events.map(accessKind))];
  const first=g.events[0];
  return `<article class="venue-card ${g.food?"has-food":""}">
    <div class="venue-head">
      <div>
        <div class="venue-kicker">${esc(D.days[g.day].label)}, ${g.afterWork?"AFTER 5":"DAY PROGRAM"}</div>
        <h3>${esc(g.venue)}</h3>
        <p>${esc(g.address)}</p>
      </div>
      <button class="place-save ${on?"on":""}" data-place="${esc(g.venueKey)}">${on?"★":"☆"} <span>${on?"SAVED":"SAVE"}</span></button>
    </div>

    ${foodSummary(g)}

    <div class="quick-badges">
      ${kinds.map(k=>`<span class="access-badge access-${k.toLowerCase()}">${k}</span>`).join("")}
      ${g.late?'<span class="access-badge">LATE</span>':""}
      ${g.events.some(e=>e.scope==="extra")?'<span class="extra-badge">FRIEZE EXTRA</span>':""}
    </div>

    <div class="mini-programs">${programRows(g)}</div>

    <div class="card-actions">
      <a class="primary-link" href="#/place/${encodeURIComponent(g.day)}/${encodeURIComponent(g.venueKey)}">DETAILS →</a>
      ${g.naver?`<a href="${naverSearch(first)}" target="_blank" rel="noopener">NAVER MAP ↗</a>`:""}
      <button data-share-place="${esc(g.key)}">SHARE</button>
    </div>
  </article>`;
}

function computeStats(events){
  const groups=groupEvents(events);
  return {
    places:groups.length,
    food:groups.filter(g=>g.food).length,
    public:groups.filter(g=>g.public).length,
    late:groups.filter(g=>g.late).length
  };
}
function applyFilter(f){
  state.filter=f;
  $$(".chip").forEach(x=>x.classList.toggle("active",x.dataset.filter===f));
  render();
}

function render(){

  const filtered=D.events.filter(rawMatch);
  const groups=groupEvents(filtered).sort((a,b)=>{
    const nowA=a.events.some(e=>liveStatus(e)==="NOW")?1:0;
    const nowB=b.events.some(e=>liveStatus(e)==="NOW")?1:0;
    if(nowA!==nowB)return nowB-nowA;
    if(state.filter==="food"&&a.food!==b.food)return b.food-a.food;
    if(a.afterWork!==b.afterWork)return b.afterWork-a.afterWork;
    return a.day.localeCompare(b.day)||a.events[0].sort.localeCompare(b.events[0].sort)||a.venue.localeCompare(b.venue);
  });

  $("#eventList").innerHTML=groups.length?groups.map(groupCard).join(""):`<div class="empty-state"><b>조건에 맞는 장소가 없습니다.</b><span>필터를 조금 풀어보세요.</span></div>`;
  $("#resultCount").textContent=groups.length;

  const day=state.day==="all"?null:D.days[state.day];
  $("#sectionEyebrow").textContent=day?day.label:"ALL NIGHTS";
  $("#sectionTitle").textContent=
    state.savedOnly?"내가 저장한 장소":
    state.filter==="food"?"FOOD / CATERING":
    state.filter==="late"?"늦게까지 여는 곳":
    state.filter==="extra"?"Frieze Week Extra":
    day?day.name:"퇴근 후 먼저 볼 장소";

  $("#coverageBanner").innerHTML=day
    ? `<b>${esc(day.fairContext||"")}</b><br>${esc(day.foodTip||"")}<br><span>${esc(day.coverage)}</span>`
    : `<b>${esc(D.meta.siteCatch)}</b><br>${esc(D.meta.coverageNote)}`;

  $$("[data-place]").forEach(b=>b.onclick=()=>togglePlace(b.dataset.place));
  $$("[data-share-place]").forEach(b=>b.onclick=()=>shareGroupByKey(b.dataset.sharePlace));
  renderSaved();
  renderVerifiedMarkers(filtered);
}

function togglePlace(key){
  saved.has(key)?saved.delete(key):saved.add(key);
  localStorage.setItem("friezeSavedPlaces2026",JSON.stringify([...saved]));
  render();
  if(location.hash.startsWith("#/place/"))renderRoute();
}
function renderSaved(){
  const places=groupEvents(D.events).filter(g=>saved.has(g.venueKey));
  $("#savedCount").textContent=new Set(places.map(g=>g.venueKey)).size;
  $("#savedPanelCount").textContent=new Set(places.map(g=>g.venueKey)).size;
  const uniq=new Map();
  places.forEach(g=>{if(!uniq.has(g.venueKey))uniq.set(g.venueKey,g)});
  $("#savedList").innerHTML=uniq.size?[...uniq.values()].map(g=>{
    const e=g.events[0];
    return `<div class="saved-item"><div><b>${esc(g.venue)}</b><br><span>${esc(g.address)}</span></div>${g.naver?`<a href="${naverSearch(e)}" target="_blank" rel="noopener">NAVER ↗</a>`:""}</div>`;
  }).join(""):`<p class="empty">☆ 장소를 저장하면 친구들과 갈 곳만 모아볼 수 있습니다.</p>`;
}

function groupByRoute(day,key){
  return groupEvents(D.events.filter(e=>e.day===day&&e.venueKey===key))[0];
}

function venueProfile(g){
  return D.venueProfiles?.[g.venue] || null;
}
function detailedTimelineForDay(d){
  const list=D.events.filter(e=>e.day===d).slice().sort((a,b)=>{
    const ta=(a.sort||"99:00"), tb=(b.sort||"99:00");
    if(ta!==tb)return ta.localeCompare(tb);
    return a.venue.localeCompare(b.venue);
  });
  return list;
}
function timelineKind(e){
  if(e.anchor)return "FIXED";
  if(/추후|비공개|별도|개별 확인/.test(e.time))return "TBA";
  if(/–|-|~/.test(e.time))return "WINDOW";
  return "TIME";
}
function courseGuideHTML(d){
  const guides=D.courseGuides?.[d]||[];
  if(!guides.length)return "";
  return `<div class="course-guide">
    <div class="course-guide-head"><b>COURSE GUIDE</b><span>공식 시작, 종료 시각을 기준으로 구성한 제안입니다. 실제 이동시간은 NAVER MAP에서 확인하세요.</span></div>
    ${guides.map(g=>`<section class="course-option">
      <h4>${esc(g.title)}</h4>
      <p>${esc(g.note)}</p>
      <div class="course-stops">${g.stops.map((s,i)=>`<div class="course-stop">
        <span>${i+1}</span><time>${esc(s[0])}</time><div><b>${esc(s[1])}</b><small>${esc(s[2])}</small></div>
      </div>`).join("")}</div>
    </section>`).join("")}
  </div>`;
}

function detail(g){
  const first=g.events[0], on=saved.has(g.venueKey);
  const allFood=[...new Set(g.events.filter(e=>e.food==="food").map(e=>e.foodDetail).filter(Boolean))];
  const allDrinks=[...new Set(g.events.filter(e=>e.food==="drinks").map(e=>e.foodDetail).filter(Boolean))];
  const access=[...new Set(g.events.map(e=>e.access))];
  const notes=[...new Set(g.events.map(e=>e.verificationNote).filter(Boolean))];
  const artistInfo=[...new Set(g.events.map(e=>e.artistInfo).filter(Boolean))];
  const exhibitionInfo=[...new Set(g.events.map(e=>e.exhibitionInfo).filter(Boolean))];
  const vp=venueProfile(g);

  $("#detailContent").innerHTML=`
    <section class="detail-hero ${g.food?"detail-food":""}">
      <p class="eyebrow">${esc(D.days[g.day].label)}, ${esc(D.days[g.day].name)}</p>
      <h1>${esc(g.venue)}</h1>
      <div class="detail-address">${esc(g.address)}</div>
      <div class="detail-actions">
        <button class="action-btn primary" data-detail-save>${on?"★ SAVED PLACE":"☆ SAVE PLACE"}</button>
        ${g.naver?`<a class="action-btn" href="${naverSearch(first)}" target="_blank" rel="noopener">NAVER MAP ↗</a>`:""}
        <button class="action-btn" data-detail-share>SHARE</button>
      </div>
    </section>

    <section class="detail-grid">
      <aside class="detail-facts">
        <div class="fact"><span>DATE</span><b>${esc(g.day)}, ${esc(D.days[g.day].name)}</b></div>
        <div class="fact"><span>ACCESS</span><b>${access.map(esc).join("<br>")}</b></div>
        <div class="fact"><span>LATE</span><b>${g.late?"22시 전후, 이후까지 운영":"일정별 종료시간 확인"}</b></div>
        ${allFood.length?`<div class="fact food-fact"><span>FOOD</span><b>${allFood.map(esc).join("<br>")}</b></div>`:""}
        ${allDrinks.length?`<div class="fact drink-fact"><span>DRINKS</span><b>${allDrinks.map(esc).join("<br>")}</b></div>`:""}
        ${vp?`<div class="fact profile-fact"><span>${esc(vp.label)}</span><b>${esc(vp.why)}</b></div>`:""}
      </aside>

      <div class="detail-body">
        ${vp?`<section class="venue-profile">
          <div class="venue-profile-label">${esc(vp.label)}</div>
          <h2>${esc(g.venue)}는 어떤 곳?</h2>
          <p>${esc(vp.summary)}</p>
          <a href="${vp.url}" target="_blank" rel="noopener">공간 공식 정보 ↗</a>
        </section>`:""}

        ${exhibitionInfo.length?`<h2>EXHIBITION INFO</h2>
          ${exhibitionInfo.map(x=>`<div class="info-note"><b>전시</b><p>${esc(x)}</p></div>`).join("")}`:""}

        ${artistInfo.length?`<h2>ARTIST INFO</h2>
          ${artistInfo.map(x=>`<div class="info-note artist-note"><b>작가</b><p>${esc(x)}</p></div>`).join("")}`:""}

        <h2>PROGRAM TIMELINE</h2>
        <div class="detail-programs">
          ${g.events.map(e=>`<section class="detail-program">
            <div class="detail-program-time">${esc(e.time)}
              <span class="timeline-kind ${timelineKind(e).toLowerCase()}">${timelineKind(e)}</span>
              ${liveStatus(e)?`<em class="live ${liveStatus(e).toLowerCase()}">${liveStatus(e)}</em>`:""}
            </div>
            <h3>${esc(e.title)}</h3>
            <p>${esc(e.program)}</p>
            <div class="tag-row">${e.types.map(t=>`<span class="tag">${esc(t)}</span>`).join("")}<span class="access-badge access-${accessKind(e).toLowerCase()}">${accessKind(e)}</span></div>
          </section>`).join("")}
        </div>

        ${notes.length?`<h2>VERIFY BEFORE YOU GO</h2>${notes.map(n=>`<div class="verify-note">${esc(n)}</div>`).join("")}`:""}


        <h2 class="detail-section-gap">FRIEZE WEEK CONTEXT</h2>
        <p>${esc(D.days[g.day].fairContext||"")}</p>
      </div>
    </section>`;
  $("[data-detail-save]").onclick=()=>togglePlace(g.venueKey);
  $("[data-detail-share]").onclick=()=>shareGroup(g);
}
function renderRoute(){
  const m=location.hash.match(/^#\/place\/([^/]+)\/(.+)$/);
  if(m){
    const day=decodeURIComponent(m[1]), key=decodeURIComponent(m[2]);
    const g=groupByRoute(day,key);
    if(g){
      $("#listView").hidden=true; $("#detailView").hidden=false; detail(g); window.scrollTo(0,0); return;
    }
  }
  $("#detailView").hidden=true; $("#listView").hidden=false; render();
}
async function shareGroup(g){
  const url=location.href.split("#")[0]+`#/place/${encodeURIComponent(g.day)}/${encodeURIComponent(g.venueKey)}`;
  const text=`${D.days[g.day].label}, ${g.venue}\n${g.events.map(e=>`${e.time} ${e.title}`).join("\n")}`;
  try{
    if(navigator.share) await navigator.share({title:`2026 FRIEZE WEEK, ${g.venue}`,text,url});
    else {await navigator.clipboard.writeText(url);toast("링크를 복사했습니다.");}
  }catch(_){}
}
function shareGroupByKey(key){
  const [day,...rest]=key.split("__"); const venueKey=rest.join("__");
  const g=groupByRoute(day,venueKey); if(g)shareGroup(g);
}
function toast(msg){
  let t=$("#toast"); if(!t){t=document.createElement("div");t.id="toast";t.className="toast";document.body.appendChild(t);}
  t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),1800);
}

function shuttleTable(day){
  if(!day.shuttles)return "";
  const one=k=>{const stops=day.shuttles[k+"_stops"];return `<div class="info-block"><h3>FREE SHUTTLE, COURSE ${k}</h3><table class="shuttle-table"><thead><tr>${stops.map(x=>`<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${day.shuttles[k].map(r=>`<tr>${r.map(x=>`<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`};
  return one("A")+one("B")+one("C");
}
function openDay(d){
  const day=D.days[d];
  const tl=detailedTimelineForDay(d);
  $("#drawerDate").textContent=`${day.label}, ${day.area}`;
  $("#drawerTitle").textContent=`${day.name} TIMETABLE`;
  $("#drawerContent").innerHTML=`
    <div class="night-context"><b>DAY NOTE</b><span>${esc(day.fairContext||"")}</span></div>
    <div class="food-guide"><b>FOOD / CATERING</b><span>${esc(day.foodTip||"")}</span></div>

    ${courseGuideHTML(d)}

    <div class="timetable-legend">
      <span><b>FIXED</b> 시작 시각이 중요한 프로그램</span>
      <span><b>WINDOW</b> 운영 시간 안에 방문 가능</span>
      <span><b>TBA</b> 세부 시간 확인 필요</span>
    </div>

    <div class="timeline detailed-timeline">${tl.map(e=>`<div class="timeline-row ${e.anchor?"anchor-row":""}">
      <time>${esc(e.time)}</time>
      <div>
        <div class="timeline-row-title"><b>${esc(e.venue)}, ${esc(e.title)}</b><span class="timeline-kind ${timelineKind(e).toLowerCase()}">${timelineKind(e)}</span></div>
        <span>${esc(e.program)}</span>
        ${e.exhibitionInfo?`<small class="timeline-extra">전시, ${esc(e.exhibitionInfo)}</small>`:""}
        ${e.artistInfo?`<small class="timeline-extra">작가, ${esc(e.artistInfo)}</small>`:""}
      </div>
    </div>`).join("")}</div>

    ${shuttleTable(day)}
    <div class="info-block"><h3>NOTES</h3><ul>${day.special.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`;
  showDrawer();
}
function showDrawer(){$("#drawerWrap").classList.add("open");$("#drawerWrap").setAttribute("aria-hidden","false")}
function closeDrawer(){$("#drawerWrap").classList.remove("open");$("#drawerWrap").setAttribute("aria-hidden","true")}

function exportPicks(){
  const groups=groupEvents(D.events).filter(g=>saved.has(g.venueKey));
  const uniq=new Map();groups.forEach(g=>{if(!uniq.has(g.venueKey))uniq.set(g.venueKey,g)});
  const lines=["2026 FRIEZE WEEK, MY PLACES","",...[...uniq.values()].flatMap(g=>{const e=g.events[0];return [`${g.venue} | ${g.address}`,e.naver?`NAVER: ${naverSearch(e)}`:"",""]})];
  const blob=new Blob([lines.join("\n")],{type:"text/plain;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="2026-frieze-week-my-places.txt";a.click();URL.revokeObjectURL(url);
}

function loadNaverMap(){
  const id=(C.NAVER_MAP_CLIENT_ID||"").trim();
  if(!id){$("#naverMap").innerHTML=`<div class="map-empty"><b>NAVER MAP CLIENT ID MISSING</b><span>config.js를 확인해주세요.</span></div>`;return;}
  const s=document.createElement("script");s.src=`https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(id)}`;s.async=true;
  s.onload=()=>{
    if(!window.naver?.maps)return;
    const a=AREA[state.day]||AREA.all;
    naverMap=new naver.maps.Map("naverMap",{center:new naver.maps.LatLng(a.lat,a.lng),zoom:a.zoom,zoomControl:true,mapTypeControl:false,scaleControl:false});
    renderMapNotice();renderVerifiedMarkers(D.events.filter(rawMatch));
  };
  s.onerror=()=>{$("#naverMap").innerHTML=`<div class="map-empty"><b>NAVER MAP LOAD FAILED</b><span>배포 Origin, Client ID, 호출 한도를 확인하세요.</span></div>`};
  document.head.appendChild(s);
}
function updateMapViewport(){
  if(!naverMap||!window.naver?.maps)return;const a=AREA[state.day]||AREA.all;naverMap.morph(new naver.maps.LatLng(a.lat,a.lng),a.zoom);renderMapNotice();
}
function renderMapNotice(){
  const old=$("#naverMap .map-badge");if(old)old.remove();
  const div=document.createElement("div");div.className="map-badge";
  div.innerHTML=`<b>${state.day==="all"?"SEOUL, FOUR NIGHTS":esc(D.days[state.day].name)}</b><br>실제 NAVER 지도, 검증 좌표만 핀 표시, 각 장소의 정확 위치는 NAVER MAP 링크로 확인`;
  $("#naverMap").appendChild(div);
}
function clearMarkers(){naverMarkers.forEach(m=>m.setMap(null));naverMarkers=[]}
function renderVerifiedMarkers(events){
  if(!naverMap||!window.naver?.maps)return;clearMarkers();
  groupEvents(events).forEach(g=>{const e=g.events.find(x=>x.coords&&Number.isFinite(x.coords.lat)&&Number.isFinite(x.coords.lng));if(!e)return;
    const marker=new naver.maps.Marker({map:naverMap,position:new naver.maps.LatLng(e.coords.lat,e.coords.lng),title:g.venue});
    naver.maps.Event.addListener(marker,"click",()=>location.hash=`#/place/${encodeURIComponent(g.day)}/${encodeURIComponent(g.venueKey)}`);naverMarkers.push(marker);
  });
}

function initDefaultDay(){
  state.day="all";
}
$("#searchInput").oninput=e=>{state.q=e.target.value;render()};
$$(".chip").forEach(b=>b.onclick=()=>applyFilter(b.dataset.filter));
$("#infoBtn").onclick=()=>openDay(state.day==="all"?"2026-08-31":state.day);
$("#savedBtn").onclick=()=>{state.savedOnly=!state.savedOnly;$("#savedBtn").classList.toggle("active",state.savedOnly);location.hash="#/";render()};
$("#exportBtn").onclick=exportPicks;
$("#sharePicksBtn").onclick=sharePicks;
$("#calendarBtn").onclick=exportCalendar;
$$("[data-close]").forEach(x=>x.onclick=closeDrawer);
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeDrawer()});
window.addEventListener("hashchange",renderRoute);

$("#updatedText").textContent=D.meta.updated;
importSharedPicks();initDefaultDay();tabs();renderRoute();loadNaverMap();
setInterval(()=>{if(!$("#listView").hidden)render()},60000);
