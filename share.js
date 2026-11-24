// '같이' 탭: 가족과 함께 쓰는 일정 · 가계부 · 하자·AS.
// 데이터는 공유 앱 서버에 있고, 이 기기나 일과기록 동기화 서버에는 저장하지 않는다.
// 본인 확인은 일과기록 로그인 토큰을 x-sini-token 헤더로 보내서 한다.
import * as store from './store.js';

const BASE = 'https://paperlog-share.hyunra94.workers.dev';
const SEGS = { cal: '일정', money: '가계부', as: '하자·AS' };
const KINDS = ['일정', '하자·AS'];
let C;  // app.js가 넘겨주는 도구: svg, esc, toast, render, todayStr, addDays, parse, md, DOW
const SH = { seg: 'cal', state: 'idle', msg: '', user: '', info: null, month: '', date: '', items: [], exp: null, as: null, form: null, busy: false };
let seq = 0;

export function init(ctx) {
  C = ctx; SH.date = C.todayStr(); SH.month = SH.date.slice(0, 7);
  document.addEventListener('input', ev => { const k = ev.target.dataset.sf; if (k && SH.form) SH.form[k] = ev.target.value; });
  document.getElementById('sheet').addEventListener('close', () => { SH.form = null; });
}

/* ---------- 서버 ---------- */
const fail = (msg, status) => Object.assign(new Error(msg), { status });
async function api(method, path, body, retry = true) {
  const tk = await store.accessToken(!retry).catch(() => null);
  if (!tk) throw fail('다시 로그인이 필요해요', 0);
  let r;
  try {
    r = await fetch(BASE + path, { method, headers: { 'x-sini-token': tk, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw fail('연결할 수 없어요. 인터넷을 확인해 주세요', -1); }
  if (r.status === 401 && retry) return api(method, path, body, false);  // 토큰을 새로 받아 한 번만 다시
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw fail(j.error || `요청에 실패했어요 (${r.status})`, r.status);
  return j;
}
function gridRange(month) {
  const first = month + '-01', start = C.addDays(first, -C.parse(first).getDay());
  return [start, C.addDays(start, 41)];
}
async function load() {
  const user = store.syncState().email;
  if (user !== SH.user) Object.assign(SH, { user, info: null, items: [], exp: null, as: null });
  if (!user) { SH.state = 'nologin'; return; }
  const my = ++seq;
  if (SH.state !== 'ok') SH.state = 'loading';
  try {
    if (!SH.info) SH.info = await api('GET', '/api/me');
    if (SH.seg === 'cal') { const [from, to] = gridRange(SH.month), j = await api('GET', `/api/schedules?from=${from}&to=${to}`); if (my === seq) SH.items = j.schedules || []; }
    else if (SH.seg === 'money') { const j = await api('GET', `/api/expenses?month=${SH.month}`); if (my === seq) SH.exp = j; }
    else { const j = await api('GET', '/api/schedules?kind=as'); if (my === seq) SH.as = j.schedules || []; }
    if (my !== seq) return;
    SH.state = 'ok'; SH.msg = '';
  } catch (e) {
    if (my !== seq) return;
    SH.state = e.status === 403 ? 'unlinked' : e.status === 0 ? 'nologin' : 'error'; SH.msg = e.message;
  }
  C.render();
}
export function enter() { load(); }

/* ---------- 화면 ---------- */
const won = n => (Number(n) || 0).toLocaleString('ko-KR') + '원';
const me = () => SH.info?.me?.name || '';
const mine = it => it.owner === me() || it.author === me();
const who = it => it.owner === me() ? 'me' : 'ot';  // 내 것은 장미색, 다른 사람 것은 초록
const onDay = (it, d) => it.date <= d && d <= (it.endDate || it.date);

function row(it, { showDate, act }) {
  const e = C.esc, sub = [showDate ? C.md(it.date) + (it.endDate && it.endDate !== it.date ? ' ~ ' + C.md(it.endDate) : '') : '', it.time, it.owner, it.canceled ? '취소됨' : ''].filter(Boolean).join(' · ');
  return `<button class="med ${it.canceled ? 'ended' : ''}" data-act="${act}" data-id="${e(it.id)}"><span class="ico ${who(it)}">${C.svg(it.kind === '하자·AS' ? 'wrench' : 'cal')}</span>
    <span class="nm">${e(it.title)}<small>${e(sub)}</small>${it.memo ? `<small class="memo">${e(it.memo)}</small>` : ''}</span>${mine(it) ? '' : `<span class="lk">${C.svg('lock-simple', 'regular')}</span>`}</button>`;
}
function viewCalSeg() {
  const today = C.todayStr(), [start] = gridRange(SH.month), [y, m] = SH.month.split('-').map(Number);
  let weeks = '';
  for (let w = 0; w < 6; w++) {
    if (w === 5 && C.addDays(start, 35).slice(0, 7) !== SH.month) break;
    let cells = '';
    for (let i = 0; i < 7; i++) {
      const d = C.addDays(start, w * 7 + i), its = SH.items.filter(it => !it.canceled && onDay(it, d));
      const mark = !its.length ? '' : its.some(it => it.owner === me()) ? 's-me' : 's-ot';
      cells += `<button class="cell ${d.slice(0, 7) === SH.month ? '' : 'out'} ${d === today ? 'today' : ''} ${d === SH.date ? 'sel' : ''} ${mark}" data-act="shPick" data-d="${d}" aria-label="${d}"><span class="n">${+d.slice(8)}</span></button>`;
    }
    weeks += `<div class="week cur">${cells}</div>`;
  }
  const dayItems = SH.items.filter(it => onDay(it, SH.date)).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const monthItems = SH.items.filter(it => (it.endDate || it.date) >= SH.month + '-01' && it.date <= SH.month + '-31').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const d = C.parse(SH.date);
  return `<section class="card cal open">
      <div class="cal-head"><button class="icon-btn" data-act="shPrev" aria-label="이전 달">‹</button><h2>${y}년 ${m}월</h2><button class="icon-btn" data-act="shNext" aria-label="다음 달">›</button></div>
      <div class="dow">${C.DOW.map(x => `<span>${x}</span>`).join('')}</div>${weeks}
      <p class="cal-hint">분홍은 내 일정 · 초록은 다른 사람 일정</p>
    </section>
    <section><label class="f">${d.getMonth() + 1}월 ${d.getDate()}일 (${C.DOW[d.getDay()]})</label>
      ${dayItems.length ? dayItems.map(it => row(it, { act: 'shEdit' })).join('') : '<div class="card"><p class="empty">이 날은 일정이 없어요.</p></div>'}</section>
    ${monthItems.length ? `<section><label class="f">${m}월 전체</label>${monthItems.map(it => row(it, { showDate: true, act: 'shEdit' })).join('')}</section>` : ''}`;
}
function viewMoneySeg() {
  const x = SH.exp, [y, m] = SH.month.split('-').map(Number);
  const nav = `<div class="row mnav"><button class="icon-btn" data-act="shPrev" aria-label="이전 달">‹</button><h2>${y}년 ${m}월</h2><button class="icon-btn" data-act="shNext" aria-label="다음 달">›</button></div>`;
  if (!x || x.month !== SH.month) return nav + '<div class="card"><p class="empty">불러오는 중…</p></div>';
  const people = SH.info.people?.length ? SH.info.people : Object.keys(x.byOwner || {}), share = people.length ? x.total / people.length : 0;
  const settle = people.map(p => {
    const paid = x.byOwner?.[p] || 0, df = Math.round(paid - share);
    return `<div class="adh"><div class="row"><b>${C.esc(p)}</b><span class="sp"></span><span>${won(paid)} <small>${!x.total || !df ? '' : df > 0 ? `${won(df)} 더 냄` : `${won(-df)} 덜 냄`}</small></span></div>
      <div class="bar ${p === me() ? 'me' : ''}"><i style="width:${x.total ? paid / x.total * 100 : 0}%"></i></div></div>`;
  }).join('');
  const recs = [...(x.records || [])].sort((a, b) => b.date.localeCompare(a.date));
  return `${nav}
    <section class="card"><div class="sum" style="margin-bottom:14px"><div><span class="k">이번 달 합계</span><b>${won(x.total)}</b></div><div><span class="k">한 사람 몫</span><b>${won(Math.round(share))}</b></div></div>
      ${settle}<p style="margin-top:12px"><small>똑같이 나눴을 때의 차이예요. 참고용으로만 봐 주세요.</small></p></section>
    <section>${recs.length ? recs.map(r => `<button class="med" data-act="shEditExp" data-id="${C.esc(r.id)}"><span class="ico ${who(r)}">${C.svg('wallet')}</span>
      <span class="nm">${C.esc(r.title)}<small>${C.esc([C.md(r.date), r.owner, r.category].filter(Boolean).join(' · '))}</small></span><b class="amt">${won(r.amount)}</b>${mine(r) ? '' : `<span class="lk">${C.svg('lock-simple', 'regular')}</span>`}</button>`).join('')
      : '<div class="card"><p class="empty">이 달은 아직 기록이 없어요.</p></div>'}</section>`;
}
function viewAsSeg() {
  if (!SH.as) return '<div class="card"><p class="empty">불러오는 중…</p></div>';
  return SH.as.length ? `<section>${SH.as.map(it => row(it, { showDate: true, act: 'shEditAs' })).join('')}</section>`
    : '<div class="card"><p class="empty">아직 하자·AS 기록이 없어요.<br>고장 난 곳이나 수리 맡긴 일을 적어 두면 같이 볼 수 있어요.</p></div>';
}
export function view() {
  const user = store.syncState().email, st = !user ? 'nologin' : SH.state, e = C.esc;
  const page = (btn, body) => `<div class="narrow-col stack"><div class="page-h" style="margin-bottom:0"><h1>공유</h1>${btn}</div>${body}</div>`;
  if (st === 'nologin') return page('', `<section class="card"><p class="empty">로그인하면 가족과 같이 쓰는<br>일정과 가계부를 볼 수 있어요.</p><button class="btn pri block" data-act="tab" data-v="settings">설정에서 로그인하기</button></section>`);
  if (st === 'unlinked') return page('', `<section class="card"><p class="empty">${e(SH.msg)}<br><small>내 아이디: ${e(user)}</small></p><button class="btn block" data-act="shReload">다시 확인</button></section>`);
  if (st === 'error') return page('', `<section class="card"><p class="empty">${e(SH.msg)}</p><button class="btn block" data-act="shReload">다시 시도</button></section>`);
  if (st !== 'ok' || !SH.info) return page('', '<section class="card"><p class="empty">불러오는 중…</p></section>');
  return page('<button class="btn pri" data-act="shAdd">＋ 추가</button>',
    `<div class="seg" style="margin:0">${Object.entries(SEGS).map(([k, t]) => `<button class="${SH.seg === k ? 'on' : ''}" data-act="shSeg" data-v="${k}">${t}</button>`).join('')}</div>
    ${SH.seg === 'cal' ? viewCalSeg() : SH.seg === 'money' ? viewMoneySeg() : viewAsSeg()}`);
}

/* ---------- 추가 · 수정 양식 ---------- */
function renderSheet() {
  const f = SH.form, e = C.esc, sheet = document.getElementById('sheet');
  const chips = (act, list, cur) => list.map(v => `<button class="chip ${cur === v ? 'on' : ''}" data-act="${act}" data-v="${e(v)}">${e(v)}</button>`).join('');
  const people = SH.info.people?.length ? SH.info.people : [me()];
  const body = f.type === 'e'
    ? `<label class="f">내용</label><input type="text" data-sf="title" value="${e(f.title)}" placeholder="예: 장보기, 관리비" maxlength="100">
       <div class="two"><div><label class="f">날짜</label><input type="date" data-sf="date" value="${e(f.date)}"></div>
       <div><label class="f">금액 (원)</label><input type="number" inputmode="numeric" min="1" step="1" data-sf="amount" value="${e(f.amount)}" placeholder="0"></div></div>
       ${(SH.info.categories || []).length > 1 ? `<label class="f">분류</label><div class="chips">${chips('shCat', SH.info.categories, f.category)}</div>` : ''}
       <label class="f">낸 사람</label><div class="chips">${chips('shOwner', people, f.owner)}</div>`
    : `<label class="f">종류</label><div class="chips">${chips('shKind', KINDS, f.kind)}</div>
       <label class="f">제목</label><input type="text" data-sf="title" value="${e(f.title)}" placeholder="${f.kind === '하자·AS' ? '예: 보일러 점검, 세탁기 수리' : '예: 가족 저녁, 병원'}" maxlength="100">
       <div class="two"><div><label class="f">날짜</label><input type="date" data-sf="date" value="${e(f.date)}"></div>
       <div><label class="f">시간 (선택)</label><input type="time" data-sf="time" value="${e(f.time)}"></div></div>
       <label class="f">끝나는 날 (선택)</label><input type="date" data-sf="endDate" value="${e(f.endDate)}">
       <label class="f">담당</label><div class="chips">${chips('shOwner', people, f.owner)}</div>
       <label class="f">${f.kind === '하자·AS' ? '상황 메모' : '메모'} (선택)</label><textarea data-sf="memo" maxlength="2000" placeholder="${f.kind === '하자·AS' ? '증상, 연락한 곳, 진행 상황…' : ''}">${e(f.memo)}</textarea>`;
  sheet.innerHTML = `<div class="sheet"><div class="sheet-h"><h2>${f.type === 'e' ? '가계부' : f.kind} ${f.id ? '수정' : '추가'}</h2><button class="icon-btn" data-act="shClose" aria-label="닫기">${C.svg('x', 'regular')}</button><button class="icon-btn ok" data-act="shSave" aria-label="저장">${C.svg('check', 'regular')}</button></div>${body}
    ${f.id ? '<div class="foot"><button class="btn danger" data-act="shDel">삭제</button></div>' : ''}</div>`;
}
function openSheet(f) { SH.form = f; renderSheet(); const s = document.getElementById('sheet'); if (!s.open) s.showModal(); }
function closeSheet() { SH.form = null; const s = document.getElementById('sheet'); if (s.open) s.close(); }
function edit(list, id, type) {
  const it = (list || []).find(x => x.id === id);
  if (!it) return;
  if (!mine(it)) return C.toast(`${it.owner || it.author || '다른 사람'} 님이 쓴 항목이라 볼 수만 있어요`);
  openSheet(type === 'e' ? { type, id, title: it.title, date: it.date, amount: it.amount, category: it.category, owner: it.owner }
    : { type, id, title: it.title, date: it.date, time: it.time || '', endDate: it.endDate || '', kind: it.kind || '일정', memo: it.memo || '', owner: it.owner });
}
function moveMonth(n) {
  const [y, m] = SH.month.split('-').map(Number), d = new Date(y, m - 1 + n, 1);
  SH.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (SH.date.slice(0, 7) !== SH.month) SH.date = SH.month === C.todayStr().slice(0, 7) ? C.todayStr() : SH.month + '-01';
  load();
}

export const actions = {
  shSeg: e => { SH.seg = e.v; load(); },
  shReload: () => { SH.state = 'loading'; load(); },
  shPrev: () => moveMonth(-1),
  shNext: () => moveMonth(1),
  shPick: e => { SH.date = e.d; if (e.d.slice(0, 7) !== SH.month) { SH.month = e.d.slice(0, 7); load(); } },
  shAdd: () => {
    const today = C.todayStr(), inMonth = SH.month === today.slice(0, 7) ? today : SH.month + '-01';
    if (SH.seg === 'money') openSheet({ type: 'e', id: null, title: '', date: inMonth, amount: '', category: SH.info.categories?.[0] || '', owner: me() });
    else openSheet({ type: 's', id: null, title: '', date: SH.seg === 'cal' ? SH.date : today, time: '', endDate: '', kind: SH.seg === 'as' ? '하자·AS' : '일정', memo: '', owner: me() });
  },
  shEdit: e => edit(SH.items, e.id, 's'),
  shEditAs: e => edit(SH.as, e.id, 's'),
  shEditExp: e => edit(SH.exp?.records, e.id, 'e'),
  shKind: e => { SH.form.kind = e.v; renderSheet(); },
  shOwner: e => { SH.form.owner = e.v; renderSheet(); },
  shCat: e => { SH.form.category = e.v; renderSheet(); },
  shClose: () => closeSheet(),
  shSave: async () => {
    const f = SH.form, title = (f.title || '').trim();
    if (SH.busy) return;
    if (!title) return C.toast(f.type === 'e' ? '내용을 적어주세요' : '제목을 적어주세요');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) return C.toast('날짜를 골라주세요');
    let body, path;
    if (f.type === 'e') {
      const amount = Number(f.amount);
      if (!Number.isInteger(amount) || amount <= 0) return C.toast('금액을 숫자로 적어주세요');
      path = '/api/expenses'; body = { title, date: f.date, amount, category: f.category, owner: f.owner };
    } else {
      if (f.endDate && f.endDate < f.date) return C.toast('끝나는 날이 시작하는 날보다 빨라요');
      path = '/api/schedules'; body = { title, date: f.date, time: f.time || '', endDate: f.endDate || '', kind: f.kind, memo: (f.memo || '').slice(0, 2000), owner: f.owner };
    }
    SH.busy = true;
    try {
      await api(f.id ? 'PATCH' : 'POST', path, f.id ? { id: f.id, ...body } : body);
      if (f.type === 's' && SH.seg === 'cal') { SH.date = f.date; SH.month = f.date.slice(0, 7); }
      closeSheet(); C.toast('저장했어요'); load();
    } catch (err) { C.toast(err.message); }
    SH.busy = false;
  },
  shDel: async () => {
    const f = SH.form;
    if (SH.busy || !confirm('이 항목을 삭제할까요?\n같이 쓰는 사람에게도 지워져요.')) return;
    SH.busy = true;
    try { await api('DELETE', f.type === 'e' ? '/api/expenses' : '/api/schedules', { id: f.id }); closeSheet(); C.toast('삭제했어요'); load(); }
    catch (err) { C.toast(err.message); }
    SH.busy = false;
  },
};
