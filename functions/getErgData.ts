import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

function buildDailyErgLoad(sessions: any[]): Record<string, number> {
  // For erg, daily load = total_distance (metres)
  const daily: Record<string, number> = {};
  for (const s of sessions) {
    const date = s.timestamp?.split('T')[0];
    if (!date) continue;
    if (s.total_distance) {
      daily[date] = (daily[date] || 0) + s.total_distance;
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

function computeErgACWR(sessions: any[]): { date: string, acute: number, chronic: number, acwr: number, dailyLoad: number }[] {
  const daily = buildDailyErgLoad(sessions);
  if (Object.keys(daily).length === 0) return [];
  const allDates = Object.keys(daily).sort();
  const start = new Date(allDates[0]);
  const end = new Date();
  const points = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const acute = rollingMean(daily, dateStr, 7);
    const chronic = rollingMean(daily, dateStr, 28);
    const acwr = chronic > 0 ? parseFloat((acute / chronic).toFixed(2)) : 0;
    const daysSinceStart = Math.floor((d.getTime() - start.getTime()) / 86400000);
    if (daysSinceStart >= 6) {
      points.push({ date: dateStr, acute: Math.round(acute), chronic: Math.round(chronic), acwr, dailyLoad: Math.round(daily[dateStr] || 0) });
    }
  }
  return points;
}

Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => () => ({}));
    const athlete = body?.athlete || null;

    const allSessions = await base44.asServiceRole.entities.ErgSession.list();

    // Per-athlete aggregation
    const byAthlete: Record<string, any[]> = {};
    for (const s of allSessions) {
      if (!byAthlete[s.athlete]) byAthlete[s.athlete] = [];
      byAthlete[s.athlete].push(s);
    }

    const athletes = Object.keys(byAthlete).sort();

    // Squad summary
    const now = new Date();
    const week7 = new Date(now); week7.setDate(now.getDate() - 7);

    const athleteSummaries = athletes.map(ath => {
      const logs = byAthlete[ath];
      const recent = logs.filter(s => new Date(s.timestamp) >= week7);
      const acwrData = computeErgACWR(logs);
      const latestAcwr = acwrData.length ? acwrData[acwrData.length - 1] : null;
      const avgRpe = logs.length ? parseFloat((logs.reduce((a, s) => a + (s.rpe || 0), 0) / logs.filter(s => s.rpe).length).toFixed(1)) : null;
      const totalDist = logs.reduce((a, s) => a + (s.total_distance || 0), 0);
      const lastSession = logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
      const daysSinceLast = lastSession ? Math.floor((now.getTime() - new Date(lastSession.timestamp).getTime()) / 86400000) : null;

      return {
        athlete: ath,
        total_sessions: logs.length,
        recent_sessions: recent.length,
        total_distance: totalDist,
        avg_rpe: avgRpe,
        acwr: latestAcwr?.acwr || null,
        acute: latestAcwr?.acute || null,
        chronic: latestAcwr?.chronic || null,
        days_since_last: daysSinceLast,
        last_session: lastSession ? { date: lastSession.timestamp.split('T')[0], type: lastSession.workout_type, distance: lastSession.total_distance, split: lastSession.avg_split } : null,
        acwr_history: acwrData.slice(-28),
      };
    });

    // Individual detail if requested
    let individualData = null;
    if (athlete && byAthlete[athlete]) {
      const logs = byAthlete[athlete].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      const acwrData = computeErgACWR(logs);
      individualData = {
        athlete,
        sessions: logs,
        acwr_history: acwrData,
      };
    }

    // Squad-level erg ACWR
    const squadAcwr = computeErgACWR(allSessions);

    return Response.json({
      ok: true,
      athletes,
      athlete_summaries: athleteSummaries,
      squad_acwr: squadAcwr.slice(-28),
      sessions: athlete ? byAthlete[athlete] || [] : allSessions,
      individual: individualData,
    }, { status: 200, headers: cors });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500, headers: cors });
  }
});
