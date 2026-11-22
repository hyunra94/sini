// 기기 저장 + 클라우드 동기화.
// 모든 기록은 { 키: { d: 데이터, u: 수정시각(ms), x: 삭제여부 } } 형태로 기기에 먼저 저장되고,
// 로그인 상태면 Supabase의 carelog_records 테이블과 "나중에 수정한 쪽이 이김" 규칙으로 맞춘다.
import { CFG } from './config.js';

const LS_DB = 'carelog.db.v1', LS_SESSION = 'carelog.session.v1', LS_LAST = 'carelog.lastSync.v1';
let db = load(LS_DB) || {};
let session = load(LS_SESSION);
let lastError = '', syncing = false, timer = null, listener = () => {};

function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function persist() { localStorage.setItem(LS_DB, JSON.stringify(db)); }

export const get = key => { const r = db[key]; return r && !r.x ? r.d : null; };
export const keys = prefix => Object.keys(db).filter(k => k.startsWith(prefix) && !db[k].x);
export function put(key, data) { db[key] = { d: data, u: Date.now(), x: false }; persist(); schedule(); }
export function del(key) { db[key] = { d: null, u: Date.now(), x: true }; persist(); schedule(); }
export const onRemoteChange = fn => { listener = fn; };

export const exportJSON = () => JSON.stringify({ app: 'carelog', version: 1, exported: new Date().toISOString(), records: db }, null, 2);
export function importJSON(text) {
  const j = JSON.parse(text);
  if (j.app !== 'carelog' || typeof j.records !== 'object') throw new Error('bad file');
  let n = 0;
  for (const [k, r] of Object.entries(j.records)) {
    if (!r || typeof r.u !== 'number') continue;
    if (!db[k] || r.u > db[k].u) { db[k] = { d: r.d, u: r.u, x: !!r.x }; n++; }
  }
  persist(); schedule();
  return n;
}

/* ---------- 계정 ---------- */
const configured = () => !!(CFG.url && CFG.key);
export const syncState = () => ({ configured: configured(), email: session?.email || '', last: +localStorage.getItem(LS_LAST) || 0, error: lastError });

async function auth(path, body) {
  const r = await fetch(`${CFG.url}/auth/v1/${path}`, { method: 'POST', headers: { apikey: CFG.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = j.msg || j.error_description || j.message || '';
    throw new Error(/invalid login/i.test(m) ? '이메일 또는 비밀번호가 맞지 않아요' : /already registered/i.test(m) ? '이미 가입된 이메일이에요' : /at least/i.test(m) ? '비밀번호가 너무 짧아요' : m || '요청에 실패했어요');
  }
  return j;
}
function saveSession(j, email) {
  if (!j.access_token) return false;
  session = { at: j.access_token, rt: j.refresh_token, exp: Date.now() + j.expires_in * 1000, email: j.user?.email || email || session?.email };
  localStorage.setItem(LS_SESSION, JSON.stringify(session));
  return true;
}
export async function login(email, password) {
  saveSession(await auth('token?grant_type=password', { email, password }), email);
  await sync();
  return true;
}
export async function signup(email, password) {
  const ok = saveSession(await auth('signup', { email, password }), email);  // 메일 확인이 켜져 있으면 세션이 없다
  if (ok) await sync();
  return ok;
}
export function logout() { session = null; localStorage.removeItem(LS_SESSION); lastError = ''; }
async function token() {
  if (Date.now() > session.exp - 60000) saveSession(await auth('token?grant_type=refresh_token', { refresh_token: session.rt }));
  return session.at;
}

/* ---------- 동기화 ---------- */
function schedule() { clearTimeout(timer); timer = setTimeout(sync, 1500); }

export async function sync() {
  if (!configured() || !session || syncing || !navigator.onLine) return;
  syncing = true;
  try {
    const h = { apikey: CFG.key, Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' };
    const remote = {};
    for (let off = 0; ; off += 1000) {
      const r = await fetch(`${CFG.url}/rest/v1/carelog_records?select=key,data,updated_at,deleted&order=key&limit=1000&offset=${off}`, { headers: h });
      if (!r.ok) throw new Error(r.status === 401 ? '다시 로그인이 필요해요' : `서버 오류 (${r.status})`);
      const rows = await r.json();
      for (const row of rows) remote[row.key] = row;
      if (rows.length < 1000) break;
    }
    let changed = false;
    for (const row of Object.values(remote)) {
      const l = db[row.key];
      if (!l || row.updated_at > l.u) { db[row.key] = { d: row.data, u: row.updated_at, x: row.deleted }; changed = true; }
    }
    const push = Object.entries(db).filter(([k, l]) => !remote[k] || l.u > remote[k].updated_at)
      .map(([key, l]) => ({ key, data: l.d, updated_at: l.u, deleted: l.x }));
    for (let i = 0; i < push.length; i += 500) {
      const r = await fetch(`${CFG.url}/rest/v1/carelog_records?on_conflict=user_id,key`, {
        method: 'POST', headers: { ...h, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(push.slice(i, i + 500)),
      });
      if (!r.ok) throw new Error(`저장 실패 (${r.status})`);
    }
    if (changed) persist();
    lastError = '';
    localStorage.setItem(LS_LAST, Date.now());
    if (changed) listener();
  } catch (e) {
    lastError = e.message || '연결 실패';
  } finally { syncing = false; }
}
