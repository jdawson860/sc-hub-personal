// getDashboardData v8 — single-user personal S&C dashboard, reads directly from SessionLog entity
// Adds: session-type-aware history, per-exercise "last time" placeholders, exercise name autocomplete list
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const DEFAULT_ATHLETE = 'Jack';
const SESSION_TYPES = ['UPPER', 'LOWER', 'OTHER'];

function buildDailyLoad(logs: any[]): Record<string, number> {
  const daily: Record<string, number> = {};
  for (const r of logs) {
    const date = r.timestamp?.split('T')[0];
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const load = parseFloat(r.load);
    const reps = parseFloat(r.reps) || 1;
    if (!isNaN(load)) daily[date] = (daily[date] || 0) + load * reps;
  }
  return daily;
}

function rollingMean(daily: Record<string, number>, endDate: string, days: number): number {
  const end = new Date(endDate);
  let total = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    total += daily[d.toISOString().split('T')[0]] || 0;
  }
  return total / days;
}

function computeACWR(logs: any[]) {
  const daily = buildDailyLoad(logs);
  if (!Object.keys(daily).length) return [];
  const allDates = Object.keys(daily).sort();
  const start = new Date(allDates[0]);
  const end = new Date();
  const points = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const daysSinceStart = Math.floor((d.getTime() - start.getTime()) / 86400000);
    if (daysSinceStart < 6) continue;
    const acute = rollingMean(daily, dateStr, 7);
    const chronic = rollingMean(daily, dateStr, 28);
    const provisional = daysSinceStart < 27;
    points.push({
      date: dateStr,
      acute: Math.round(acute),
      chronic: Math.round(chronic),
      acwr: chronic > 0 ? Math.min(parseFloat((acute / chronic).toFixed(2)), 3.0) : 0,
      dailyLoad: Math.round(daily[dateStr] || 0),
      provisional,
    });
  }
  return points;
}

function buildExerciseProgressions(logs: any[]) {
  const exerciseOrder: string[] = [];
  const byExercise: Record<string, any[]> = {};
  const sorted = [...logs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  for (const r of sorted) {
    if (!r.exercise) continue;
    if (!byExercise[r.exercise]) { byExercise[r.exercise] = []; exerciseOrder.push(r.exercise); }
    byExercise[r.exercise].push(r);
  }
  return exerciseOrder.map(ex => {
    const byDate: Record<string, any[]> = {};
    for (const r of byExercise[ex]) {
      const date = r.timestamp?.split('T')[0];
      if (!date) continue;
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(r);
    }
    const points = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, sets]) => {
      const loads = sets.map(s => parseFloat(s.load)).filter(l => !isNaN(l) && l > 0);
      const rpes = sets.map(s => s.rpe).filter(r => r != null);
      return {
        date,
        avgLoad: loads.length ? parseFloat((loads.reduce((a, v) => a + v, 0) / loads.length).toFixed(1)) : null,
        avgRpe: rpes.length ? parseFloat((rpes.reduce((a, v) => a + v, 0) / rpes.length).toFixed(1)) : null,
      };
    });
    return { exercise: ex, points, lastDate: points.length ? points[points.length - 1].date : null };
  }).sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));
}

// Group logs into sessions keyed by date + session_type
function buildSessionHistory(logs: any[]) {
  const byKey: Record<string, any[]> = {};
  for (const r of logs) {
    const date = r.timestamp?.split('T')[0];
    if (!date) continue;
    const type = r.session_type || 'OTHER';
    const key = `${date}|${type}`;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push(r);
  }
  const sessions = Object.entries(byKey).map(([key, sets]) => {
    const [date, session_type] = key.split('|');
    const rpes = sets.filter(s => s.rpe).map(s => s.rpe);
    const tl = sets.reduce((a, s) => { const l = parseFloat(s.load); return a + (isNaN(l) ? 0 : l * (parseFloat(s.reps) || 1)); }, 0);
    const exSeen = new Set<string>();
    const exercises: string[] = [];
    for (const s of sets) { if (s.exercise && !exSeen.has(s.exercise)) { exSeen.add(s.exercise); exercises.push(s.exercise); } }
    return {
      date, session_type,
      totalSets: sets.length,
      avgRpe: rpes.length ? parseFloat((rpes.reduce((a, v) => a + v, 0) / rpes.length).toFixed(1)) : null,
      totalLoad: Math.round(tl),
      exercises,
    };
  });
  return sessions.sort((a, b) => b.date.localeCompare(a.date));
}

// Build the exercise/set list for a specific set of logs on their most recent shared date
function buildDayExercises(dayLogs: any[], date: string) {
  const daySets = dayLogs.filter((l: any) => l.timestamp?.startsWith(date));
  const byExercise: Record<string, any[]> = {};
  const order: string[] = [];
  for (const s of daySets) {
    if (!s.exercise) continue;
    if (!byExercise[s.exercise]) { byExercise[s.exercise] = []; order.push(s.exercise); }
    byExercise[s.exercise].push({ set: s.set_number, reps: s.reps, load: s.load, rpe: s.rpe });
  }
  for (const ex of order) byExercise[ex].sort((a, b) => (a.set || 0) - (b.set || 0));
  return order.map(name => ({ name, sets: byExercise[name] }));
}

// For each session type, find the most recent session and its exercises/sets (for autofill).
// If this type has no history yet, fall back to the single most recent session overall
// (any type) so the logger still prefills something useful instead of a blank list.
function buildLastByType(logs: any[]) {
  const result: Record<string, any> = {};

  let overallFallback: any = null;
  if (logs.length) {
    const lastOverallDate = [...logs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0].timestamp.split('T')[0];
    overallFallback = { date: lastOverallDate, exercises: buildDayExercises(logs, lastOverallDate), fallback: true };
  }

  for (const type of SESSION_TYPES) {
    const typeLogs = logs.filter((l: any) => (l.session_type || 'OTHER') === type);
    if (!typeLogs.length) { result[type] = overallFallback; continue; }
    const lastDate = [...typeLogs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0].timestamp.split('T')[0];
    result[type] = { date: lastDate, exercises: buildDayExercises(typeLogs, lastDate), fallback: false };
  }
  return result;
}

// For every exercise ever logged, remember the sets from the most recent time it was logged (any session type)
function buildExerciseHistory(logs: any[]) {
  const history: Record<string, any> = {};
  const sorted = [...logs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const lastDateByExercise: Record<string, string> = {};
  for (const r of sorted) {
    if (!r.exercise) continue;
    const key = r.exercise.trim().toLowerCase();
    const date = r.timestamp?.split('T')[0];
    if (!date) continue;
    lastDateByExercise[key] = date;
  }
  for (const r of sorted) {
    if (!r.exercise) continue;
    const key = r.exercise.trim().toLowerCase();
    const date = r.timestamp?.split('T')[0];
    if (date !== lastDateByExercise[key]) continue;
    if (!history[key]) history[key] = { name: r.exercise, date, sets: [] };
    history[key].sets.push({ set: r.set_number, reps: r.reps, load: r.load, rpe: r.rpe });
  }
  for (const key of Object.keys(history)) {
    history[key].sets.sort((a: any, b: any) => (a.set || 0) - (b.set || 0));
  }
  return history;
}

// Distinct exercise names, most-recently-used first
function buildExerciseNames(logs: any[]) {
  const sorted = [...logs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const seen = new Set<string>();
  const names: string[] = [];
  for (const r of sorted) {
    if (!r.exercise) continue;
    const key = r.exercise.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(r.exercise);
  }
  return names;
}

Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const athlete = (body.athlete || DEFAULT_ATHLETE);

    const allLogs = await base44.asServiceRole.entities.SessionLog.list();
    const logs = allLogs.filter((l: any) => (l.athlete || DEFAULT_ATHLETE) === athlete);

    const now = new Date();
    const week7 = new Date(now); week7.setDate(now.getDate() - 7);
    const recent = logs.filter((r: any) => new Date(r.timestamp) >= week7);

    const acwrData = computeACWR(logs);
    const latestAcwr = acwrData.length ? acwrData[acwrData.length - 1] : null;
    const hasFullChronic = latestAcwr && !latestAcwr.provisional;

    const avgRpe = logs.filter((r: any) => r.rpe).length
      ? parseFloat((logs.reduce((a: number, r: any) => a + (r.rpe || 0), 0) / logs.filter((r: any) => r.rpe).length).toFixed(1))
      : null;
    const wkLoad = recent.reduce((a: number, r: any) => { const l = parseFloat(r.load); return a + (isNaN(l) ? 0 : l * (parseFloat(r.reps) || 1)); }, 0);

    const sessionHistory = buildSessionHistory(logs);
    const lastSession = sessionHistory.length ? sessionHistory[0] : null;
    const todayStr = now.toISOString().split('T')[0];
    const daysSinceLast = lastSession ? Math.floor((new Date(todayStr).getTime() - new Date(lastSession.date).getTime()) / 86400000) : null;

    const oldestLog = [...logs].sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0];
    const daysSinceFirst = oldestLog ? Math.floor((now.getTime() - new Date(oldestLog.timestamp).getTime()) / 86400000) : 0;

    const exerciseProgressions = buildExerciseProgressions(logs);
    const lastByType = buildLastByType(logs);
    const exerciseHistory = buildExerciseHistory(logs);
    const exerciseNames = buildExerciseNames(logs);

    return Response.json({
      ok: true,
      athlete,
      total_sessions: sessionHistory.length,
      recent_sessions: sessionHistory.filter(s => new Date(s.date) >= week7).length,
      avg_rpe: avgRpe,
      acwr: hasFullChronic ? (latestAcwr?.acwr ?? null) : null,
      acwr_provisional: !hasFullChronic && acwrData.length > 0,
      days_until_acwr: hasFullChronic ? 0 : Math.max(0, 28 - daysSinceFirst),
      acute: hasFullChronic ? (latestAcwr?.acute ?? null) : null,
      chronic: hasFullChronic ? (latestAcwr?.chronic ?? null) : null,
      weekly_load: Math.round(wkLoad),
      days_since_last: daysSinceLast,
      last_session: lastSession,
      acwr_history: acwrData.slice(-28),
      session_history: sessionHistory,
      exercise_progressions: exerciseProgressions,
      last_by_type: lastByType,
      exercise_history: exerciseHistory,
      exercise_names: exerciseNames,
    }, { status: 200, headers: cors });

  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500, headers: cors });
  }
});
