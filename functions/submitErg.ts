import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const SHEET_ID = "1_6BgfNQzfoxxRwf9oAYkto0FBX8ihUZgDFe3CRE-Xuk";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const ERG_SHEET = "Erg_Session_Responses";

async function appendToSheet(token: string, row: any[]) {
  const url = `${SHEETS_API}/${SHEET_ID}/values/${encodeURIComponent(ERG_SHEET)}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] }),
  });
  if (!res.ok) throw new Error(`Sheets append to ${ERG_SHEET} failed (${res.status}): ${await res.text()}`);
  return await res.json();
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
    if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: cors });

    const {
      timestamp, athlete, workout_type, total_distance, total_time,
      avg_split, avg_heart_rate, stroke_rate, rpe, intervals, interval_splits, notes, image_url
    } = body;

    if (!athlete || !workout_type) {
      return Response.json({ error: 'Missing required fields: athlete, workout_type' }, { status: 400, headers: cors });
    }

    const now = new Date().toISOString();
    const sessionTimestamp = timestamp || now;

    // 1. Save to Base44 database
    const created = await base44.asServiceRole.entities.ErgSession.create({
      timestamp: sessionTimestamp,
      athlete: String(athlete),
      workout_type: String(workout_type),
      total_distance: total_distance ? Number(total_distance) : null,
      total_time: total_time ? String(total_time) : null,
      avg_split: avg_split ? String(avg_split) : null,
      avg_heart_rate: avg_heart_rate ? Number(avg_heart_rate) : null,
      stroke_rate: stroke_rate ? Number(stroke_rate) : null,
      rpe: rpe ? Number(rpe) : null,
      intervals: intervals ? String(intervals) : null,
      interval_splits: interval_splits ? String(interval_splits) : null,
      notes: notes ? String(notes) : null,
      image_url: image_url ? String(image_url) : null,
    });

    // 2. Mirror to Erg_Session_Responses only
    let sheetOk = false;
    let sheetError: string | null = null;
    try {
      const { accessToken: sheetsToken } = await base44.asServiceRole.connectors.getConnection('googlesheets');
      const ergRow = [
        sessionTimestamp,
        String(athlete),
        String(workout_type),
        total_distance ?? '',
        total_time ?? '',
        avg_split ?? '',
        avg_heart_rate ?? '',
        stroke_rate ?? '',
        rpe ?? '',
        intervals ?? '',
        notes ?? '',
        image_url ?? '',
        now,
      ];
      await appendToSheet(sheetsToken, ergRow);
      sheetOk = true;
    } catch (e: any) {
      sheetError = e.message;
    }

    return Response.json({
      ok: true,
      created,
      sheet_synced: sheetOk,
      ...(sheetError ? { sheet_error: sheetError } : {}),
    }, { status: 200, headers: cors });

  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500, headers: cors });
  }
});
