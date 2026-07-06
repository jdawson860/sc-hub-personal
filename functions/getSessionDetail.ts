// getSessionDetail v4 — single-user, reads directly from SessionLog entity
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const DEFAULT_ATHLETE = 'Jack';

Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const athlete = body.athlete || DEFAULT_ATHLETE;
    const date = body.date;

    const allLogs = await base44.asServiceRole.entities.SessionLog.list();
    const athleteLogs = allLogs.filter((l: any) => (l.athlete || DEFAULT_ATHLETE) === athlete);

    // Session index: unique dates for this athlete
    const seenDates = new Set<string>();
    const sessions: any[] = [];
    for (const l of athleteLogs) {
      const d = l.timestamp?.split('T')[0];
      if (!d || seenDates.has(d)) continue;
      seenDates.add(d);
      sessions.push({ date: d });
    }
    sessions.sort((a, b) => b.date.localeCompare(a.date));

    let sessionDetail = null;
    if (date) {
      const sets = athleteLogs.filter((l: any) => l.timestamp?.startsWith(date));

      const byExercise: Record<string, any[]> = {};
      const exerciseOrder: string[] = [];
      for (const s of sets) {
        if (!s.exercise) continue;
        if (!byExercise[s.exercise]) { byExercise[s.exercise] = []; exerciseOrder.push(s.exercise); }
        byExercise[s.exercise].push({
          id: s.id,
          set: s.set_number,
          reps: s.reps,
          load: s.load,
          rpe: s.rpe,
          timestamp: s.timestamp,
        });
      }
      for (const ex of exerciseOrder) {
        byExercise[ex].sort((a: any, b: any) => (a.set || 0) - (b.set || 0));
      }

      const withRpe = sets.filter((s: any) => s.rpe);
      const avgRpe = withRpe.length
        ? parseFloat((withRpe.reduce((a: number, s: any) => a + (s.rpe || 0), 0) / withRpe.length).toFixed(1))
        : null;
      const totalLoad = sets.reduce((a: number, s: any) => {
        const l = parseFloat(s.load);
        return a + (isNaN(l) ? 0 : l * (parseFloat(s.reps) || 1));
      }, 0);

      sessionDetail = {
        athlete, date,
        exercises: exerciseOrder.map(name => ({ name, sets: byExercise[name] })),
        total_sets: sets.length,
        avg_rpe: avgRpe,
        total_load: Math.round(totalLoad),
      };
    }

    return Response.json({ ok: true, session_index: sessions, session_detail: sessionDetail }, { status: 200, headers: cors });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500, headers: cors });
  }
});
