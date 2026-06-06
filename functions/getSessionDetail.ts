import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ─── CANONICAL EXERCISE ORDER ────────────────────────────────────────────────
// Defines the intended order of exercises per session type.
// Add/update as new sessions are programmed.
// Exercises NOT in the list will appear at the end, in DB order.
const SESSION_EXERCISE_ORDER: Record<string, string[]> = {
  'Lower A': [
    'TRAP BAR DEADLIFT',
    'LEG PRESS',
    'NORDIC CURL',
    'CALF RAISE',
    'GHD SIT UP',
    'HOLLOW HOLD',
    'PRONE PLANK',
  ],
  'Lower B': [
    'BELT SQUAT',
    'SINGLE LEG HIP THRUST',
    'LEG EXTENSION (DOUBLE + SINGLE)',
    'BB RDL',
    'CALF RAISE',
    'GHD SIT UP',
    'HOLLOW HOLD',
  ],
  'Upper A': [
    'BENCH PRESS',
    'CHIN UP',
    'DB SHOULDER PRESS',
    'SEATED ROW',
    'DB LATERAL RAISE',
    'FACE PULL',
    'TRICEPS OF YOUR CHOICE',
  ],
  'Upper B': [
    'BENCH PULL',
    'BB SHOULDER PRESS',
    'DB LATERAL RAISE',
    'BICEPS OF YOUR CHOICE',
    'FACE PULL',
    'TRICEPS OF YOUR CHOICE',
  ],
};

function sortExercisesByCanonicalOrder(exercises: string[], sessionType: string): string[] {
  const canonical = SESSION_EXERCISE_ORDER[sessionType] || [];
  return [...exercises].sort((a, b) => {
    const ia = canonical.findIndex(e => e.toUpperCase() === a.toUpperCase());
    const ib = canonical.findIndex(e => e.toUpperCase() === b.toUpperCase());
    // Known exercises sorted by canonical order; unknowns pushed to end in original order
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
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
    const body = await req.json().catch(() => ({}));

    const { athlete, date, session_type } = body;

    const allLogs = await base44.asServiceRole.entities.SessionLog.list();

    // Build session index: for each athlete, list distinct sessions (date + session_type)
    const sessions: Record<string, { date: string, session_type: string, athlete: string }[]> = {};

    for (const log of allLogs) {
      const logDate = log.timestamp?.split('T')[0];
      if (!logDate) continue;
      const key = log.athlete;
      if (!sessions[key]) sessions[key] = [];
      const exists = sessions[key].find(s => s.date === logDate && s.session_type === log.session_type);
      if (!exists) {
        sessions[key].push({ date: logDate, session_type: log.session_type, athlete: log.athlete });
      }
    }

    // Sort each athlete's sessions by date desc
    for (const ath of Object.keys(sessions)) {
      sessions[ath].sort((a, b) => b.date.localeCompare(a.date));
    }

    // If specific session requested, return its sets
    let sessionDetail = null;
    if (athlete && date && session_type) {
      // Get all rows for this session
      const sets = allLogs
        .filter(l => l.athlete === athlete && l.timestamp?.startsWith(date) && l.session_type === session_type);

      // Group by exercise, preserving DB insertion order first
      const exerciseFirstSeen: Record<string, number> = {};
      const byExercise: Record<string, any[]> = {};

      sets.forEach((s, idx) => {
        const ex = s.exercise;
        if (!ex) return;
        if (!(ex in byExercise)) {
          byExercise[ex] = [];
          exerciseFirstSeen[ex] = idx; // track insertion order
        }
        byExercise[ex].push({
          set: s.set_number,
          reps: s.reps,
          load: s.load,
          rpe: s.rpe,
          timestamp: s.timestamp,
        });
      });

      // Sort exercises: canonical order first, then DB insertion order for unknowns
      const rawExerciseOrder = Object.keys(byExercise).sort((a, b) => exerciseFirstSeen[a] - exerciseFirstSeen[b]);
      const sortedExercises = sortExercisesByCanonicalOrder(rawExerciseOrder, session_type);

      // Sort each exercise's sets by set_number, then timestamp
      for (const ex of sortedExercises) {
        byExercise[ex].sort((a: any, b: any) =>
          (a.set || 0) - (b.set || 0) || new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
      }

      const totalSets = sets.length;
      const withRpe = sets.filter(s => s.rpe);
      const avgRpe = withRpe.length
        ? parseFloat((withRpe.reduce((a, s) => a + (s.rpe || 0), 0) / withRpe.length).toFixed(1))
        : null;
      const totalLoad = sets.reduce((a, s) => {
        const l = parseFloat(s.load);
        return a + (isNaN(l) ? 0 : l * (s.reps || 1));
      }, 0);

      sessionDetail = {
        athlete,
        date,
        session_type,
        exercises: sortedExercises.map(name => ({ name, sets: byExercise[name] })),
        total_sets: totalSets,
        avg_rpe: avgRpe,
        total_load: Math.round(totalLoad),
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
