import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ── ACWR helpers ──────────────────────────────────────────────────────────────
// Daily load = sum(load × reps) for all sets on that day
// Acute  = rolling 7-day average daily load
// Chronic = rolling 28-day average daily load
// ACWR = Acute / Chronic  (flagged: <0.8 undertraining, 0.8-1.3 optimal, >1.5 danger)

function buildDailyLoad(logs: any[]): Record<string, number> {
  const daily: Record<string, number> = {};
  for (const r of logs) {
    const date = r.timestamp?.split('T')[0];
    if (!date) continue;
    const load = parseFloat(r.load);
    const reps = r.reps || 1;
    if (!isNaN(load)) {
      daily[date] = (daily[date] || 0) + load * reps;
    }
  }
  return daily;
}

function rollingMean(daily: Record<string, number>, endDate: string, days: number): number {
  const end = new Date(endDate);
  let total = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const key = d.toISOString().split('T')[0];
    total += daily[key] || 0;
  }
  return total / days;
}

function computeACWR(logs: any[], windowDays = 56): { date: string, acute: number, chronic: number, acwr: number, dailyLoad: number }[] {
  const daily = buildDailyLoad(logs);
  if (Object.keys(daily).length === 0) return [];

  // Get date range — from earliest log to today
  const allDates = Object.keys(daily).sort();
  const start = new Date(allDates[0]);
  const end = new Date();

  const points: { date: string, acute: number, chronic: number, acwr: number, dailyLoad: number }[] = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const acute  = rollingMean(daily, dateStr, 7);
    const chronic = rollingMean(daily, dateStr, 28);
    const acwr   = chronic > 0 ? parseFloat((acute / chronic).toFixed(2)) : 0;
    const dailyLoad = daily[dateStr] || 0;

    // Only include days where we have at least 28 days of history (for meaningful chronic)
    const daysSinceStart = Math.floor((d.getTime() - start.getTime()) / 86400000);
    if (daysSinceStart >= 6) { // need at least 7 days for acute to be meaningful
      points.push({
        date: dateStr,
        acute: Math.round(acute),
        chronic: Math.round(chronic),
        acwr,
        dailyLoad: Math.round(dailyLoad)
      });
    }
  }

  return points;
}

// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { athlete, view } = body;

    const allLogs = await base44.asServiceRole.entities.SessionLog.list();

    if (!allLogs || allLogs.length === 0) {
      return Response.json({ logs: [], summary: [], athletes: [] });
    }

    const athletes = [...new Set(allLogs.map((r: any) => r.athlete))].sort();

    // ── ATHLETE VIEW ──────────────────────────────────────────────────────────
    if (view === 'athlete' && athlete) {
      const logs = allLogs.filter((r: any) => r.athlete === athlete);

      // Exercise progressions
      const exerciseMap: Record<string, any[]> = {};
      for (const log of logs) {
        if (!exerciseMap[log.exercise]) exerciseMap[log.exercise] = [];
        exerciseMap[log.exercise].push(log);
      }
      const exerciseProgressions = Object.entries(exerciseMap).map(([exercise, sets]) => {
        const sorted = sets.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        const byDate: Record<string, any[]> = {};
        for (const s of sorted) {
          const date = s.timestamp.split('T')[0];
          if (!byDate[date]) byDate[date] = [];
          byDate[date].push(s);
        }
        const points = Object.entries(byDate).map(([date, sets]) => {
          const loadNums = sets.map((s: any) => parseFloat(s.load)).filter((v: number) => !isNaN(v));
          const avgLoad = loadNums.length > 0 ? loadNums.reduce((a: number, b: number) => a + b, 0) / loadNums.length : null;
          const avgRpe = sets.reduce((a: number, b: any) => a + (b.rpe || 0), 0) / sets.length;
          const totalReps = sets.reduce((a: number, b: any) => a + (b.reps || 0), 0);
          return { date, avgLoad: avgLoad ? Math.round(avgLoad * 10) / 10 : null, avgRpe: Math.round(avgRpe * 10) / 10, totalReps };
        });
        return { exercise, points };
      });

      // Session history
      const sessionMap: Record<string, any> = {};
      for (const log of logs) {
        const key = `${log.timestamp.split('T')[0]}_${log.session_type}`;
        if (!sessionMap[key]) {
          sessionMap[key] = { date: log.timestamp.split('T')[0], session_type: log.session_type, exercises: [], totalSets: 0, rpeSum: 0, rpeCount: 0 };
        }
        if (!sessionMap[key].exercises.includes(log.exercise)) sessionMap[key].exercises.push(log.exercise);
        sessionMap[key].totalSets++;
        if (log.rpe) { sessionMap[key].rpeSum += log.rpe; sessionMap[key].rpeCount++; }
      }
      const sessionHistory = Object.values(sessionMap).map((s: any) => ({
        ...s,
        avgRpe: s.rpeCount > 0 ? Math.round((s.rpeSum / s.rpeCount) * 10) / 10 : null
      })).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

      // ACWR for this athlete
      const acwrSeries = computeACWR(logs);
      const latestACWR = acwrSeries.length > 0 ? acwrSeries[acwrSeries.length - 1] : null;

      // Weekly volume (last 6 weeks)
      const now = new Date();
      const weeklyVol: { week: string, vol: number }[] = [];
      for (let w = 5; w >= 0; w--) {
        const wStart = new Date(now); wStart.setDate(now.getDate() - (w + 1) * 7);
        const wEnd   = new Date(now); wEnd.setDate(now.getDate() - w * 7);
        const wLogs  = logs.filter((r: any) => { const d = new Date(r.timestamp); return d >= wStart && d < wEnd; });
        const vol    = wLogs.reduce((a: number, r: any) => { const l = parseFloat(r.load); return a + (isNaN(l) ? 0 : l * (r.reps || 1)); }, 0);
        weeklyVol.push({ week: w === 0 ? 'This wk' : `W-${w}`, vol: Math.round(vol) });
      }

      return Response.json({ athlete, athletes, logs, exerciseProgressions, sessionHistory, acwrSeries, latestACWR, weeklyVol });
    }

    // ── COACH VIEW ────────────────────────────────────────────────────────────
    const athleteSummary = athletes.map((ath: string) => {
      const athLogs = allLogs.filter((r: any) => r.athlete === ath);
      const dates = [...new Set(athLogs.map((r: any) => r.timestamp.split('T')[0]))].sort() as string[];
      const lastSession = dates[dates.length - 1] || null;
      const totalSessions = [...new Set(athLogs.map((r: any) => `${r.timestamp.split('T')[0]}_${r.session_type}`))].length;
      const rpeLogs = athLogs.filter((r: any) => r.rpe);
      const avgRpe = rpeLogs.length > 0 ? rpeLogs.reduce((a: number, b: any) => a + b.rpe, 0) / rpeLogs.length : 0;
      const highRpeSets = athLogs.filter((r: any) => r.rpe >= 9).length;

      // Session type counts
      const sessionCounts: Record<string, number> = { 'Lower A': 0, 'Lower B': 0, 'Upper A': 0, 'Upper B': 0 };
      for (const st of Object.keys(sessionCounts)) {
        sessionCounts[st] = [...new Set(athLogs.filter((r: any) => r.session_type === st).map((r: any) => r.timestamp.split('T')[0]))].length;
      }

      // Weekly load (last 4 weeks)
      const now = new Date();
      const weeklyLoad: { week: string, totalVolume: number }[] = [];
      for (let w = 3; w >= 0; w--) {
        const weekStart = new Date(now); weekStart.setDate(now.getDate() - (w + 1) * 7);
        const weekEnd   = new Date(now); weekEnd.setDate(now.getDate() - w * 7);
        const weekLogs  = athLogs.filter((r: any) => { const d = new Date(r.timestamp); return d >= weekStart && d < weekEnd; });
        const vol = weekLogs.reduce((a: number, b: any) => { const l = parseFloat(b.load); return a + (isNaN(l) ? 0 : l * (b.reps || 1)); }, 0);
        weeklyLoad.push({ week: `W${4 - w}`, totalVolume: Math.round(vol) });
      }

      // ACWR for this athlete (just the latest value for the squad table)
      const acwrSeries = computeACWR(athLogs);
      const latestACWR = acwrSeries.length > 0 ? acwrSeries[acwrSeries.length - 1] : null;

      return { athlete: ath, lastSession, totalSessions, avgRpe: Math.round(avgRpe * 10) / 10, highRpeSets, sessionCounts, weeklyLoad, totalSets: athLogs.length, latestACWR };
    });

    // Squad-level ACWR (aggregate all athletes daily load, then compute)
    const squadACWR = computeACWR(allLogs);

    // Squad RPE trend (last 30 days)
    const now = new Date();
    const rpeTrend: { date: string, avgRpe: number }[] = [];
    for (let d = 29; d >= 0; d--) {
      const day = new Date(now); day.setDate(now.getDate() - d);
      const dayStr = day.toISOString().split('T')[0];
      const dayLogs = allLogs.filter((r: any) => r.timestamp.startsWith(dayStr) && r.rpe);
      if (dayLogs.length > 0) {
        const avg = dayLogs.reduce((a: number, b: any) => a + b.rpe, 0) / dayLogs.length;
        rpeTrend.push({ date: dayStr, avgRpe: Math.round(avg * 10) / 10 });
      }
    }

    return Response.json({ athletes, athleteSummary, rpeTrend, squadACWR });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
