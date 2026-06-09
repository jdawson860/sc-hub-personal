import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const SHEET_ID = "1_6BgfNQzfoxxRwf9oAYkto0FBX8ihUZgDFe3CRE-Xuk";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

async function getSheetRows(token: string, sheetName: string, maxRows = 1000): Promise<string[][]> {
  const url = `${SHEETS_API}/${SHEET_ID}/values/${encodeURIComponent(sheetName)}!A1:J${maxRows}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    if (resp.status === 400 || resp.status === 404) return [];
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;

    const body = await req.json().catch(() => ({}));
    const token = body.sheets_token || Deno.env.get("GOOGLESHEETS_ACCESS_TOKEN");

    if (!token) {
      return Response.json({
        error: "No Google Sheets token available",
        note: "Pass sheets_token in request body or set GOOGLESHEETS_ACCESS_TOKEN env var"
      }, { status: 400 });
    }

    const athletes = ['AF', 'RR', 'JC', 'MA', 'TL', 'CC', 'SK', 'AS', 'AD', 'OO'];
    const results = { inserted_sessions: 0, inserted_testing: 0, skipped_sessions: 0, skipped_testing: 0, errors: [] as string[] };

    // ── 1. SESSION LOGS — incremental insert only ────────────────────────────
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
      } catch (e: any) {
        results.errors.push(`Athlete_${ath}: ${e.message}`);
      }
    }

    // Also check Session_Data_Responses tab (direct form submissions)
    try {
      const respRows = await getSheetRows(token, 'Session_Data_Responses', 2000);
      if (respRows.length > 1) {
        // Headers: Timestamp, Date, Athlete, SessionType, Exercise, Sets, Reps, Load, RPE
        for (const row of respRows.slice(1)) {
          if (!row[0] || !row[2]) continue;
          const dateStr = sheetsDateToISO(row[1] || row[0]);
          sheetRows.push({
            timestamp: `${dateStr}T09:00:00`,
            athlete: row[2] || '',
            session_type: row[3] || '',
            exercise: row[4] || '',
            set_number: parseInt(row[5]) || 1,
            reps: row[6] || '',
            load: row[7] || '',
            rpe: row[8] ? parseInt(row[8]) : null,
          });
        }
      }
    } catch (e: any) {
      results.errors.push(`Session_Data_Responses: ${e.message}`);
    }

    // Get existing DB fingerprints and only insert new rows
    if (sheetRows.length > 0) {
      const existing = await getAllPages(db.SessionLog);
      const existingKeys = new Set(existing.map(sessionKey));
      const toInsert = sheetRows.filter(r => !existingKeys.has(sessionKey(r)));
      results.skipped_sessions = sheetRows.length - toInsert.length;

      for (const rec of toInsert) {
        try {
          await db.SessionLog.create(rec);
          results.inserted_sessions++;
        } catch (e: any) {
          results.errors.push(`Session insert: ${e.message}`);
        }
      }
    }

    // ── 2. TESTING DATA — incremental insert only ────────────────────────────
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

      const existingTests = await getAllPages(db.TestingResult);
      const existingTestKeys = new Set(existingTests.map(testingKey));
      const newTests = sheetTestRows.filter(r => !existingTestKeys.has(testingKey(r)));
      results.skipped_testing = sheetTestRows.length - newTests.length;

      for (const rec of newTests) {
        await db.TestingResult.create(rec);
        results.inserted_testing++;
      }
    } catch (e: any) {
      results.errors.push(`Testing: ${e.message}`);
    }

    return Response.json({
      success: true,
      synced_at: new Date().toISOString(),
      ...results
    });

  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
