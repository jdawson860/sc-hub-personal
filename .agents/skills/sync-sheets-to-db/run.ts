#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Incremental sync: Google Sheets → Database
 * 
 * Strategy:
 * - Fetch all rows from each athlete tab
 * - Build a fingerprint (athlete + date + session_type + exercise + set_number) for each row
 * - Fetch existing DB records and build the same fingerprint set
 * - Only INSERT rows whose fingerprint isn't already in the DB
 * - Same approach for TestingResult (fingerprint = athlete_name + timestamp)
 */

import { createClient } from "https://cdn.jsdelivr.net/npm/@base44/sdk@0.8.31/+esm";

const SHEET_ID = "1_6BgfNQzfoxxRwf9oAYkto0FBX8ihUZgDFe3CRE-Xuk";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

async function getSheetRows(token: string, sheetName: string, maxRows = 1000): Promise<string[][]> {
  const url = `${SHEETS_API}/${SHEET_ID}/values/${encodeURIComponent(sheetName)}!A1:J${maxRows}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    if (resp.status === 400 || resp.status === 404) return []; // tab doesn't exist
    throw new Error(`Sheet fetch failed: ${resp.status} for ${sheetName}`);
  }
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

function sessionKey(r: any): string {
  return `${r.athlete}|${r.timestamp?.split('T')[0]}|${r.session_type}|${r.exercise}|${r.set_number}`;
}

function testingKey(r: any): string {
  return `${r.athlete_name}|${r.timestamp?.split('T')[0]}`;
}

async function getAllPages(entity: any): Promise<any[]> {
  const records: any[] = [];
  let skip = 0;
  const limit = 500;
  while (true) {
    const page = await entity.list({ limit, skip });
    records.push(...page);
    if (page.length < limit) break;
    skip += limit;
  }
  return records;
}

async function runSync(token: string) {
  const base44 = createClient({
    authToken: Deno.env.get("BASE44_SERVICE_TOKEN"),
    appId: Deno.env.get("VITE_BASE44_APP_ID"),
  });

  const athletes = ['AF', 'RR', 'JC', 'MA', 'TL', 'CC', 'SK', 'AS', 'AD', 'OO'];
  const results = { inserted_sessions: 0, inserted_testing: 0, skipped_sessions: 0, skipped_testing: 0, errors: [] as string[] };

  // ── 1. SESSION LOGS ─────────────────────────
  console.log("Fetching sheet data...");
  const sheetRows: any[] = [];

  for (const ath of athletes) {
    try {
      const rows = await getSheetRows(token, `Athlete_${ath}`, 1000);
      if (rows.length < 2) continue;
      for (const row of rows.slice(1)) {
        if (!row[0] || !row[2]) continue;
        const dateStr = sheetsDateToISO(row[0]);
        sheetRows.push({
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
      console.log(`  Sheet Athlete_${ath}: ${rows.length - 1} rows`);
    } catch (e: any) {
      results.errors.push(`Athlete_${ath}: ${e.message}`);
    }
  }

  // Get existing DB fingerprints
  console.log("Fetching existing DB records...");
  const existing = await getAllPages(base44.entities.SessionLog);
  const existingKeys = new Set(existing.map(sessionKey));
  console.log(`  DB has ${existing.length} session records`);

  // Only insert new ones
  const toInsert = sheetRows.filter(r => !existingKeys.has(sessionKey(r)));
  results.skipped_sessions = sheetRows.length - toInsert.length;
  console.log(`  ${toInsert.length} new, ${results.skipped_sessions} already exist`);

  // Insert in batches of 50
  for (let i = 0; i < toInsert.length; i += 50) {
    const batch = toInsert.slice(i, i + 50);
    try {
      for (const rec of batch) {
        await base44.entities.SessionLog.create(rec);
      }
      results.inserted_sessions += batch.length;
      console.log(`  Inserted batch ${Math.floor(i/50)+1}: ${batch.length} records`);
    } catch (e: any) {
      results.errors.push(`Session insert batch ${i}: ${e.message}`);
    }
  }

  // ── 2. TESTING DATA ──────────────────────────
  try {
    const testRows = await getSheetRows(token, 'Core_Testing_Responses', 500);
    const sheetTestRows: any[] = [];

    for (const row of testRows.slice(1)) {
      if (row.length < 6) continue;
      const firstName = (row[1] || '').trim().toUpperCase();
      if (!firstName || firstName === 'TEST' || firstName === 'NOTREAL') continue;
      let ts = row[0];
      try { ts = new Date(row[0]).toISOString(); } catch {}
      sheetTestRows.push({
        timestamp: ts,
        athlete_first: (row[1] || '').trim(),
        athlete_last: (row[2] || '').trim(),
        athlete_name: `${(row[1]||'').trim()} ${(row[2]||'').trim()}`.trim(),
        year_level: row[3] || '',
        height: parseFloat(row[4]) || null,
        weight: parseFloat(row[5]) || null,
        hollow_hold: parseFloat(row[6]) || null,
        prone_plank: parseFloat(row[7]) || null,
        side_plank_left: parseFloat(row[8]) || null,
        side_plank_right: parseFloat(row[9]) || null,
      });
    }

    const existingTests = await getAllPages(base44.entities.TestingResult);
    const existingTestKeys = new Set(existingTests.map(testingKey));
    const newTests = sheetTestRows.filter(r => !existingTestKeys.has(testingKey(r)));
    results.skipped_testing = sheetTestRows.length - newTests.length;

    for (const rec of newTests) {
      await base44.entities.TestingResult.create(rec);
      results.inserted_testing++;
    }
    console.log(`  Testing: ${newTests.length} new, ${results.skipped_testing} already exist`);
  } catch (e: any) {
    results.errors.push(`Testing: ${e.message}`);
  }

  return {
    success: true,
    synced_at: new Date().toISOString(),
    ...results,
  };
}

const token = Deno.env.get("GOOGLESHEETS_ACCESS_TOKEN");
if (!token) {
  console.error("ERROR: GOOGLESHEETS_ACCESS_TOKEN not set");
  Deno.exit(1);
}

const result = await runSync(token);
console.log(JSON.stringify(result, null, 2));
