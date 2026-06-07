import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Updates individual set records in SessionLog
// Payload: { updates: [{ timestamp, athlete, exercise, session_type, reps, load, rpe }] }
// Matches records by athlete + exercise + timestamp (unique per set)

Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  try {
    const base44 = createClientFromRequest(req);
    const { updates } = await req.json();

    if (!Array.isArray(updates) || updates.length === 0) {
      return Response.json({ error: 'updates array required' }, { status: 400, headers: cors });
    }

    // Fetch all logs for this athlete on this date to find IDs
    const athlete = updates[0].athlete;
    const date = updates[0].timestamp?.split('T')[0];

    const allLogs = await base44.asServiceRole.entities.SessionLog.list();
    const relevantLogs = allLogs.filter((l: any) =>
      l.athlete === athlete && l.timestamp?.startsWith(date)
    );

    let updated = 0;
    const errors: string[] = [];

    for (const upd of updates) {
      // Match by athlete + timestamp + exercise
      const match = relevantLogs.find((l: any) =>
        l.athlete === upd.athlete &&
        l.timestamp === upd.timestamp &&
        l.exercise === upd.exercise
      );

      if (!match) {
        errors.push(`No record found for ${upd.exercise} @ ${upd.timestamp}`);
        continue;
      }

      try {
        await base44.asServiceRole.entities.SessionLog.update(match.id, {
          reps: upd.reps,
          load: String(upd.load),
          rpe: parseFloat(upd.rpe),
        });
        updated++;
      } catch (e: any) {
        errors.push(`Failed to update ${upd.exercise}: ${e.message}`);
      }
    }

    return Response.json({ ok: true, updated, errors }, { status: 200, headers: cors });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500, headers: cors });
  }
});
