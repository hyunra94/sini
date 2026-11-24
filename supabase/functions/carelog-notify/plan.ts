// 지금 보낼 알림을 고른다. 앱(app.js)의 plan()과 같은 규칙을 서버에서 다시 계산한다.
export const SLOTS = { morning: "아침", noon: "점심", evening: "저녁", night: "자기 전" };
export const DEFAULT_TIMES = { morning: "08:00", noon: "12:30", evening: "18:30", night: "22:30" };
const WINDOW = 90;  // 정한 시각부터 이만큼(분) 안에만 보낸다. 서버가 잠깐 쉬어도 놓치지 않게 넉넉히 둔다
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const diff = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);
export const addDays = (s, n) => new Date(parse(s) + n * 864e5).toISOString().slice(0, 10);

/** recs: { 키: 데이터 } (지운 기록 제외), today: 'YYYY-MM-DD', nowMin: 자정부터 흐른 분 → [{ key, title, body }] */
export function due(recs, today, nowMin) {
  const st = recs.settings || {};
  if (st.notify === false) return [];
  const times = { ...DEFAULT_TIMES, ...(st.times || {}) };
  const taken = recs["day:" + today]?.taken || {};
  const count = { morning: 0, noon: 0, evening: 0, night: 0 };
  let shot = 0;
  for (const [k, m] of Object.entries(recs)) {
    if (!k.startsWith("med:") || !m) continue;
    const id = k.slice(4);
    if (m.end && today > m.end) continue;
    if (m.kind === "daily") {
      if (m.start && today < m.start) continue;
      for (const s of m.slots || []) if (s in count && !taken[id]?.[s]) count[s]++;
    } else if (m.kind === "pack") {  // 피임약: 먹는 날에만, 휴약일과 시작 전에는 보내지 않는다
      const a = [m.start, ...(m.packs || [])].filter(Boolean).sort().filter((x) => x <= today).at(-1);
      if (!a) continue;
      const i = diff(today, a) % (m.active + m.rest), s = m.slots?.[0] || "night";
      if (i < m.active && s in count && !taken[id]?.[s]) count[s]++;
    } else if (m.kind === "interval") {  // 주사: 예정일이 됐는데 아직 안 맞았으면 아침 시각에
      if (taken[id]?.shot || (m.start && today < m.start)) continue;
      const prev = Object.keys(recs).filter((d) => d.startsWith("day:") && d.slice(4) < today && recs[d]?.taken?.[id]?.shot).sort().at(-1)?.slice(4);
      const next = prev ? addDays(prev, m.every || 7) : (m.start || today);
      if (next <= today) shot++;
    }
  }
  const inWin = (t) => { const [h, mi] = String(t).split(":").map(Number), tm = h * 60 + mi; return Number.isFinite(tm) && nowMin >= tm && nowMin < tm + WINDOW; };
  const out = [];
  for (const s of Object.keys(count)) {
    if (count[s] && inWin(times[s])) out.push({ key: `${today}:${s}`, title: `${SLOTS[s]} 약 먹을 시간이에요`, body: count[s] > 1 ? `아직 체크하지 않은 약이 ${count[s]}개 있어요` : "아직 체크하지 않은 약이 있어요" });
  }
  if (shot && inWin(times.morning)) out.push({ key: `${today}:shot`, title: "오늘은 주사 맞는 날이에요", body: "맞은 뒤에 기록해 주세요" });
  return out;
}
