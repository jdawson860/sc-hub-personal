import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    // Allow CORS for R Shiny / external apps
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
      });
    }

    const base44 = createClientFromRequest(req);

    const body = await req.json().catch(() => null);

    if (!body) {
      return Response.json({ error: 'Invalid JSON body' }, {
        status: 400,
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Accept either a single record or an array (batch submit)
    const records = Array.isArray(body) ? body : [body];

    const results = [];
    const errors = [];

    for (const record of records) {
      const { timestamp, athlete, session_type, exercise, set_number, reps, load, rpe } = record;

      // Validate required fields
      if (!athlete || !session_type || !exercise) {
        errors.push({ record, error: 'Missing required fields: athlete, session_type, exercise' });
        continue;
      }

      try {
        const created = await base44.asServiceRole.entities.SessionLog.create({
          timestamp: timestamp || new Date().toISOString(),
          athlete: String(athlete),
          session_type: String(session_type),
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
      errors: errors.length > 0 ? errors : undefined
    }, {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*' }
    });

  } catch (error) {
    return Response.json({ error: error.message }, {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  }
});
