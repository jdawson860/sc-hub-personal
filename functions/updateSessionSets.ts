// updateSessionSets v2 — id-based edit/delete/create for individual SessionLog set records
// Payload: { updates: [{id, reps, load, rpe}], deletes: ["id1", ...], creates: [{timestamp, athlete, session_type, exercise, set_number, reps, load, rpe}] }
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
    const updates = Array.isArray(body.updates) ? body.updates : [];
    const deletes = Array.isArray(body.deletes) ? body.deletes : [];
    const creates = Array.isArray(body.creates) ? body.creates : [];

    let updated = 0, deleted = 0, created = 0;
    const errors: string[] = [];

    for (const upd of updates) {
      if (!upd.id) { errors.push('Update missing id'); continue; }
      try {
        await base44.asServiceRole.entities.SessionLog.update(upd.id, {
          reps: upd.reps !== undefined && upd.reps !== null && upd.reps !== '' ? Number(upd.reps) : null,
          load: upd.load !== undefined && upd.load !== null && upd.load !== '' ? String(upd.load) : null,
          rpe: upd.rpe !== undefined && upd.rpe !== null && upd.rpe !== '' ? Number(upd.rpe) : null,
        });
        updated++;
      } catch (e: any) {
        errors.push(`Failed to update ${upd.id}: ${e.message}`);
      }
    }

    for (const id of deletes) {
      try {
        await base44.asServiceRole.entities.SessionLog.delete(id);
        deleted++;
      } catch (e: any) {
        errors.push(`Failed to delete ${id}: ${e.message}`);
      }
    }

    for (const rec of creates) {
      if (!rec.exercise) { errors.push('Create missing exercise'); continue; }
      try {
        await base44.asServiceRole.entities.SessionLog.create({
          timestamp: rec.timestamp || new Date().toISOString(),
          athlete: String(rec.athlete || DEFAULT_ATHLETE),
          session_type: String(rec.session_type || 'OTHER'),
          exercise: String(rec.exercise),
          set_number: rec.set_number !== undefined ? Number(rec.set_number) : null,
          reps: rec.reps !== undefined && rec.reps !== null && rec.reps !== '' ? Number(rec.reps) : null,
          load: rec.load !== undefined && rec.load !== null && rec.load !== '' ? String(rec.load) : null,
          rpe: rec.rpe !== undefined && rec.rpe !== null && rec.rpe !== '' ? Number(rec.rpe) : null,
        });
        created++;
      } catch (e: any) {
        errors.push(`Failed to create ${rec.exercise}: ${e.message}`);
      }
    }

    return Response.json({ ok: true, updated, deleted, created, errors: errors.length ? errors : undefined }, { status: 200, headers: cors });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500, headers: cors });
  }
});
