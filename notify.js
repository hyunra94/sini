// 이 기기의 알림 켜기 · 끄기. 실제 알림은 서버(supabase/functions/carelog-notify)가 시간에 맞춰 보낸다.
import * as store from './store.js';

const FN = '/functions/v1/carelog-notify';
const b64d = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
let cur = 'unknown';  // unknown | unsupported | denied | off | on
export const state = () => cur;

const registration = async () => ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) ? (await navigator.serviceWorker.getRegistration()) || null : null;
/** 지금 상태를 다시 확인한다. 바뀌었으면 true */
export async function refresh() {
  const before = cur, reg = await registration().catch(() => null);
  if (!reg) cur = 'unsupported';
  else if (Notification.permission === 'denied') cur = 'denied';
  else cur = (await reg.pushManager.getSubscription().catch(() => null)) ? 'on' : 'off';
  return cur !== before;
}
async function call(body) {
  const r = await store.server(FN, { method: 'POST', body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || '알림 서버에 연결하지 못했어요');
  return j;
}
export async function enable() {
  // 권한 요청은 누른 직후 바로 해야 한다 (아이폰은 그 사이에 다른 일을 하면 창을 띄워 주지 않는다)
  if (await Notification.requestPermission() !== 'granted') { await refresh(); throw new Error('알림이 허용되지 않았어요'); }
  const reg = await registration();
  if (!reg) throw new Error('이 화면에서는 알림을 켤 수 없어요');
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64d((await call({ action: 'key' })).key) });
  const j = sub.toJSON();
  const r = await store.server('/rest/v1/carelog_push?on_conflict=endpoint', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }),
  });
  if (!r.ok) { await sub.unsubscribe().catch(() => {}); await refresh(); throw new Error('기기를 등록하지 못했어요'); }
  await refresh();
  await call({ action: 'test' });
}
export const test = () => call({ action: 'test' });
export async function disable() {
  const reg = await registration(), sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await store.server('/rest/v1/carelog_push?endpoint=eq.' + encodeURIComponent(sub.endpoint), { method: 'DELETE' }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  await refresh();
}
