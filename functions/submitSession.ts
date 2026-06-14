import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const SHEET_ID = "1_6BgfNQzfoxxRwf9oAYkto0FBX8ihUZgDFe3CRE-Xuk";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const HUB_SHEET = "Athlete Hub Responses";

async function appendToSheet(token: string, rows: any[][]) {
  const url = `${SHEETS_API}/${SHEET_ID}/values/${encodeURIComponent(HUB_SHEET)}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows }),
  });
  if (!res.ok) throw new Error(`Sheets append failed (${res.status}): ${await res.text()}`);
  return await res.json();
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

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

    // Dual-write to Athlete Hub Responses sheet via connector
    let sheet_synced = false;
    let sheet_error = null;
    try {
      const { accessToken: sheetsToken } = await base44.asServiceRole.connectors.getConnection('googlesheets');
      const rows = records
        .filter(r => r.athlete && r.session_type && r.exercise)
        .map(r => {
          const ts = r.timestamp || new Date().toISOString();
          return [
            ts,
            ts.split('T')[0],
            r.athlete,
            r.session_type,
            r.exercise,
            r.set_number ?? '',
            r.reps ?? '',
            r.load ?? '',
            r.rpe ?? '',
          ];
        });
      if (rows.length > 0) {
        await appendToSheet(sheetsToken, rows);
        sheet_synced = true;
      }
    } catch (e) {
      sheet_error = e.message;
    }

    return Response.json({
      ok: true,
      created: results.length,
      sheet_synced,
      sheet_error: sheet_error || undefined,
      errors: errors.length > 0 ? errors : undefined,
    }, { status: 200, headers: cors });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500, headers: cors });
  }
});
