// getSessionDetail v2 - uses direct REST API (no SDK asServiceRole)

const APP_ID = "6a2139cf1719e3fb84188511";
const BASE = `https://app.base44.com/api/apps/${APP_ID}/entities`;

async function fetchEntity(entity: string, token: string): Promise<any[]> {
  const res = await fetch(`${BASE}/${entity}`, { headers: { 'api_key': token } });
  if (!res.ok) throw new Error(`${entity} fetch failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

const SESSION_EXERCISE_ORDER: Record<string, string[]> = {
  'Lower A': ['BB High Pull','Hurdle Jump & Stick Landing','BB Back Squat (Heels Elevated)','Ankle Mobility Dorsiflexion','Front Foot Elevated Split Squat','GHD Anti-Lateral Flexion Hold','Eccentric Hamstring Sliders','Single Leg Calf Raise on Step'],
  'Lower B': ['BB RDL','SB Roll Out + Plank Hold','Leg Press','Hanging Straight Leg Raise','Leg Extension','Landmine Rotation','Single Leg Hip Thrust','Single Leg Calf Raise on Step'],
  'Upper A': ['Chin Ups','Bench Press','Single Arm DB Row','Incline DB Bench Press','Reverse DB Flys (Chest Supported)','Plate Weighted Sit Ups','Swiss Ball Deadbug'],
  'Upper B': ['Bench Pull','Half Kneeling Wall Thoracic Rotation','BB Shoulder Press','Half Kneeling Banded Cuban Press','DB Lateral Raise','Biceps of Your Choice','Pallof Press ISO Hold'],
};

function sortExercisesByCanonicalOrder(exercises: string[], sessionType: string): string[] {
  const canonical = SESSION_EXERCISE_ORDER[sessionType] || [];
  return [...exercises].sort((a, b) => {
    const ia = canonical.findIndex(e => e.toUpperCase() === a.toUpperCase());
    const ib = canonical.findIndex(e => e.toUpperCase() === b.toUpperCase());
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
    const token = Deno.env.get("BASE44_SERVICE_TOKEN") || "";
    const body = await req.json().catch(() => ({}));
    const { athlete, date, session_type } = body;

    const allLogs = await fetchEntity('SessionLog', token);

    const sessions: Record<string, { date: string, session_type: string, athlete: string }[]> = {};
    for (const log of allLogs) {
      const logDate = log.timestamp?.split('T')[0];
      if (!logDate) continue;
      if (!sessions[log.athlete]) sessions[log.athlete] = [];
      const exists = sessions[log.athlete].find(s => s.date === logDate && s.session_type === log.session_type);
      if (!exists) sessions[log.athlete].push({ date: logDate, session_type: log.session_type, athlete: log.athlete });
    }
    for (const ath of Object.keys(sessions)) {
      sessions[ath].sort((a, b) => b.date.localeCompare(a.date));
    }

    let sessionDetail = null;
    if (athlete && date && session_type) {
      const sets = allLogs.filter(l => l.athlete === athlete && l.timestamp?.startsWith(date) && l.session_type === session_type);
      const exerciseFirstSeen: Record<string, number> = {};
      const byExercise: Record<string, any[]> = {};

      sets.forEach((s, idx) => {
        const ex = s.exercise;
        if (!ex) return;
        if (!(ex in byExercise)) { byExercise[ex] = []; exerciseFirstSeen[ex] = idx; }
        byExercise[ex].push({ set: s.set_number, reps: s.reps, load: s.load, rpe: s.rpe, timestamp: s.timestamp });
      });

      const rawOrder = Object.keys(byExercise).sort((a, b) => exerciseFirstSeen[a] - exerciseFirstSeen[b]);
      const sortedExercises = sortExercisesByCanonicalOrder(rawOrder, session_type);
      for (const ex of sortedExercises) {
        byExercise[ex].sort((a: any, b: any) => (a.set || 0) - (b.set || 0) || new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      }

      const withRpe = sets.filter(s => s.rpe);
      const avgRpe = withRpe.length ? parseFloat((withRpe.reduce((a, s) => a + (s.rpe || 0), 0) / withRpe.length).toFixed(1)) : null;
      const totalLoad = sets.reduce((a, s) => { const l = parseFloat(s.load); return a + (isNaN(l) ? 0 : l * (s.reps || 1)); }, 0);

      sessionDetail = {
        athlete, date, session_type,
        exercises: sortedExercises.map(name => ({ name, sets: byExercise[name] })),
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
