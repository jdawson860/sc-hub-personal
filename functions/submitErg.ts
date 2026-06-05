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
    const body = await req.json().catch(() => null);
    if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: cors });

    const {
      timestamp, athlete, workout_type, total_distance, total_time,
      avg_split, avg_heart_rate, stroke_rate, rpe, intervals, notes, image_url
    } = body;

    if (!athlete || !workout_type) {
      return Response.json({ error: 'Missing required fields: athlete, workout_type' }, { status: 400, headers: cors });
    }

    const created = await base44.asServiceRole.entities.ErgSession.create({
      timestamp: timestamp || new Date().toISOString(),
      athlete: String(athlete),
      workout_type: String(workout_type),
      total_distance: total_distance ? Number(total_distance) : null,
      total_time: total_time ? String(total_time) : null,
      avg_split: avg_split ? String(avg_split) : null,
      avg_heart_rate: avg_heart_rate ? Number(avg_heart_rate) : null,
      stroke_rate: stroke_rate ? Number(stroke_rate) : null,
      rpe: rpe ? Number(rpe) : null,
      intervals: intervals ? String(intervals) : null,
      notes: notes ? String(notes) : null,
      image_url: image_url ? String(image_url) : null,
    });

    return Response.json({ ok: true, created }, { status: 200, headers: cors });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500, headers: cors });
  }
});
