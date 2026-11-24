import { CFG } from './config.js';
import * as store from './store.js';
import { ICONS } from './icons.js';
import * as share from './share.js';
import * as notify from './notify.js';

const { get, put, del, keys } = store;

/* ---------- 날짜 ---------- */
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const diff = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);
const todayStr = () => ymd(new Date());
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const md = s => { const d = parse(s); return `${d.getMonth() + 1}/${d.getDate()} (${DOW[d.getDay()]})`; };
const dday = n => n === 0 ? '오늘' : n > 0 ? `D-${n}` : `${-n}일 지남`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- 상수 ---------- */
const SLOTS = { morning: '아침', noon: '점심', evening: '저녁', night: '자기 전' };
const CATS = { psych: '정신과', supp: '영양제', pill: '피임약', glp: '마운자로', etc: '기타' };
const KINDS = { daily: '매일', pack: '피임약 주기', interval: '며칠마다 (주사)', prn: '필요할 때' };
const CAT_KINDS = { psych: ['daily', 'prn'], supp: ['daily', 'prn'], pill: ['pack', 'daily'], glp: ['interval'], etc: ['daily', 'interval', 'prn'] };  // 종류마다 쓸 수 있는 복용 방식
/* 아이콘: Phosphor Icons 듀오톤 한 세트만 쓴다 (icons.js) */
const ALIAS = { cal: 'calendar-blank', chart: 'chart-bar', sliders: 'sliders-horizontal', flower: 'flower-tulip', plus: 'first-aid',
  sunrise: 'sun-horizon', sunset: 'moon', moon: 'moon-stars', pencil: 'pencil-simple' };
const svg = (n, w = 'duotone') => `<svg class="i" viewBox="0 0 256 256" aria-hidden="true">${ICONS[w][ALIAS[n] || n]}</svg>`;
const SLOT_EMO = { morning: svg('sunrise'), noon: svg('sun'), evening: svg('sunset'), night: svg('moon') };
const CAT_EMO = { psych: svg('pill'), supp: svg('leaf'), pill: svg('flower'), glp: svg('syringe'), etc: svg('plus') };
const withEmo = (map, emo) => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, emo[k] + v]));
const ico = c => `<span class="ico ${c}">${CAT_EMO[c] || CAT_EMO.psych}</span>`;
const PERIOD = ['light', 'medium', 'heavy'];
const FLOWS = { light: '적음', medium: '보통', heavy: '많음' };
const DROP = '<svg viewBox="0 0 11 14"><path d="M5.5 0C5.5 0 0 6 0 9.2a5.5 4.8 0 0 0 11 0C11 6 5.5 0 5.5 0z"/></svg>';
const SYMPTOMS = ['생리통', '두통', '요통', '유방통', '부종', '피로', '메스꺼움', '식욕 저하', '식욕 증가', '변비', '설사', '불면', '졸림', '불안', '우울', '여드름'];
const MOODS = ['smiley-x-eyes', 'smiley-sad', 'smiley-meh', 'smiley', 'smiley-wink'].map(n => svg(n));
const GLP_DOSES = ['2.5mg', '5mg', '7.5mg', '10mg', '12.5mg', '15mg'];
const SITES = ['복부 왼쪽', '복부 오른쪽', '허벅지 왼쪽', '허벅지 오른쪽', '팔 왼쪽', '팔 오른쪽'];

/* ---------- 상태 ---------- */
const S = { tab: 'log', date: todayStr(), month: todayStr().slice(0, 7), calView: 'all', big: false, draft: {}, form: null, msg: '' };
const wide = matchMedia('(min-width: 900px)');

/* ---------- 데이터 접근 ---------- */
const day = d => get('day:' + d) || {};
function setDay(d, fn) { const r = structuredClone(day(d)); fn(r); put('day:' + d, r); }
const dayKeys = () => keys('day:').map(k => k.slice(4)).sort();
const meds = () => keys('med:').map(k => ({ id: k.slice(4), ...get(k) })).sort((a, b) => (a.order || 0) - (b.order || 0));
const settings = () => ({ cycleLen: 28, periodLen: 5, ...(get('settings') || {}) });
const shots = id => dayKeys().filter(d => day(d).taken?.[id]?.shot).map(d => ({ d, ...day(d).taken[id].shot }));

/* 그날 챙겨야 할 약 목록 */
function plan(D) {
  const out = [];
  for (const m of meds()) {
    if (m.kind !== 'pack' && m.start && D < m.start) continue;
    if (m.end && D > m.end) continue;
    if (m.kind === 'daily') for (const s of Object.keys(SLOTS)) { if (m.slots?.includes(s)) out.push({ m, slot: s }); }
    else if (m.kind === 'pack') {
      const slot = m.slots?.[0] || 'night', p = packPos(m, D);
      if (!p) { if (!packAnchors(m).length) out.push({ m, slot, wait: true, note: `첫 알을 체크하면 ${m.active}일 일정이 시작돼요` }); }
      else out.push(p.i < m.active ? { m, slot, note: `${p.i + 1}/${m.active}일차` } : { m, slot, rest: true, note: `휴약 ${p.i - m.active + 1}/${m.rest}일` });
    } else if (m.kind === 'interval') {
      const all = shots(m.id), prev = all.filter(s => s.d < D).at(-1), done = day(D).taken?.[m.id]?.shot;
      const next = prev ? addDays(prev.d, m.every) : (m.start || D);
      out.push({ m, slot: 'shot', done, prev, next, last: all.filter(s => s.d <= D).at(-1) });
    } else if (m.kind === 'prn') out.push({ m, slot: 'prn', n: day(D).taken?.[m.id]?.prn?.n || 0 });
  }
  return out;
}
const checkable = it => (it.m.kind === 'daily' || it.m.kind === 'pack') && !it.rest && !it.wait;

/* 피임약 팩: 첫 알을 먹은 날(기준일)부터 active일 먹고 rest일 쉰다. 기준일은 약 설정의 start와, 체크하면서 생긴 packs. */
const packAnchors = m => [...new Set([m.start, ...(m.packs || [])].filter(Boolean))].sort();
function packPos(m, D) {
  const a = packAnchors(m).filter(x => x <= D).at(-1);
  if (!a) return null;
  const cyc = m.active + m.rest, n = diff(D, a), i = n % cyc;
  return { i, cs: addDays(D, -i), rolled: n >= cyc };
}
function packAnchor(id, D) {
  const m = get('med:' + id), lim = addDays(D, m.active), near = x => x > D && x < lim;
  put('med:' + id, { ...m, start: m.start && near(m.start) ? null : m.start, packs: [...(m.packs || []).filter(x => x !== D && !near(x)), D].sort() });
}
/* 약을 체크할 때: 아직 시작 전이거나, 자동으로 넘어온 새 팩인데 앞 날짜를 하나도 안 먹었으면 이 날을 새 팩 첫 날로 삼는다 */
function packOnTake(id, D) {
  const m = get('med:' + id);
  if (!m || m.kind !== 'pack') return;
  const p = packPos(m, D);
  if (!p) return packAnchor(id, D);
  if (!p.rolled || p.i === 0 || p.i >= m.active) return;
  for (let d = p.cs; d < D; d = addDays(d, 1)) if (Object.keys(day(d).taken?.[id] || {}).length) return;
  packAnchor(id, D);
}
function adherence(D) {
  const items = plan(D).filter(checkable), t = day(D).taken || {};
  return { total: items.length, done: items.filter(it => t[it.m.id]?.[it.slot]).length };
}

/* 생리 주기 계산 */
function cycleInfo() {
  /* 생리 기간 = '시작'(ps)을 누른 날부터 '끝'(pe)을 누른 날까지. 끝을 아직 안 눌렀으면 오늘까지로 본다
     (2주 넘게 안 눌렀으면 기본 기간만큼만). 양(flow)은 그 기간 안에서 날마다 따로 적는다. */
  const st = settings(), now = todayStr(), keysAll = dayKeys(), days = new Set(), marks = [];
  const starts = keysAll.filter(d => day(d).ps);
  starts.forEach((s, i) => {
    const lim = starts[i + 1] || '9999', e = keysAll.find(d => d >= s && d < lim && day(d).pe);
    let end = e || (now < s ? s : diff(now, s) <= 13 ? now : addDays(s, st.periodLen - 1));
    if (starts[i + 1] && end >= lim) end = addDays(lim, -1);
    marks.push({ start: s, end, open: !e });
    for (let d = s; d <= end; d = addDays(d, 1)) days.add(d);
  });
  const runs = [];
  for (const d of [...days].sort()) {
    const last = runs.at(-1);
    if (last && diff(d, last.end) <= 2) last.end = d; else runs.push({ start: d, end: d });
  }
  const mean = a => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  const lens = runs.slice(1).map((r, i) => diff(r.start, runs[i].start));
  const valid = lens.filter(n => n >= 15 && n <= 60).slice(-6);
  const avg = valid.length ? mean(valid) : st.cycleLen;
  const perLen = runs.length ? mean(runs.slice(-6).map(r => diff(r.end, r.start) + 1)) : st.periodLen;
  const last = runs.at(-1), next = last ? addDays(last.start, avg) : null, pred = new Set(), today = todayStr();
  if (last) for (let k = 1; k <= 6; k++) for (let i = 0; i < perLen; i++) {
    const d = addDays(last.start, avg * k + i); if (d >= today) pred.add(d);
  }
  return { runs, lens, avg, perLen, last, next, pred, measured: valid.length, days, marks };
}

/* ---------- 화면: 달력 ---------- */
/* 달력에 한 번에 한 가지만 보여준다: 무엇을 볼지는 위쪽 버튼으로 고른다 */
/* 보기 버튼은 달력 표시와 오른쪽(아래) 입력 칸을 함께 바꾼다. '전체'는 모든 것을 한 번에 보고 적는다 */
const CAL_VIEWS = { all: '전체', period: '생리', meds: '약', weight: '체중' };
const CAL_HINT = { all: '분홍은 생리 · 초록 점은 약 · 회색 점은 메모 · 빈 점은 체중', period: '분홍 테두리는 예상일 · 아래 글자는 양',
  meds: '진한 초록은 다 챙긴 날(주사 포함) · 연한 초록은 일부만', weight: '날짜 아래 숫자가 그날 체중(kg)', pill: ' · 초록 점은 피임약(빈 점은 먹을 날)' };
const FLOW_SHORT = { light: '적음', medium: '보통', heavy: '많음' };
function dayInfo(d, ci, today, shotMeds) {
  const r = day(d), isP = ci.days.has(d);
  return { r, isP, pred: !isP && ci.pred.has(d), a: d <= today ? adherence(d) : null, shot: shotMeds.some(x => r.taken?.[x.id]?.shot) };
}
function monthGrid(month, each) {
  const [y, m] = month.split('-').map(Number), first = new Date(y, m - 1, 1), start = addDays(ymd(first), -first.getDay());
  let weeks = '';
  for (let w = 0; w < 6; w++) {
    let cells = '', cur = false;
    for (let i = 0; i < 7; i++) { const d = addDays(start, w * 7 + i); if (d === S.date) cur = true; cells += each(d, d.slice(0, 7) === month); }
    if (w === 5 && addDays(start, 35).slice(0, 7) !== month && !cur) break;
    weeks += `<div class="week ${cur ? 'cur' : ''}">${cells}</div>`;
  }
  return { y, m, weeks };
}
function viewCal(ci) {
  const today = todayStr(), shotMeds = meds().filter(x => x.kind === 'interval'), hasPack = meds().some(x => x.kind === 'pack' && !(x.end && x.end < today));
  const v = S.calView;
  const pillDot = d => {  // 피임약: 먹을 날은 빈 점, 먹은 날은 채운 점, 쉬는 날은 없음
    const it = hasPack && plan(d).find(it => it.m.kind === 'pack' && !it.wait);
    return !it || it.rest ? '' : `<i class="pd ${day(d).taken?.[it.m.id]?.[it.slot] ? 'on' : ''}"></i>`;
  };
  const medState = x => {  // 약 + 주사를 한데 묶어: full / part / ''
    const t = (x.a?.total || 0) + (x.shot ? 1 : 0), dn = (x.a?.done || 0) + (x.shot ? 1 : 0);
    return !t || !dn ? '' : dn === t ? 'full' : 'part';
  };
  const sub = (d, x) => {  // 날짜 아래 작은 표시
    const w = x.r.weight != null && x.r.weight !== '';
    if (v === 'period') return pillDot(d) + (x.isP && FLOW_SHORT[x.r.flow] ? `<em>${FLOW_SHORT[x.r.flow]}</em>` : '');
    if (v === 'weight') return w ? `<em>${esc(x.r.weight)}</em>` : '';
    if (v !== 'all') return '';
    const ms = medState(x);
    return (ms ? `<i class="pd ${ms === 'full' ? 'on' : ''}"></i>` : '') + (x.r.memo ? '<i class="pd memo"></i>' : '') + (w ? '<i class="pd wt"></i>' : '');
  };
  const g = monthGrid(S.month, (d, inM) => {
    const x = dayInfo(d, ci, today, shotMeds);
    const ms = medState(x);
    const mark = v === 'period' || v === 'all' ? (x.isP ? 'p-medium' : x.pred ? 'pred' : '')
      : v === 'meds' ? (ms ? 'm-' + ms : '') : (x.r.weight != null && x.r.weight !== '' ? 'w-has' : '');
    return `<button class="cell ${inM ? '' : 'out'} ${d === today ? 'today' : ''} ${d === S.date ? 'sel' : ''} ${mark}" data-act="pick" data-d="${d}" aria-label="${d}"><span class="n">${+d.slice(8)}</span><span class="sub">${sub(d, x)}</span></button>`;
  });
  return `<section class="card cal ${S.calOpen ? 'open' : ''}">
    <div class="cal-head">
      <button class="icon-btn" data-act="calPrev" aria-label="이전">‹</button>
      <button class="cal-title" data-act="calBig"><h2>${g.y}년 ${g.m}월</h2></button>
      <button class="icon-btn" data-act="calNext" aria-label="다음">›</button>
      <button class="icon-btn big-btn" data-act="calBig" aria-label="크게 보기">${svg('corners-out', 'regular')}</button>
    </div>
    <div class="seg">${Object.entries(CAL_VIEWS).map(([k, t]) => `<button class="${v === k ? 'on' : ''} v-${k}" data-act="calView" data-v="${k}">${t}</button>`).join('')}</div>
    <div class="dow">${DOW.map(d => `<span>${d}</span>`).join('')}</div>
    ${g.weeks}
    <p class="cal-hint">${CAL_HINT[v]}${v === 'period' && hasPack ? CAL_HINT.pill : ''}</p>
    <button class="cal-more" data-act="calOpen" aria-expanded="${!!S.calOpen}" aria-label="${S.calOpen ? '달력 접기' : '한 달 펼치기'}"><i></i></button>
  </section>`;
}
/* 큰 달력: 날짜마다 그날 기록을 아이콘으로 전부 보여준다 */
function renderBig() {
  const ci = cycleInfo(), today = todayStr(), shotMeds = meds().filter(x => x.kind === 'interval');
  const g = monthGrid(S.month, (d, inM) => {
    const x = dayInfo(d, ci, today, shotMeds), r = x.r, ic = [];
    if (x.a && x.a.total) ic.push(x.a.done === x.a.total ? `<span class="bi ok">${svg('check-circle')}</span>` : `<span class="bi ${x.a.done ? 'part' : 'no'}">${svg('pill')}<em>${x.a.done}/${x.a.total}</em></span>`);
    if (x.shot) ic.push(`<span class="bi">${svg('syringe')}</span>`);
    if (r.mood) ic.push(`<span class="bi">${MOODS[r.mood - 1]}</span>`);
    if (r.memo) ic.push(`<span class="bi">${svg('pencil')}</span>`);
    const p = x.isP ? 'p-medium' : x.pred ? 'pred' : '';
    return `<button class="cell bc ${inM ? '' : 'out'} ${d === today ? 'today' : ''} ${d === S.date ? 'sel' : ''} ${p}" data-act="bigPick" data-d="${d}" aria-label="${d}"><span class="n">${+d.slice(8)}</span><span class="bis">${ic.join('')}</span></button>`;
  });
  document.getElementById('big').innerHTML = `<div class="bigcal">
    <div class="cal-head">
      <button class="icon-btn" data-act="calPrev" aria-label="이전">‹</button>
      <h2>${g.y}년 ${g.m}월</h2>
      <button class="icon-btn" data-act="calNext" aria-label="다음">›</button>
      <button class="icon-btn" data-act="closeBig" aria-label="닫기">${svg('x', 'regular')}</button>
    </div>
    <div class="dow">${DOW.map(d => `<span>${d}</span>`).join('')}</div>
    ${g.weeks}
    <div class="legend">
      <span><i class="sw"></i>생리</span><span><i class="sw pred"></i>예상</span>
      <span class="bi ok">${svg('check-circle')}약 다 먹음</span><span class="bi part">${svg('pill')}일부</span>
      <span class="bi">${svg('syringe')}주사</span><span class="bi">${svg('smiley')}기분</span><span class="bi">${svg('pencil')}메모</span>
    </div>
  </div>`;
}
function viewSummary(ci) {
  const today = todayStr(), cards = [], C = 2 * Math.PI * 42;
  let cd = 0, frac = 0, text = '<p>생리 시작한 날을 기록하면<br>다음 예정일을 알려줄게요</p>';
  if (ci.last) {
    cd = diff(today, ci.last.start) + 1; frac = Math.min(1, cd / ci.avg);
    const n = diff(ci.next, today), now = ci.days.has(today);
    text = `<span class="k">${now ? '지금 생리 중이에요' : '다음 생리 예정'}</span><b>${md(ci.next)}</b><small>${n === 0 ? '오늘 예정이에요' : n > 0 ? `${n}일 남았어요` : `예정일이 ${-n}일 지났어요`}</small>`;
  }
  const hero = `<section class="hero"><div class="ring"><svg viewBox="0 0 100 100"><circle class="tr" cx="50" cy="50" r="42"/>
    <circle class="pg" cx="50" cy="50" r="42" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - frac)).toFixed(1)}" transform="rotate(-90 50 50)"/></svg>
    <div class="ring-t">${cd ? `<b>${cd}</b><span>일차</span>` : '<b>–</b>'}</div></div><div class="hero-t">${text}</div></section>`;
  for (const it of plan(today).filter(it => it.m.kind === 'interval')) {
    const n = diff(it.next, today);
    cards.push(`<div class="card shotc">${ico('glp')}<div><span class="k">${esc(it.m.name)}</span><b>${it.done ? '오늘 완료!' : dday(n)}</b><small>${
      it.done ? `다음은 ${md(addDays(today, it.m.every))}` : `${md(it.next)} 예정`}</small></div></div>`);
  }
  return { hero, cards: cards.length ? `<div class="sum mini">${cards.join('')}</div>` : '' };
}

/* ---------- 화면: 하루 기록 ---------- */
function shotDraft(it) {
  if (!S.draft[it.m.id]) {
    const last = it.last || it.prev, i = last ? SITES.indexOf(last.site) : -1;
    S.draft[it.m.id] = { dose: last?.dose || (GLP_DOSES.includes(it.m.dose) ? it.m.dose : it.m.cat === 'glp' ? GLP_DOSES[0] : it.m.dose || ''), site: it.m.cat === 'glp' ? SITES[(i + 1) % SITES.length] : '' };
  }
  return S.draft[it.m.id];
}
function viewShot(it, D) {
  const m = it.m, id = esc(m.id);
  if (it.done) return `<div class="shot-box"><div class="row"><b>${esc(m.name)}</b><span class="badge ok">✓ 완료</span><span class="sp"></span>
      <button class="btn sm" data-act="unshot" data-med="${id}">취소</button></div>
      <small>${esc([it.done.dose, it.done.site, it.done.t].filter(Boolean).join(' · '))}</small></div>`;
  const n = diff(it.next, D), dr = shotDraft(it);
  if (n > 0 && S.shotOpen !== m.id + D) return `<div class="prn">${ico(m.cat)}<span class="nm">${esc(m.name)}<small>다음 ${md(it.next)} · ${dday(n)}</small></span>
      <button class="btn sm" data-act="shotOpen" data-med="${id}">이 날 맞았어요</button></div>`;
  const badge = n > 0 ? `<span class="badge">다음 ${md(it.next)} · ${dday(n)}</span>` : n === 0 ? '<span class="badge due">오늘 맞는 날</span>' : `<span class="badge late">예정일 ${-n}일 지남</span>`;
  const glp = m.cat === 'glp';
  return `<div class="shot-box"><div class="row"><b>${esc(m.name)}</b>${badge}</div>
    ${glp ? `<label class="f">용량</label><div class="chips shot grid-dose">${GLP_DOSES.map(x => `<button class="chip ${dr.dose === x ? 'on' : ''}" data-act="shotDose" data-med="${id}" data-v="${x}">${x}</button>`).join('')}</div>
    <label class="f">주사 부위${it.prev?.site ? ` <small>지난번: ${esc(it.prev.site)}</small>` : ''}</label><div class="chips shot grid-site">${SITES.map(x => `<button class="chip ${dr.site === x ? 'on' : ''}" data-act="shotSite" data-med="${id}" data-v="${x}">${x}</button>`).join('')}</div>` : ''}
    <div style="margin-top:14px"><button class="btn pri block" data-act="shot" data-med="${id}">${n > 0 ? '이 날 맞았어요' : '주사 완료'}</button></div></div>`;
}
function viewMeds(D, packOnly) {
  const items = plan(D).filter(it => !packOnly || it.m.kind === 'pack'), t = day(D).taken || {};
  if (packOnly && !items.length) return '';
  if (!meds().length) return `<section class="card"><h3><span class="ht">${svg('pill')}오늘의 약</span></h3><p class="empty">아직 등록한 약이 없어요.<br>먹는 약을 추가하면 여기서 톡톡 체크할 수 있어요!</p><button class="btn pri block" data-act="addMed">＋ 약 추가하기</button></section>`;
  const ad = adherence(D);
  let html = '';
  for (const [slot, label] of Object.entries(SLOTS)) {
    const list = items.filter(it => it.slot === slot);
    if (!list.length) continue;
    const todo = list.filter(it => !it.rest && !t[it.m.id]?.[slot]).length;
    html += `<div class="slot"><div class="slot-h"><span class="slot-e">${SLOT_EMO[slot]}</span>${label}<span class="sp"></span>${todo > 1 ? `<button class="btn sm" data-act="takeAll" data-slot="${slot}">모두 체크</button>` : ''}</div><div class="slot-list">${
      list.map(it => {
        const on = t[it.m.id]?.[slot], sub = [it.m.dose, it.note].filter(Boolean).join(' · ');
        return it.rest
          ? `<div class="chk rest">${ico(it.m.cat)}<span class="nm">${esc(it.m.name)}<small>${esc(it.note)}</small></span><button class="btn sm" data-act="packStart" data-med="${esc(it.m.id)}" data-slot="${slot}">새 팩 시작</button></div>`
          : `<button class="chk ${on ? 'on' : ''}" data-act="take" data-med="${esc(it.m.id)}" data-slot="${slot}" aria-pressed="${!!on}">${ico(it.m.cat)}<span class="nm">${esc(it.m.name)}${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="tm">${esc(on?.t || '')}</span><span class="box">${svg("check", "regular")}</span></button>`;
      }).join('')}</div></div>`;
  }
  html += items.filter(it => it.slot === 'shot').map(it => viewShot(it, D)).join('');
  html += items.filter(it => it.slot === 'prn').map(it => `<div class="prn">${ico(it.m.cat)}<span class="nm">${esc(it.m.name)}<small>${esc(it.m.dose || '필요할 때')}</small></span>
      <button class="icon-btn" data-act="prn" data-med="${esc(it.m.id)}" data-v="-1" aria-label="줄이기">−</button><span class="cnt">${it.n}</span>
      <button class="icon-btn" data-act="prn" data-med="${esc(it.m.id)}" data-v="1" aria-label="늘리기">+</button></div>`).join('');
  const prog = packOnly || !ad.total ? '' : ad.done === ad.total ? `<span class="prog done">${svg('check', 'regular')}다 먹었어요</span>` : `<span class="prog">${ad.done} / ${ad.total}</span>`;
  return `<section class="card"><h3><span class="ht">${svg(packOnly ? 'flower' : 'pill')}${packOnly ? '피임약' : D === todayStr() ? '오늘의 약' : '이 날의 약'}</span>${prog}</h3>${html || '<p class="empty">이 날은 챙길 약이 없어요.</p>'}</section>`;
}
function viewDay(ci) {
  const D = S.date, r = day(D), today = todayStr(), n = diff(D, today), d = parse(D);
  const rel = n === 0 ? '오늘' : n === -1 ? '어제' : n === 1 ? '내일' : n < 0 ? `${-n}일 전` : `${n}일 후`;
  const run = ci.runs.filter(x => x.start <= D).at(-1);
  const cyc = run ? `주기 ${diff(D, run.start) + 1}일차` : '';
  const inP = ci.days.has(D), mr = ci.marks.find(x => x.start <= D && D <= x.end), prevM = ci.marks.filter(x => x.start < D).at(-1);
  const pBtn = (act, t) => `<button class="chip" data-act="${act}">${t}</button>`;
  const period = inP
    ? `<div class="chips period"><span class="chip on"><span class="drops">${DROP}</span>생리 ${diff(D, run.start) + 1}일째</span>${
        mr && (mr.open || D < mr.end) ? pBtn('pEnd', '이 날 끝났어요') : ''}${mr && !mr.open && D === mr.end ? pBtn('pEndOff', '끝 취소') : ''}${mr && D === mr.start ? pBtn('pStartOff', '시작 취소') : ''}</div>
      <label class="f">양</label><div class="chips">${Object.entries(FLOWS).map(([k, t]) => `<button class="chip ${r.flow === k ? 'on' : ''}" data-act="flowAmt" data-v="${k}">${t}</button>`).join('')}</div>`
    : `<div class="chips period"><button class="chip" data-act="pStart"><span class="drops">${DROP}</span>생리 시작</button>${
        prevM && diff(D, prevM.start) <= 13 ? pBtn('pEnd', '이 날 끝났어요') : ''}</div>`;
  const v = S.calView, wIn = `<input type="number" inputmode="decimal" step="0.1" placeholder="—" data-field="weight" value="${esc(r.weight ?? '')}">`;
  const body = `<section class="card"><h3><span class="ht">${svg('heart')}몸 상태</span></h3>
      <label class="f first">생리</label>${period}
      <label class="f">기분</label><div class="chips mood">${MOODS.map((e, i) => `<button class="chip ${r.mood === i + 1 ? 'on' : ''}" data-act="mood" data-v="${i + 1}">${e}</button>`).join('')}</div>
      <label class="f">증상</label><div class="chips sym">${
        SYMPTOMS.filter(s => S.symOpen || r.symptoms?.includes(s)).map(s => `<button class="chip ${r.symptoms?.includes(s) ? 'on' : ''}" data-act="sym" data-v="${s}">${s}</button>`).join('')
      }<button class="chip more" data-act="symToggle">${S.symOpen ? '접기' : r.symptoms?.length ? '＋ 더 고르기' : '＋ 증상 고르기'}</button></div>
    </section>`;
  const memo = `<section class="card"><h3><span class="ht">${svg('pencil')}메모</span></h3>
      <textarea data-field="memo" placeholder="몸 상태, 부작용, 병원에서 말할 것…">${esc(r.memo || '')}</textarea>
      <div class="weight"><span>체중</span>${wIn}<span>kg</span></div>
    </section>`;
  const ws = dayKeys().filter(k => k <= D && day(k).weight != null && day(k).weight !== '' && !isNaN(+day(k).weight)).slice(-7).map(k => ({ d: k, w: +day(k).weight }));
  const weight = `<section class="card"><h3><span class="ht">${svg('chart-line-up')}체중</span></h3>
      <div class="weight big">${wIn}<span>kg</span></div>
      ${ws.length ? `<table style="margin-top:16px"><tr><th>날짜</th><th class="num">체중</th><th class="num">변화</th></tr>${ws.map((x, i) => {
        const df = i ? x.w - ws[i - 1].w : null;
        return `<tr><td>${md(x.d)}</td><td class="num">${x.w}kg</td><td class="num">${df == null ? '—' : (df > 0 ? '+' : '') + df.toFixed(1)}</td></tr>`;
      }).reverse().join('')}</table>` : '<p class="empty">체중을 적으면 변화가 여기에 보여요.</p>'}
    </section>`;
  const cards = v === 'period' ? viewMeds(D, true) + body : v === 'meds' ? viewMeds(D) : v === 'weight' ? weight : viewMeds(D) + body + memo;
  return `<div class="day-head">
      <button class="icon-btn" data-act="dayPrev" aria-label="전날">‹</button>
      <h1>${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})<small>${rel}${cyc ? ' · ' + cyc : ''}</small></h1>
      ${n !== 0 ? '<button class="btn sm" data-act="goToday">오늘</button>' : ''}
      <button class="icon-btn" data-act="dayNext" aria-label="다음날">›</button>
    </div>
    ${cards}`;
}

/* ---------- 화면: 약 관리 ---------- */
function medDesc(m) {
  const slots = (m.slots || []).map(s => SLOTS[s]).join('·');
  const base = m.kind === 'daily' ? `매일 ${slots}` : m.kind === 'pack' ? `${m.active}일 복용${m.rest ? ` + ${m.rest}일 휴약` : ' (연속)'} · ${slots}`
    : m.kind === 'interval' ? `${m.every}일마다` : '필요할 때';
  return [CATS[m.cat], base, m.dose].filter(Boolean).join(' · ');
}
function viewMedPage() {
  const today = todayStr(), list = meds(), on = list.filter(m => !m.end || m.end >= today), off = list.filter(m => m.end && m.end < today);
  const item = m => `<button class="med ${m.end && m.end < today ? 'ended' : ''}" data-act="editMed" data-med="${esc(m.id)}">${ico(m.cat)}<span class="nm">${esc(m.name)}<small>${esc(medDesc(m))}${m.end && m.end < today ? ` · ${m.end} 중단` : ''}</small></span><span class="badge">수정</span></button>`;
  return `<div class="narrow-col"><div class="page-h"><h1>내 약</h1><button class="btn pri" data-act="addMed">＋ 약 추가</button></div>
    ${on.length ? on.map(item).join('') : '<div class="card"><p class="empty">먹는 약을 추가하면 매일 기록 화면에 체크 목록이 생겨요.</p></div>'}
    ${off.length ? `<label class="f">중단한 약</label>${off.map(item).join('')}` : ''}</div>`;
}
function renderForm() {
  const f = S.form, sheet = document.getElementById('sheet');
  const chips = (act, map, cur) => Object.entries(map).map(([k, v]) => `<button class="chip ${(Array.isArray(cur) ? cur.includes(k) : cur === k) ? 'on' : ''}" data-act="${act}" data-v="${k}">${v}</button>`).join('');
  const kinds = [...new Set([...CAT_KINDS[f.cat], f.kind])];
  const packs = { '21-7': '21일 + 휴약 7일', '24-4': '24일 + 휴약 4일', '28-0': '28일 연속' };
  sheet.innerHTML = `<div class="sheet"><div class="sheet-h"><h2>${f.id ? '약 수정' : '약 추가'}</h2><button class="icon-btn" data-act="closeForm" aria-label="닫기">${svg('x', 'regular')}</button><button class="icon-btn ok" data-act="saveMed" aria-label="저장">${svg('check', 'regular')}</button></div>
    <label class="f">종류</label><div class="chips">${chips('fCat', withEmo(CATS, CAT_EMO), f.cat)}</div>
    <label class="f">이름</label><input type="text" data-form="name" value="${esc(f.name)}" placeholder="예: 아침 약, 비타민D, 야즈">
    <label class="f">용량 · 메모 (선택)</label><input type="text" data-form="dose" value="${esc(f.dose)}" placeholder="예: 1정, 2.5mg">
    ${kinds.length > 1 ? `<label class="f">복용 방식</label><div class="chips">${chips('fKind', Object.fromEntries(kinds.map(k => [k, KINDS[k]])), f.kind)}</div>` : ''}
    ${f.kind === 'daily' || f.kind === 'pack' ? `<label class="f">${f.kind === 'daily' ? '먹는 때 (여러 개 선택 가능)' : '먹는 때'}</label><div class="chips">${chips('fSlot', withEmo(SLOTS, SLOT_EMO), f.slots)}</div>` : ''}
    ${f.kind === 'pack' ? `<label class="f">주기</label><div class="chips">${chips('fPack', packs, `${f.active}-${f.rest}`)}</div>` : ''}
    ${f.kind === 'interval' ? `<label class="f">며칠마다</label><input type="number" inputmode="numeric" min="1" data-form="every" value="${esc(f.every)}">` : ''}
    <label class="f">${f.kind === 'pack' ? '이번 팩 첫 알 먹은 날 <small>비워 두면 처음 체크한 날부터</small>' : f.kind === 'interval' ? '첫 예정일' : '시작일'}</label><input type="date" data-form="start" value="${esc(f.start)}">
    ${f.id ? `<div class="foot" style="margin-top:10px">${f.end ? '<button class="btn" data-act="resumeMed">다시 복용 시작</button>' : '<button class="btn" data-act="stopMed">오늘부터 중단</button>'}<button class="btn danger" data-act="delMed">삭제</button></div>` : ''}
  </div>`;
}

/* ---------- 화면: 통계 ---------- */
function viewStats(ci) {
  const today = todayStr(), list = meds().filter(m => m.kind === 'daily' || m.kind === 'pack');
  const adh = list.map(m => {
    let total = 0, done = 0;
    for (let i = 0; i < 30; i++) {
      const d = addDays(today, -i);
      for (const it of plan(d)) if (it.m.id === m.id && checkable(it)) { total++; if (day(d).taken?.[m.id]?.[it.slot]) done++; }
    }
    return { m, total, done };
  }).filter(x => x.total);
  const runs = ci.runs.slice(-8).reverse(), all = ci.runs;
  const ws = dayKeys().filter(d => day(d).weight != null && day(d).weight !== '').map(d => ({ d, w: +day(d).weight })).filter(x => !isNaN(x.w));
  let spark = '';
  if (ws.length > 1) {
    const pts = ws.slice(-60), lo = Math.min(...pts.map(p => p.w)), hi = Math.max(...pts.map(p => p.w)), span = hi - lo || 1;
    const t0 = parse(pts[0].d), tt = (parse(pts.at(-1).d) - t0) || 1;
    const xy = pts.map(p => `${(((parse(p.d) - t0) / tt) * 296 + 2).toFixed(1)},${(84 - ((p.w - lo) / span) * 78).toFixed(1)}`).join(' ');
    spark = `<svg class="spark" viewBox="0 0 300 90" preserveAspectRatio="none"><polyline points="${xy}" fill="none" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>
      <div class="row"><small>${md(pts[0].d)} ${pts[0].w}kg</small><span class="sp"></span><small>${md(pts.at(-1).d)} ${pts.at(-1).w}kg (${(pts.at(-1).w - pts[0].w > 0 ? '+' : '') + (pts.at(-1).w - pts[0].w).toFixed(1)})</small></div>`;
  }
  const inj = meds().filter(m => m.kind === 'interval').flatMap(m => shots(m.id).map(s => ({ ...s, name: m.name }))).sort((a, b) => b.d.localeCompare(a.d)).slice(0, 12);
  return `<div class="narrow-col stack"><div class="page-h" style="margin-bottom:0"><h1>통계</h1></div>
    <section class="card"><h3>생리 주기</h3>
      <div class="sum" style="margin-bottom:12px"><div><span class="k">평균 주기</span><b>${ci.avg}일</b><small>${ci.measured ? `최근 ${ci.measured}회 기준` : '기본값'}</small></div>
      <div><span class="k">평균 기간</span><b>${ci.perLen}일</b></div><div><span class="k">다음 예정</span><b>${ci.next ? md(ci.next) : '—'}</b></div></div>
      ${runs.length ? `<table><tr><th>시작일</th><th class="num">기간</th><th class="num">주기</th></tr>${runs.map(r => {
        const i = all.indexOf(r), len = i < all.length - 1 ? diff(all[i + 1].start, r.start) + '일' : '진행 중';
        return `<tr><td>${r.start}</td><td class="num">${diff(r.end, r.start) + 1}일</td><td class="num">${len}</td></tr>`;
      }).join('')}</table>` : '<p class="empty">아직 기록이 없어요.</p>'}
      <p style="margin-top:10px"><small>예측은 기록한 주기의 평균으로 계산한 참고용이에요. 피임약 복용 중에는 실제와 다를 수 있어요.</small></p></section>
    <section class="card"><h3>최근 30일 복약</h3>${adh.length ? adh.map(x => `<div class="adh"><div class="row"><b>${esc(x.m.name)}</b><span class="sp"></span><span>${Math.round(x.done / x.total * 100)}% <small>(${x.done}/${x.total})</small></span></div><div class="bar"><i style="width:${x.done / x.total * 100}%"></i></div></div>`).join('') : '<p class="empty">아직 기록이 없어요.</p>'}</section>
    <section class="card"><h3>주사 기록</h3>${inj.length ? `<table><tr><th>날짜</th><th>약</th><th>용량</th><th>부위</th></tr>${inj.map(s => `<tr><td>${s.d}</td><td>${esc(s.name)}</td><td>${esc(s.dose || '')}</td><td>${esc(s.site || '')}</td></tr>`).join('')}</table>` : '<p class="empty">아직 기록이 없어요.</p>'}</section>
    <section class="card"><h3>체중</h3>${spark || '<p class="empty">체중을 이틀 이상 기록하면 변화가 보여요.</p>'}</section></div>`;
}

/* ---------- 화면: 설정 ---------- */
const REMIND_TIMES = { morning: '08:00', noon: '12:30', evening: '18:30', night: '22:30' };  // 서버(plan.ts)의 기본값과 같아야 한다
function viewNotify(st, sy) {
  const ns = notify.state(), times = { ...REMIND_TIMES, ...(st.times || {}) };
  const top = !sy.email ? '<p>로그인하면 약 먹을 시간에 알림을 받을 수 있어요.</p>'
    : ns === 'on' ? `<p><b>이 기기는 알림이 켜져 있어요</b></p><div class="row" style="margin-top:12px"><button class="btn" data-act="notifyTest">시험 알림 보내기</button><button class="btn" data-act="notifyOff">끄기</button></div>`
    : ns === 'off' ? '<p>약 먹을 시간이 됐는데 아직 체크하지 않았으면 알려 드려요.</p><div class="row" style="margin-top:12px"><button class="btn pri" data-act="notifyOn">이 기기에서 알림 켜기</button></div>'
    : ns === 'denied' ? '<p>알림이 차단돼 있어요. 기기의 <b>설정 → 알림 → 일과기록</b>에서 허용해 주세요.</p>'
    : '<p>이 화면에서는 알림을 켤 수 없어요. 아이폰·아이패드는 Safari 공유 버튼 → <b>홈 화면에 추가</b>한 앱에서 켤 수 있어요. (iOS 16.4 이상)</p>';
  const tm = !sy.email ? '' : `<label class="f">알림 시각</label><div class="two">${Object.entries(SLOTS).map(([k, t]) =>
    `<div class="row"><span style="width:64px">${t}</span><input type="time" data-rt="${k}" value="${esc(times[k])}"></div>`).join('')}</div>
    <p style="margin-top:10px"><small>알림에는 약 이름이 나오지 않아요. 5분쯤 늦게 올 수 있고, 기기마다 따로 켜야 해요. 주사 맞는 날은 아침 시각에 알려 드려요.</small></p>`;
  return `<section class="card"><h3>알림</h3>${top}${tm}</section>`;
}
function viewSettings() {
  const st = settings(), sy = store.syncState();
  const sync = !sy.configured
    ? '<p>아직 동기화 서버가 연결되지 않았어요. 지금은 <b>이 기기에만</b> 저장돼요.</p>'
    : sy.email
      ? `<p><b>${esc(sy.email)}</b> 로 로그인됨</p><p><small>${sy.error ? '동기화 실패: ' + esc(sy.error) : sy.last ? '마지막 동기화 ' + new Date(sy.last).toLocaleString('ko-KR') : '동기화 대기 중'}</small></p>
         <div class="row" style="margin-top:12px"><button class="btn pri" data-act="syncNow">지금 동기화</button><button class="btn" data-act="logout">로그아웃</button></div>`
      : `<p>아이패드와 아이폰에서 같은 아이디로 로그인하면 기록이 자동으로 맞춰져요.</p>
         <label class="f">아이디</label><input type="text" id="email" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="영문·숫자 3~20자">
         <label class="f">비밀번호</label><input type="password" id="pw" autocomplete="current-password" placeholder="6자 이상">
         <div class="row" style="margin-top:14px"><button class="btn pri" data-act="login">로그인</button><button class="btn" data-act="signup">계정 만들기</button></div>`;
  return `<div class="narrow-col stack"><div class="page-h" style="margin-bottom:0"><h1>설정</h1></div>
    <section class="card"><h3>기기 간 동기화</h3>${sync}</section>
    ${viewNotify(st, sy)}
    <section class="card"><h3>생리 주기 기본값</h3><div class="two">
      <div><label class="f" style="margin-top:0">주기 (일)</label><input type="number" inputmode="numeric" data-set="cycleLen" value="${esc(st.cycleLen)}"></div>
      <div><label class="f" style="margin-top:0">기간 (일)</label><input type="number" inputmode="numeric" data-set="periodLen" value="${esc(st.periodLen)}"></div>
    </div><p style="margin-top:10px"><small>기록이 쌓이면 실제 평균으로 자동 계산돼요.</small></p></section>
    <section class="card"><h3>백업</h3><div class="row" style="flex-wrap:wrap"><button class="btn" data-act="export">파일로 내보내기</button><button class="btn" data-act="import">파일에서 가져오기</button></div>
      <input type="file" id="importFile" accept="application/json,.json" hidden></section>
    <section class="card"><h3>홈 화면에 추가</h3><p>Safari 공유 버튼 → <b>홈 화면에 추가</b>를 누르면 앱처럼 전체 화면으로 열려요.</p></section></div>`;
}

/* ---------- 렌더 ---------- */
const ICON = { log: svg('cal'), meds: svg('pill'), share: svg('users'), stats: svg('chart'), settings: svg('sliders') };
const TABS = { log: '기록', meds: '약', share: '공유', stats: '통계', settings: '설정' };
function render() {
  const keep = {};
  document.querySelectorAll('[data-scroll]').forEach(e => keep[e.dataset.scroll] = e.scrollTop);
  const ci = cycleInfo(), sm = S.tab === 'log' ? viewSummary(ci) : null;
  const nav = `<nav>${Object.entries(TABS).map(([k, v]) => `<button class="${S.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}"><span class="ne">${ICON[k]}</span>${v}</button>`).join('')}</nav>`;
  const body = S.tab === 'log'
    ? `<main class="wide"><div class="split"><div class="pane" data-scroll="L">${hello()}${sm.hero}${viewCal(ci)}${sm.cards}</div><div class="pane" data-scroll="R">${viewDay(ci)}</div></div></main>`
    : `<main data-scroll="M-${S.tab}">${S.tab === 'meds' ? viewMedPage() : S.tab === 'share' ? share.view() : S.tab === 'stats' ? viewStats(ci) : viewSettings()}</main>`;
  document.getElementById('app').innerHTML = nav + body;
  document.querySelectorAll('[data-scroll]').forEach(e => { if (keep[e.dataset.scroll]) e.scrollTop = keep[e.dataset.scroll]; });
}
let toastT;
function toast(msg) {
  const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400);
}
function hello() {
  const h = new Date().getHours();
  const [t, e] = h < 5 ? ["늦은 밤이에요", "moon"] : h < 11 ? ["좋은 아침이에요", "sunrise"] : h < 17 ? ["좋은 오후예요", "sun"] : h < 22 ? ["좋은 저녁이에요", "sunset"] : ["오늘도 수고했어요", "moon"];
  return `<div class="hello"><span class="he">${svg(e)}</span><div><b>${t}</b><small>오늘도 내 몸 잘 챙겨봐요</small></div></div>`;
}
function go(d) { S.date = d; S.month = d.slice(0, 7); }

/* ---------- 동작 ---------- */
const newForm = () => ({ id: null, name: '', cat: 'psych', kind: 'daily', slots: ['night'], dose: '', every: 7, active: 21, rest: 7, start: todayStr(), end: null });
const A = {
  tab: async e => { S.tab = e.v; if (e.v === 'share') share.enter(); if (e.v === 'settings') await notify.refresh(); },
  pick: e => { go(e.d); },
  dayPrev: () => go(addDays(S.date, -1)),
  dayNext: () => go(addDays(S.date, 1)),
  goToday: () => go(todayStr()),
  calView: e => { S.calView = e.v; },
  calOpen: () => { S.calOpen = !S.calOpen; },
  calBig: () => { S.big = true; renderBig(); const b = document.getElementById('big'); if (!b.open) b.showModal(); },
  closeBig: () => closeBig(),
  bigPick: e => { go(e.d); closeBig(); },
  symToggle: () => { S.symOpen = !S.symOpen; },
  shotOpen: e => { S.shotOpen = e.med + S.date; },
  calPrev: () => calMove(-1),
  calNext: () => calMove(1),
  take: e => {
    const D = S.date, on = day(D).taken?.[e.med]?.[e.slot], m = get('med:' + e.med);
    if (!on) packOnTake(e.med, D);
    else if (m?.kind === 'pack' && m.packs?.includes(D)) put('med:' + e.med, { ...m, packs: m.packs.filter(x => x !== D) });  // 첫 알 체크를 풀면 그 팩도 없던 일로
    setDay(D, r => { const x = ((r.taken ??= {})[e.med] ??= {}); if (on) delete x[e.slot]; else x[e.slot] = { t: nowHM() }; });
  },
  packStart: e => {
    packAnchor(e.med, S.date);
    setDay(S.date, r => { ((r.taken ??= {})[e.med] ??= {})[e.slot] = { t: nowHM() }; });
    toast('오늘부터 새 팩으로 계산해요');
  },
  takeAll: e => setDay(S.date, r => {
    for (const it of plan(S.date)) if (it.slot === e.slot && checkable(it) && !r.taken?.[it.m.id]?.[e.slot]) packOnTake(it.m.id, S.date);
    const t = (r.taken ??= {});
    for (const it of plan(S.date)) if (it.slot === e.slot && checkable(it)) (t[it.m.id] ??= {})[e.slot] ??= { t: nowHM() };
  }),
  shotDose: e => { (S.draft[e.med] ??= {}).dose = e.v; },
  shotSite: e => { (S.draft[e.med] ??= {}).site = e.v; },
  shot: e => {
    const dr = S.draft[e.med] || {};
    setDay(S.date, r => { ((r.taken ??= {})[e.med] ??= {}).shot = { t: nowHM(), dose: dr.dose || '', site: dr.site || '' }; });
    delete S.draft[e.med]; toast('주사 기록 완료');
  },
  unshot: e => { setDay(S.date, r => { delete r.taken?.[e.med]?.shot; }); delete S.draft[e.med]; },
  prn: e => setDay(S.date, r => {
    const m = ((r.taken ??= {})[e.med] ??= {}), n = Math.max(0, (m.prn?.n || 0) + +e.v);
    if (n) m.prn = { n, t: nowHM() }; else delete m.prn;
  }),
  flowAmt: e => setDay(S.date, r => { if (r.flow === e.v) delete r.flow; else r.flow = e.v; }),
  pStart: () => { setDay(S.date, r => { r.ps = true; delete r.pe; }); toast('끝나는 날에 "이 날 끝났어요"를 눌러주세요'); },
  pStartOff: () => {
    const D = S.date, mr = cycleInfo().marks.find(x => x.start === D);
    if (mr && !mr.open && mr.end !== D) setDay(mr.end, r => { delete r.pe; });
    setDay(D, r => { delete r.ps; delete r.pe; });
  },
  pEnd: () => {
    const D = S.date, ms = cycleInfo().marks, i = ms.findLastIndex(x => x.start <= D), mr = ms[i];
    if (!mr) return;
    const lim = ms[i + 1]?.start || '9999';
    for (const d of dayKeys()) if (d >= mr.start && d < lim && d !== D && day(d).pe) setDay(d, r => { delete r.pe; });
    setDay(D, r => { r.pe = true; });
  },
  pEndOff: () => setDay(S.date, r => { delete r.pe; }),
  sym: e => setDay(S.date, r => { const s = new Set(r.symptoms || []); s.has(e.v) ? s.delete(e.v) : s.add(e.v); r.symptoms = [...s]; }),
  mood: e => setDay(S.date, r => { if (r.mood === +e.v) delete r.mood; else r.mood = +e.v; }),
  addMed: () => openForm(newForm()),
  editMed: e => openForm({ ...newForm(), ...get('med:' + e.med), id: e.med }),
  fCat: e => {
    const f = S.form; f.cat = e.v;
    if (!f.id) Object.assign(f, { psych: { kind: 'daily', slots: ['night'] }, supp: { kind: 'daily', slots: ['morning'] }, pill: { kind: 'pack', slots: ['night'], start: '' },
      glp: { kind: 'interval', every: 7, name: f.name || '마운자로' }, etc: {} }[e.v]);
    if (!CAT_KINDS[e.v].includes(f.kind)) f.kind = CAT_KINDS[e.v][0];
    if (f.kind === 'pack' && f.slots.length !== 1) f.slots = [f.slots[0] || 'night'];
  },
  fKind: e => { S.form.kind = e.v; if (e.v === 'pack' && S.form.slots.length !== 1) S.form.slots = [S.form.slots[0] || 'night']; },
  fSlot: e => {
    const f = S.form;
    if (f.kind === 'pack') f.slots = [e.v];
    else f.slots = f.slots.includes(e.v) ? f.slots.filter(s => s !== e.v) : [...f.slots, e.v];
  },
  fPack: e => { [S.form.active, S.form.rest] = e.v.split('-').map(Number); },
  saveMed: () => {
    const f = S.form, name = f.name.trim();
    if (!name) return toast('약 이름을 적어주세요');
    if ((f.kind === 'daily' || f.kind === 'pack') && !f.slots.length) return toast('먹는 때를 골라주세요');
    const id = f.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const start = f.kind === 'pack' ? f.start || null : f.start || todayStr(), old = f.id ? get('med:' + f.id) : null;
    put('med:' + id, { name, cat: f.cat, kind: f.kind, slots: f.slots, dose: f.dose.trim(), every: Math.max(1, +f.every || 7), active: f.active, rest: f.rest,
      start, end: f.end || null, order: f.order || Date.now(),
      packs: old && (old.start || null) === start ? old.packs || [] : [] });  // 첫 알 날짜를 직접 바꾸면 그 날짜부터 다시 센다
    closeForm();
  },
  stopMed: () => { const { id, ...m } = meds().find(m => m.id === S.form.id); put('med:' + id, { ...m, end: addDays(todayStr(), -1) }); closeForm(); toast('오늘부터 목록에서 빠져요'); },
  resumeMed: () => { const { id, ...m } = meds().find(m => m.id === S.form.id); put('med:' + id, { ...m, end: null }); closeForm(); },
  delMed: () => { if (confirm('이 약을 삭제할까요?\n지난 복용 기록은 달력 표시에서 빠져요. 기록을 남기려면 "오늘부터 중단"을 쓰세요.')) { del('med:' + S.form.id); closeForm(); } },
  closeForm: () => closeForm(),
  login: () => authAct('login'),
  signup: () => authAct('signup'),
  notifyOn: async () => { try { await notify.enable(); toast('알림을 켰어요. 시험 알림을 보냈어요'); } catch (err) { toast(err.message || '알림을 켜지 못했어요'); } },
  notifyOff: async () => { await notify.disable(); toast('이 기기의 알림을 껐어요'); },
  notifyTest: async () => { try { await notify.test(); toast('시험 알림을 보냈어요'); } catch (err) { toast(err.message); } },
  logout: () => { if (confirm('로그아웃할까요? 이 기기의 기록은 그대로 남아요.')) store.logout(); },
  syncNow: async () => { await store.sync(); const s = store.syncState(); toast(s.error ? '동기화 실패' : '동기화 완료'); },
  export: () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([store.exportJSON()], { type: 'application/json' }));
    a.download = `일과기록-${todayStr()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  import: () => document.getElementById('importFile').click(),
};
share.init({ svg, esc, toast, render, todayStr, addDays, parse, md, DOW });
Object.assign(A, share.actions);
function calMove(n) {
  if (!wide.matches && !S.big && !S.calOpen) return go(addDays(S.date, n * 7));
  const [y, m] = S.month.split('-').map(Number), d = new Date(y, m - 1 + n, 1);
  S.month = ymd(d).slice(0, 7);
}
function closeBig() { S.big = false; const b = document.getElementById('big'); if (b.open) b.close(); }
function openForm(f) { S.form = f; renderForm(); const s = document.getElementById('sheet'); if (!s.open) s.showModal(); }
function closeForm() { S.form = null; document.getElementById('sheet').close(); }
async function authAct(mode) {
  const email = document.getElementById('email').value.trim(), pw = document.getElementById('pw').value;
  if (!email || !pw) return toast('아이디와 비밀번호를 입력해주세요');
  if (!store.validId(email)) return toast('아이디는 영문·숫자 3~20자로 적어주세요');
  if (pw.length < 6) return toast('비밀번호는 6자 이상이어야 해요');
  try {
    const ok = await store[mode](email, pw);
    toast(ok ? '로그인되었어요' : '가입은 됐지만 아직 로그인할 수 없어요. 관리자에게 알려주세요');
  } catch (err) { toast(err.message); }
  render();
}

document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-act]');
  if (!el || !A[el.dataset.act]) return;
  const inForm = !!el.closest('#sheet');
  await A[el.dataset.act](el.dataset);
  if (inForm && S.form) renderForm(); else render();
  if (S.big) renderBig();
});
document.addEventListener('input', ev => {
  const el = ev.target;
  if (el.dataset.field) setDay(S.date, r => { if (el.value === '') delete r[el.dataset.field]; else r[el.dataset.field] = el.value; });
  else if (el.dataset.form && S.form) S.form[el.dataset.form] = el.value;
  else if (el.dataset.rt) { if (/^\d\d:\d\d$/.test(el.value)) put('settings', { ...settings(), times: { ...(settings().times || {}), [el.dataset.rt]: el.value } }); }
  else if (el.dataset.set) { const n = parseInt(el.value, 10); if (n > 0) put('settings', { ...settings(), [el.dataset.set]: n }); }
});
document.addEventListener('change', async ev => {
  if (ev.target.id !== 'importFile' || !ev.target.files[0]) return;
  try { const n = store.importJSON(await ev.target.files[0].text()); toast(`${n}개 항목을 가져왔어요`); } catch { toast('가져올 수 없는 파일이에요'); }
  render();
});
document.getElementById('big').addEventListener('click', ev => { if (ev.target.id === 'big') closeBig(); });
document.getElementById('big').addEventListener('close', () => { S.big = false; });
document.getElementById('sheet').addEventListener('click', ev => { if (ev.target.id === 'sheet') closeForm(); });
document.getElementById('sheet').addEventListener('close', ev => { if (!ev.target.open) { S.form = null; render(); } });
wide.addEventListener('change', render);

/* 다른 기기에서 바뀐 내용이 들어오면 다시 그리기 (입력 중일 땐 방해하지 않음) */
store.onRemoteChange(() => { if (!['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) && !S.form) render(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  store.sync(); render();
});
setInterval(() => { if (document.visibilityState === 'visible') store.sync(); }, 60000);

/* 예전 방식(날마다 '생리 중'만 누름)으로 적힌 기록을 시작·끝 표시로 한 번 바꿔 준다 */
(function migratePeriod() {
  const all = dayKeys();
  if (all.some(d => day(d).ps)) return;
  const groups = [];
  for (const d of all.filter(d => PERIOD.includes(day(d).flow))) {
    const g = groups.at(-1);
    if (g && diff(d, g.end) <= 2) g.end = d; else groups.push({ start: d, end: d });
  }
  for (const g of groups) {
    setDay(g.start, r => { r.ps = true; });
    if (diff(todayStr(), g.end) > 1) setDay(g.end, r => { r.pe = true; });  // 어제·오늘까지 이어진 기록은 아직 진행 중으로 둔다
  }
})();

render();
store.sync();
notify.refresh().then(changed => { if (changed && S.tab === 'settings') render(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
void CFG;
