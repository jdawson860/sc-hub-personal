// Stores a base64 erg screen image as a data URL in the ErgSession record
// Since Base44 SDK has no direct storage upload, we store the data URL string in image_url
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
    if (!body?.image_base64) {
      return Response.json({ ok: false, error: 'Missing image_base64' }, { status: 400, headers: cors });
    }

    const { image_base64, session_id, mime_type = 'image/jpeg' } = body;

    // Build a data URL — this is the image_url we store
    const image_url = `data:${mime_type};base64,${image_base64}`;

    // If a real (non-pending) session_id was provided, update the ErgSession record
    if (session_id && !String(session_id).startsWith('pending_')) {
      await base44.asServiceRole.entities.ErgSession.update(session_id, { image_url });
    }

    return Response.json({ ok: true, image_url }, { headers: cors });
  } catch (e: any) {
    return Response.json({ ok: false, error: e.message }, { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
  }
});
