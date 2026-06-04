import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json().catch(() => ({}));
    const { athlete, view } = body; // view = 'coach' or 'athlete'

    const allLogs = await base44.asServiceRole.entities.SessionLog.list();

    if (!allLogs || allLogs.length === 0) {
      return Response.json({ logs: [], summary: [], athletes: [] });
    }

    const athletes = [...new Set(allLogs.map((r: any) => r.athlete))].sort();

    if (view === 'athlete' && athlete) {
      const logs = allLogs.filter((r: any) => r.athlete === athlete);

      // Build per-exercise progression
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

      // Session history (most recent sessions)
      const sessionMap: Record<string, any> = {};
      for (const log of logs) {
        const key = `${log.timestamp.split('T')[0]}_${log.session_type}`;
        if (!sessionMap[key]) {
          sessionMap[key] = { date: log.timestamp.split('T')[0], session_type: log.session_type, exercises: [], totalSets: 0, avgRpe: 0, rpeSum: 0, rpeCount: 0 };
        }
        if (!sessionMap[key].exercises.includes(log.exercise)) {
          sessionMap[key].exercises.push(log.exercise);
        }
        sessionMap[key].totalSets++;
        if (log.rpe) { sessionMap[key].rpeSum += log.rpe; sessionMap[key].rpeCount++; }
      }
      const sessionHistory = Object.values(sessionMap).map((s: any) => ({
        ...s,
        avgRpe: s.rpeCount > 0 ? Math.round((s.rpeSum / s.rpeCount) * 10) / 10 : null
      })).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return Response.json({ athlete, athletes, logs, exerciseProgressions, sessionHistory });
    }

    // COACH VIEW — squad summary
    const athleteSummary = athletes.map((ath: string) => {
      const athLogs = allLogs.filter((r: any) => r.athlete === ath);
      const dates = [...new Set(athLogs.map((r: any) => r.timestamp.split('T')[0]))].sort();
      const lastSession = dates[dates.length - 1] || null;
      const totalSessions = [...new Set(athLogs.map((r: any) => `${r.timestamp.split('T')[0]}_${r.session_type}`))].length;
      const avgRpe = athLogs.filter((r: any) => r.rpe).reduce((a: number, b: any) => a + b.rpe, 0) / (athLogs.filter((r: any) => r.rpe).length || 1);
      const highRpeSets = athLogs.filter((r: any) => r.rpe >= 9).length;

      // Session type counts
      const sessionCounts: Record<string, number> = { 'Lower A': 0, 'Lower B': 0, 'Upper A': 0, 'Upper B': 0 };
      for (const log of athLogs) {
        const key = `${log.timestamp.split('T')[0]}_${log.session_type}`;
        sessionCounts[log.session_type] = ([...new Set(athLogs.filter((r: any) => r.session_type === log.session_type).map((r: any) => r.timestamp.split('T')[0]))]).length;
      }

      // Weekly load trend (last 4 weeks)
      const now = new Date();
      const weeklyLoad: { week: string, totalVolume: number }[] = [];
      for (let w = 3; w >= 0; w--) {
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - (w + 1) * 7);
        const weekEnd = new Date(now);
        weekEnd.setDate(now.getDate() - w * 7);
        const weekLogs = athLogs.filter((r: any) => {
          const d = new Date(r.timestamp);
          return d >= weekStart && d < weekEnd;
        });
        const vol = weekLogs.reduce((a: number, b: any) => {
          const load = parseFloat(b.load);
          return a + (isNaN(load) ? 0 : load * (b.reps || 1));
        }, 0);
        weeklyLoad.push({ week: `W${4 - w}`, totalVolume: Math.round(vol) });
      }

      return {
        athlete: ath,
        lastSession,
        totalSessions,
        avgRpe: Math.round(avgRpe * 10) / 10,
        highRpeSets,
        sessionCounts,
        weeklyLoad,
        totalSets: athLogs.length
      };
    });

    // Squad-level RPE trend (last 30 days by day)
    const now = new Date();
    const rpeTrend: { date: string, avgRpe: number }[] = [];
    for (let d = 29; d >= 0; d--) {
      const day = new Date(now);
      day.setDate(now.getDate() - d);
      const dayStr = day.toISOString().split('T')[0];
      const dayLogs = allLogs.filter((r: any) => r.timestamp.startsWith(dayStr) && r.rpe);
      if (dayLogs.length > 0) {
        const avg = dayLogs.reduce((a: number, b: any) => a + b.rpe, 0) / dayLogs.length;
        rpeTrend.push({ date: dayStr, avgRpe: Math.round(avg * 10) / 10 });
      }
    }

    return Response.json({ athletes, athleteSummary, rpeTrend });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
