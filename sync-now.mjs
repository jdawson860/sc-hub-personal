import { createClient } from "@base44/sdk";

const SHEET_ID = "1_6BgfNQzfoxxRwf9oAYkto0FBX8ihUZgDFe3CRE-Xuk";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const token = process.env.GOOGLESHEETS_ACCESS_TOKEN;

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

// Uppercase abbreviations commonly used in S&C exercise naming
const ABBREV = new Set(['BB','DB','SB','KB','RDL','GHD','ISO','RFESS','TRX','RM']);

// Title-case that preserves known abbreviations (BB, DB, GHD, etc.)
function toTitleCase(str) {
  if (!str) return str;
  return str.trim().split(/\s+/).map(word => {
    const upper = word.toUpperCase();
    if (ABBREV.has(upper)) return upper;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

function parseDate(val) {
  val = val.trim();
  // Try "M/D/YYYY HH:MM:SS" or "M/D/YYYY"
  const parts = val.split(' ');
  const datePart = parts[0]; // e.g. "6/10/2026"
  const [m, d, y] = datePart.split('/');
  if (!m || !d || !y) return null;
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T09:00:00`;
}

async function getSheetRows(sheetName, maxRows = 2000) {
  const url = `${SHEETS_API}/${SHEET_ID}/values/${encodeURIComponent(sheetName)}!A1:I${maxRows}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`Sheet fetch failed: ${resp.status}`);
  const data = await resp.json();
  return data.values || [];
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main() {
  const client = createClient({
    appId: process.env.VITE_BASE44_APP_ID,
    authToken: process.env.BASE44_SERVICE_TOKEN,
  });

  console.log("🔄 Syncing from Session_Data_Responses...\n");

  // ── SESSION DATA ──────────────────────────────
  // Columns: A=Timestamp, B=Date(empty), C=Athlete, D=SessionType, E=Exercise,
  //          F=Sets(always 1 - each row IS a set), G=Reps, H=Load, I=RPE

  const rows = await getSheetRows("Session_Data_Responses", 2000);
  const dataRows = rows.slice(1).filter(r => r && r[0] && r[2] && r[3] && r[4]);

  // Infer set numbers by grouping on (athlete, date, sessionType, exercise)
  // within the order rows appear in the sheet
  const groups = new Map();
  const records = [];

  for (const row of dataRows) {
    const timestamp = parseDate(row[0]);
    if (!timestamp) continue;

    const athlete     = (row[2] || '').trim().toUpperCase();
    const sessionType = (row[3] || '').trim();
    const exercise    = toTitleCase(row[4]);
    const reps        = row[6] ? parseFloat(row[6]) : 0;
    const load        = (row[7] || '0').trim();
    const rpe         = row[8] ? parseFloat(row[8]) : 0;

    const dateKey = timestamp.slice(0, 10);
    const key = `${athlete}|${dateKey}|${sessionType}|${exercise}`;
    const setNum = (groups.get(key) || 0) + 1;
    groups.set(key, setNum);

    records.push({ timestamp, athlete, session_type: sessionType, exercise, set_number: setNum, reps, load, rpe });
  }

  // Get existing fingerprints from DB to avoid re-inserting duplicates
  console.log(`📋 Sheet has ${records.length} rows. Checking DB for existing records...`);

  let existingCount = 0;
  let page = 0;
  const existing = new Set();

  while (true) {
    const result = await client.entities.SessionLog.filter({}, { limit: 500, offset: page * 500 });
    const batch = Array.isArray(result) ? result : (result.records || result.data || []);
    if (!batch.length) break;
    for (const r of batch) {
      const fp = `${r.athlete}|${r.timestamp?.slice(0,10)}|${r.session_type}|${r.exercise}|${r.set_number}`;
      existing.add(fp);
    }
    existingCount += batch.length;
    if (batch.length < 500) break;
    page++;
  }

  console.log(`📦 DB has ${existingCount} existing session records.`);

  const newRecords = records.filter(r => {
    const fp = `${r.athlete}|${r.timestamp.slice(0,10)}|${r.session_type}|${r.exercise}|${r.set_number}`;
    return !existing.has(fp);
  });

  console.log(`✨ ${newRecords.length} new records to insert.`);

  if (newRecords.length > 0) {
    // Insert in batches of 100
    const batchSize = 100;
    for (let i = 0; i < newRecords.length; i += batchSize) {
      const batch = newRecords.slice(i, i + batchSize);
      await client.entities.SessionLog.create(batch);
      console.log(`  ✓ Inserted batch ${Math.floor(i/batchSize)+1}: ${batch.length} records`);
    }
  }

  // ── TESTING DATA ─────────────────────────────
  try {
    const testRows = await getSheetRows("Core_Testing_Responses", 500);
    if (testRows.length > 1) {
      const testRecords = [];
      for (const row of testRows.slice(1)) {
        if (!row[0] || !row[1]) continue;
        testRecords.push({
          timestamp:     row[0],
          athlete_first: row[1],
          athlete_last:  row[2] || "",
          athlete_name:  `${row[1]} ${row[2] || ""}`.trim(),
          year_level:    row[3] || "",
          height:        row[4] || "",
          weight:        row[5] || "",
          hollow_hold:   row[6] || "",
          prone_plank:   row[7] || "",
          side_plank_left:  row[8] || "",
          side_plank_right: row[9] || "",
        });
      }
      if (testRecords.length > 0) {
        await client.entities.TestingResult.create(testRecords);
        console.log(`✓ Testing: ${testRecords.length} records synced`);
      }
    }
  } catch (e) {
    console.log(`Testing sync skipped: ${e.message}`);
  }

  console.log(`\n✅ Sync complete.`);
}

main().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
