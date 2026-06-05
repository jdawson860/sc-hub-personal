import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

function computeACWR(logs: any[]): { date: string, acute: number, chronic: number, acwr: number, dailyLoad: number }[] {
  const daily = buildDailyLoad(logs);
  if (Object.keys(daily).length === 0) return [];
  const allDates = Object.keys(daily).sort();
  const start = new Date(allDates[0]);
  const end = new Date();
  const points: { date: string, acute: number, chronic: number, acwr: number, dailyLoad: number }[] = [];

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
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { view, athlete } = body;

    const allLogs = await base44.asServiceRole.entities.SessionLog.list();

    // Group by athlete
    const byAthlete: Record<string, any[]> = {};
    for (const r of allLogs) {
      if (!byAthlete[r.athlete]) byAthlete[r.athlete] = [];
      byAthlete[r.athlete].push(r);
    }

    const athletes = Object.keys(byAthlete).sort();
    const now = new Date();
    const week7 = new Date(now); week7.setDate(now.getDate() - 7);

    // Squad heatmap: this week, each athlete x session type
    const sessionTypes = ['Lower A', 'Lower B', 'Upper A', 'Upper B'];
    const heatmap: Record<string, Record<string, boolean>> = {};
    for (const ath of athletes) {
      heatmap[ath] = {};
      for (const st of sessionTypes) heatmap[ath][st] = false;
      for (const r of byAthlete[ath]) {
        if (new Date(r.timestamp) >= week7) {
          heatmap[ath][r.session_type] = true;
        }
      }
    }

    // Per-athlete summaries
    const athleteSummaries = athletes.map(ath => {
      const logs = byAthlete[ath];
      const recent = logs.filter(r => new Date(r.timestamp) >= week7);
      const acwrData = computeACWR(logs);
      const latestAcwr = acwrData.length ? acwrData[acwrData.length - 1] : null;
      const avgRpe = logs.filter(r => r.rpe).length
        ? parseFloat((logs.reduce((a, r) => a + (r.rpe || 0), 0) / logs.filter(r => r.rpe).length).toFixed(1))
        : null;
      const highRpeSets = logs.filter(r => r.rpe >= 9).length;

      // Session counts
      const sessionCounts: Record<string, number> = {};
      for (const st of sessionTypes) sessionCounts[st] = 0;
      for (const r of logs) {
        if (sessionCounts[r.session_type] !== undefined) sessionCounts[r.session_type]++;
      }

      // Weekly load
      const wkLoad = recent.reduce((a, r) => {
        const l = parseFloat(r.load);
        return a + (isNaN(l) ? 0 : l * (r.reps || 1));
      }, 0);

      const lastLog = [...logs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
      const daysSinceLast = lastLog ? Math.floor((now.getTime() - new Date(lastLog.timestamp).getTime()) / 86400000) : null;

      // Distinct session types done recently
      const recentTypes = [...new Set(recent.map(r => r.session_type))];

      return {
        athlete: ath,
        total_sessions: logs.length,
        recent_sessions: recent.length,
        avg_rpe: avgRpe,
        high_rpe_sets: highRpeSets,
        acwr: latestAcwr?.acwr ?? null,
        acute: latestAcwr?.acute ?? null,
        chronic: latestAcwr?.chronic ?? null,
        weekly_load: Math.round(wkLoad),
        session_counts: sessionCounts,
        days_since_last: daysSinceLast,
        recent_types: recentTypes,
        acwr_history: acwrData.slice(-28),
      };
    });

    // Squad-level stats
    const totalSessions = allLogs.length;
    const activeThisWeek = athletes.filter(a => byAthlete[a].some(r => new Date(r.timestamp) >= week7)).length;
    const allRpes = allLogs.filter(r => r.rpe).map(r => r.rpe);
    const avgSquadRpe = allRpes.length ? parseFloat((allRpes.reduce((a, v) => a + v, 0) / allRpes.length).toFixed(1)) : null;
    const highRpeSets = allLogs.filter(r => r.rpe >= 9).length;

    // Individual athlete detail (ACWR history + all sets)
    let individualDetail = null;
    if (athlete && byAthlete[athlete]) {
      const logs = byAthlete[athlete];
      const acwrData = computeACWR(logs);
      
      // Session index for this athlete (distinct date+session_type combos)
      const sessionIndex: { date: string, session_type: string, set_count: number, avg_rpe: number | null, total_load: number }[] = [];
      const seen = new Set<string>();
      for (const r of logs) {
        const date = r.timestamp?.split('T')[0];
        const key = `${date}|${r.session_type}`;
        if (!seen.has(key)) {
          seen.add(key);
          const sets = logs.filter(l => l.timestamp?.startsWith(date) && l.session_type === r.session_type);
          const rpes = sets.filter(s => s.rpe).map(s => s.rpe);
          const tl = sets.reduce((a, s) => {
            const l = parseFloat(s.load);
            return a + (isNaN(l) ? 0 : l * (s.reps || 1));
          }, 0);
          sessionIndex.push({
            date,
            session_type: r.session_type,
            set_count: sets.length,
            avg_rpe: rpes.length ? parseFloat((rpes.reduce((a, v) => a + v, 0) / rpes.length).toFixed(1)) : null,
            total_load: Math.round(tl),
          });
        }
      }
      sessionIndex.sort((a, b) => b.date.localeCompare(a.date));

      individualDetail = {
        athlete,
        logs: logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
        acwr_history: acwrData,
        session_index: sessionIndex,
      };
    }

    return Response.json({
      ok: true,
      athletes,
      athlete_summaries: athleteSummaries,
      squad: {
        total_sessions: totalSessions,
        active_this_week: activeThisWeek,
        total_athletes: athletes.length,
        avg_rpe: avgSquadRpe,
        high_rpe_sets: highRpeSets,
      },
      heatmap,
      session_types: sessionTypes,
      individual: individualDetail,
    }, { status: 200, headers: cors });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500, headers: cors });
  }
});
