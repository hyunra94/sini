// 일과기록 알림 서버.
//  - 예약 작업이 5분마다 부른다(x-cron-secret 필요): 시간이 됐는데 체크하지 않은 약이 있으면 알림을 보낸다.
//  - 앱이 부른다: { action: "key" } 공개 키 받기, { action: "test" } 내 기기로 시험 알림 (로그인 토큰 필요).
// 비밀 값(서명 키, 예약 암호)은 carelog_private 표에 있고 이 함수만 읽는다.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { newVapid, sendPush } from "./push.ts";
import { addDays, due } from "./plan.ts";

const db = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
const SUBJECT = "https://hyunra.kr/sini/";
const ORIGINS = ["https://hyunra.kr"];

const priv = async (name) => (await db.from("carelog_private").select("value").eq("name", name).maybeSingle()).data?.value ?? null;
async function vapid() {
  let v = await priv("vapid");
  if (!v) {  // 처음 한 번만 서버 안에서 만든다
    await db.from("carelog_private").upsert({ name: "vapid", value: JSON.stringify(await newVapid()) }, { onConflict: "name", ignoreDuplicates: true });
    v = await priv("vapid");
  }
  return JSON.parse(v);
}
async function push(subs, msg, v) {
  let sent = 0;
  for (const s of subs) {
    try {
      const st = await sendPush(s, JSON.stringify(msg), v, SUBJECT);
      if (st === 404 || st === 410) await db.from("carelog_push").delete().eq("endpoint", s.endpoint);  // 더는 쓰지 않는 기기
      else if (st >= 200 && st < 300) sent++;
      else console.log("push status", st, new URL(s.endpoint).host);
    } catch (e) { console.log("push error", String(e)); }
  }
  return sent;
}
/* 공유 앱 서버에서 오늘 일정을 받아 { 일과기록 아이디: { title, body } }로 만든다. 암호(BRIEFING_SECRET)가 없으면 건너뛴다 */
const BRIEF_URL = "https://paperlog-share.hyunra94.workers.dev/api/briefing", BRIEF_MIN = 8 * 60;
async function briefing(today) {
  const secret = Deno.env.get("BRIEFING_SECRET");
  if (!secret) return null;
  const r = await fetch(`${BRIEF_URL}?date=${today}`, { headers: { "x-briefing-secret": secret } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) { console.log("briefing status", r.status); return null; }
  const out = {};
  for (const m of j.members || []) {
    const list = m.schedules || [];
    if (!m.siniId || !list.length) continue;
    const lines = list.slice(0, 4).map((s) => `${s.time ? s.time + " " : ""}${s.title}${s.owner ? ` (${s.owner})` : ""}`);
    if (list.length > 4) lines.push(`외 ${list.length - 4}개`);
    out[String(m.siniId).toLowerCase()] = { title: `오늘 일정 ${list.length}개`, body: lines.join("\n") };
  }
  return out;
}
async function tick() {
  const k = new Date(Date.now() + 9 * 3600e3);  // 한국 시간
  const today = k.toISOString().slice(0, 10), nowMin = k.getUTCHours() * 60 + k.getUTCMinutes();
  const { data: subs } = await db.from("carelog_push").select("endpoint,user_id,p256dh,auth");
  const byUser = {};
  for (const s of subs || []) (byUser[s.user_id] ??= []).push(s);
  let sent = 0, v = null;
  for (const [uid, list] of Object.entries(byUser)) {
    // 설정, 약, 최근 60일 기록 ('day:' 뒤로 정렬되는 키가 모두 여기에 들어온다)
    const { data: rows } = await db.from("carelog_records").select("key,data,deleted").eq("user_id", uid).gte("key", "day:" + addDays(today, -60)).limit(2000);
    const recs = {};
    for (const r of rows || []) if (!r.deleted && r.data) recs[r.key] = r.data;
    for (const n of due(recs, today, nowMin)) {
      const { error } = await db.from("carelog_notified").insert({ user_id: uid, key: n.key });
      if (error) continue;  // 이미 보낸 알림
      sent += await push(list, { title: n.title, body: n.body, tag: n.key }, v ??= await vapid());
    }
  }
  // 오전 8시 브리핑: 아직 안 받은 사람이 있을 때만 공유 앱 서버에 물어본다. 실패하면 다음 5분에 다시 해 본다
  if (nowMin >= BRIEF_MIN && nowMin < BRIEF_MIN + 90 && Object.keys(byUser).length) {
    const key = `${today}:brief`;
    const { data: done } = await db.from("carelog_notified").select("user_id").eq("key", key);
    const todo = Object.keys(byUser).filter((u) => !(done || []).some((d) => d.user_id === u));
    const br = todo.length ? await briefing(today).catch(() => null) : null;
    if (br) {
      for (const uid of todo) {
        const { data } = await db.auth.admin.getUserById(uid);
        const id = (data?.user?.email || "").split("@")[0].toLowerCase();
        const { error } = await db.from("carelog_notified").insert({ user_id: uid, key });
        if (error || !br[id]) continue;  // 일정이 없는 날은 보내지 않는다
        sent += await push(byUser[uid], { ...br[id], tag: key }, v ??= await vapid());
      }
    }
  }
  await db.from("carelog_notified").delete().lt("at", new Date(Date.now() - 3 * 864e5).toISOString());
  return { users: Object.keys(byUser).length, sent };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const cors = {
    "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0], "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "key") return json({ ok: true, key: (await vapid()).pub });
    if (body.action === "test") {
      const token = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
      const { data } = await db.auth.getUser(token);
      if (!data?.user) return json({ ok: false, error: "로그인이 필요해요" }, 401);
      const { data: subs } = await db.from("carelog_push").select("endpoint,user_id,p256dh,auth").eq("user_id", data.user.id);
      if (!subs?.length) return json({ ok: false, error: "등록된 기기가 없어요" }, 404);
      const sent = await push(subs, { title: "알림이 켜졌어요", body: "약 먹을 시간이 되면 여기로 알려 드릴게요", tag: "test" }, await vapid());
      return json({ ok: sent > 0, sent, error: sent ? undefined : "알림을 보내지 못했어요" });
    }
    const secret = req.headers.get("x-cron-secret");
    if (!secret || secret !== await priv("cron")) return json({ ok: false, error: "forbidden" }, 403);
    if (body.action === "briefcheck") {  // 공유 앱 서버와 암호가 맞는지만 확인한다 (일정 내용은 돌려주지 않는다)
      const s = Deno.env.get("BRIEFING_SECRET");
      if (!s) return json({ ok: false, error: "no secret" });
      const r = await fetch(BRIEF_URL, { headers: { "x-briefing-secret": s } });
      const j = await r.json().catch(() => ({}));
      return json({ ok: r.ok && !!j.ok, status: r.status, members: (j.members || []).length });
    }
    return json({ ok: true, ...(await tick()) });
  } catch (e) {
    console.log("error", String(e));
    return json({ ok: false, error: "server error" }, 500);
  }
});
