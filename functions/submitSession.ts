import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const DEFAULT_ATHLETE = 'Jack';
const DEFAULT_SESSION_TYPE = 'S&C';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => null);
    if (!body) return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: cors });

    const records = Array.isArray(body) ? body : [body];

    const results = [];
    const errors = [];

    for (const record of records) {
      const { timestamp, athlete, session_type, exercise, set_number, reps, load, rpe } = record;

      if (!exercise) {
        errors.push({ record, error: 'Missing required field: exercise' });
        continue;
      }

      try {
        const created = await base44.asServiceRole.entities.SessionLog.create({
          timestamp: timestamp || new Date().toISOString(),
          athlete: String(athlete || DEFAULT_ATHLETE),
          session_type: String(session_type || DEFAULT_SESSION_TYPE),
          exercise: String(exercise),
          set_number: set_number !== undefined ? Number(set_number) : null,
          reps: reps !== undefined ? Number(reps) : null,
          load: load !== undefined ? String(load) : null,
          rpe: rpe !== undefined ? Number(rpe) : null,
        });
        results.push(created);
      } catch (e) {
        errors.push({ record, error: e.message });
      }
    }

    return Response.json({
      ok: true,
      created: results.length,
      errors: errors.length > 0 ? errors : undefined,
    }, { status: 200, headers: cors });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500, headers: cors });
  }
});
