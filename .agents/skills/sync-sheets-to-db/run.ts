#!/usr/bin/env -S deno run --allow-net --allow-env

import { createClient } from "https://cdn.jsdelivr.net/npm/@base44/sdk@0.8.31/+esm";

const SHEET_ID = "1_6BgfNQzfoxxRwf9oAYkto0FBX8ihUZgDFe3CRE-Xuk";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

async function getSheetRows(token: string, sheetName: string, maxRows = 500): Promise<string[][]> {
  const url = `${SHEETS_API}/${SHEET_ID}/values/${encodeURIComponent(sheetName)}!A1:J${maxRows}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`Sheet fetch failed: ${resp.status}`);
  const data = await resp.json();
  return data.values || [];
}

function sheetsDateToISO(val: string): string {
  const serial = parseFloat(val);
  if (!isNaN(serial) && serial > 40000) {
    const epoch = new Date(1899, 11, 30);
    const date = new Date(epoch.getTime() + serial * 86400000);
    return date.toISOString().split('T')[0];
  }
  try {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  } catch {}
  return val;
}

async function runSync(token: string) {
  const base44 = createClient({
    authToken: Deno.env.get("BASE44_SERVICE_TOKEN"),
    appId: Deno.env.get("VITE_BASE44_APP_ID"),
  });

  const athletes = ['AF', 'RR', 'JC', 'MA', 'TL', 'CC', 'SK', 'AS', 'AD', 'OO'];
  const results = { session_records: 0, testing_records: 0, errors: [] as string[] };

  // ── 1. SYNC SESSION DATA ────────────────────
  const newSessionRecords: any[] = [];

  for (const ath of athletes) {
    try {
      const rows = await getSheetRows(token, `Athlete_${ath}`, 500);
      if (rows.length < 2) continue;
      
      for (const row of rows.slice(1)) {
        if (!row[0] || !row[1] || !row[2]) continue;
        const dateStr = sheetsDateToISO(row[0]);
        newSessionRecords.push({
          timestamp: `${dateStr}T09:00:00`,
          athlete: ath,
          session_type: row[1] || '',
          exercise: row[2] || '',
          set_number: parseInt(row[3]) || 1,
          reps: row[4] || '',
          load: row[5] || '',
          rpe: row[6] ? parseInt(row[6]) : null,
        });
      }
    } catch (e: any) {
      results.errors.push(`Athlete_${ath}: ${e.message}`);
    }
  }

  // Clear and reload
  if (newSessionRecords.length > 0) {
    const existing = await base44.entities.SessionLog.list();
    for (const rec of existing) {
      await base44.entities.SessionLog.delete(rec.id);
    }
    for (const rec of newSessionRecords) {
      await base44.entities.SessionLog.create(rec);
    }
    results.session_records = newSessionRecords.length;
  }

  // ── 2. SYNC TESTING DATA ────────────────────
  const testRows = await getSheetRows(token, 'Core_Testing_Responses', 500);
  const newTestRecords: any[] = [];

  for (const row of testRows.slice(1)) {
    if (row.length < 10) continue;
    const firstName = (row[1] || '').trim().toUpperCase();
    if (!firstName || firstName === 'TEST' || firstName === 'NOTREAL') continue;

    let ts = row[0];
    try { ts = new Date(row[0]).toISOString(); } catch {}

    newTestRecords.push({
      timestamp: ts,
      athlete_first: row[1].trim(),
      athlete_last: row[2].trim(),
      athlete_name: `${row[1].trim()} ${row[2].trim()}`,
      year_level: row[3] || '',
      height: parseFloat(row[4]) || null,
      weight: parseFloat(row[5]) || null,
      hollow_hold: parseFloat(row[6]) || null,
      prone_plank: parseFloat(row[7]) || null,
      side_plank_left: parseFloat(row[8]) || null,
      side_plank_right: parseFloat(row[9]) || null,
    });
  }

  if (newTestRecords.length > 0) {
    const existing = await base44.entities.TestingResult.list();
    for (const rec of existing) {
      await base44.entities.TestingResult.delete(rec.id);
    }
    for (const rec of newTestRecords) {
      await base44.entities.TestingResult.create(rec);
    }
    results.testing_records = newTestRecords.length;
  }

  return {
    success: true,
    synced_at: new Date().toISOString(),
    ...results
  };
}

// Main
const token = Deno.env.get("GOOGLESHEETS_ACCESS_TOKEN");
if (!token) {
  console.error("ERROR: GOOGLESHEETS_ACCESS_TOKEN not set");
  Deno.exit(1);
}

const result = await runSync(token);
console.log(JSON.stringify(result, null, 2));
