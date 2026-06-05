import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

    const { athlete, date, session_type } = body;

    // Fetch all session logs
    const allLogs = await base44.asServiceRole.entities.SessionLog.list();

    // Build session index: for each athlete, list distinct sessions (date + session_type)
    const sessions: Record<string, { date: string, session_type: string, athlete: string }[]> = {};

    for (const log of allLogs) {
      const date = log.timestamp?.split('T')[0];
      if (!date) continue;
      const key = log.athlete;
      if (!sessions[key]) sessions[key] = [];
      // Check if this date+session_type already in list
      const exists = sessions[key].find(s => s.date === date && s.session_type === log.session_type);
      if (!exists) {
        sessions[key].push({ date, session_type: log.session_type, athlete: log.athlete });
      }
    }

    // Sort each athlete's sessions by date desc
    for (const ath of Object.keys(sessions)) {
      sessions[ath].sort((a, b) => b.date.localeCompare(a.date));
    }

    // If specific session requested, return its sets
    let sessionDetail = null;
    if (athlete && date && session_type) {
      const sets = allLogs
        .filter(l => l.athlete === athlete && l.timestamp?.startsWith(date) && l.session_type === session_type)
        .sort((a, b) => (a.set_number || 0) - (b.set_number || 0));

      // Group by exercise
      const byExercise: Record<string, any[]> = {};
      for (const s of sets) {
        if (!byExercise[s.exercise]) byExercise[s.exercise] = [];
        byExercise[s.exercise].push({
          set: s.set_number,
          reps: s.reps,
          load: s.load,
          rpe: s.rpe,
        });
      }

      const totalSets = sets.length;
      const avgRpe = sets.filter(s => s.rpe).length
        ? parseFloat((sets.reduce((a, s) => a + (s.rpe || 0), 0) / sets.filter(s => s.rpe).length).toFixed(1))
        : null;
      const totalLoad = sets.reduce((a, s) => {
        const l = parseFloat(s.load);
        return a + (isNaN(l) ? 0 : l * (s.reps || 1));
      }, 0);

      sessionDetail = {
        athlete,
        date,
        session_type,
        exercises: Object.entries(byExercise).map(([name, sets]) => ({ name, sets })),
        total_sets: totalSets,
        avg_rpe: avgRpe,
        total_load: Math.round(totalLoad),
        raw_sets: sets,
      };
    }

    return Response.json({
      ok: true,
      session_index: sessions,
      session_detail: sessionDetail,
    }, { status: 200, headers: cors });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500, headers: cors });
  }
});
