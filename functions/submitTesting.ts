// Submit a core testing result — writes to dashboard DB AND Google Sheet
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const SHEET_ID = '1_6BgfNQzfoxxRwf9oAYkto0FBX8ihUZgDFe3CRE-Xuk';
const SHEET_NAME_DASHBOARD = 'Core Testing Dashboard Responses';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

async function appendToSheet(token: string, row: any[], sheetName: string) {
  const url = `${SHEETS_API}/${SHEET_ID}/values/${encodeURIComponent(sheetName)}!A:K:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [row] }),
  });
  if (!res.ok) throw new Error(`Sheets append failed (${res.status}): ${await res.text()}`);
  return res.json();
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
    const body = await req.json().catch(() => null);

    const firstName = (body?.athlete_first || '').trim();
    const lastName  = (body?.athlete_last  || '').trim();
    const athleteName = [firstName, lastName].filter(Boolean).join(' ');

    if (!firstName) {
      return Response.json({ ok: false, error: 'athlete_first is required' }, { status: 400, headers: cors });
    }

    // Use the testing_date sent from the frontend (YYYY-MM-DD), fall back to now
    const testingDateRaw: string = body?.testing_date || '';
    const timestamp = testingDateRaw
      ? new Date(testingDateRaw + 'T00:00:00+10:00').toISOString()
      : new Date().toISOString();
    // Human-readable date for the sheet (DD/MM/YYYY)
    const displayDate = testingDateRaw
      ? testingDateRaw.split('-').reverse().join('/')
      : new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' });

    const record = {
      timestamp:        timestamp,
      athlete_name:     athleteName,
      athlete_first:    firstName,
      athlete_last:     lastName,
      year_level:       body.year_level ? String(body.year_level) : null,
      height:           body.height      ? parseFloat(body.height)           : null,
      weight:           body.weight      ? parseFloat(body.weight)           : null,
      hollow_hold:      body.hollow_hold ? parseFloat(body.hollow_hold)      : null,
      prone_plank:      body.prone_plank ? parseFloat(body.prone_plank)      : null,
      side_plank_left:  body.side_plank_left  ? parseFloat(body.side_plank_left)  : null,
      side_plank_right: body.side_plank_right ? parseFloat(body.side_plank_right) : null,
    };

    // ── 1. Write to dashboard database ───────────────────────────────────
    await base44.asServiceRole.entities.TestingResult.create(record);

    // ── 2. Append to Google Sheet ─────────────────────────────────────────
    // Column order matches Core_Testing_Responses:
    // Timestamp | First Name | Last Name | Year Level | Height | Weight |
    // Hollow Hold | Prone Plank | Side Plank Left | Side Plank Right
    let sheetOk = false;
    let sheetError = null;
    try {
      const { accessToken: sheetsToken } = await base44.asServiceRole.connectors.getConnection('googlesheets');

      const row = [
        timestamp,
        firstName,
        lastName,
        record.year_level       ?? '',
        record.prone_plank      ?? '',
        record.side_plank_left  ?? '',
        record.side_plank_right ?? '',
        record.hollow_hold      ?? '',
        record.height           ?? '',
        record.weight           ?? '',
        displayDate,             // Testing Date (DD/MM/YYYY)
      ];

      await appendToSheet(sheetsToken, row, SHEET_NAME_DASHBOARD);
      sheetOk = true;
    } catch (sheetErr: any) {
      sheetError = sheetErr.message;
      // Don't fail the whole request — DB write already succeeded
      console.error('Sheet append failed:', sheetErr.message);
    }

    return Response.json({
      ok: true,
      created: 1,
      sheet_written: sheetOk,
      sheet_error: sheetError ?? undefined,
    }, { status: 200, headers: cors });

  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500, headers: cors });
  }
});
