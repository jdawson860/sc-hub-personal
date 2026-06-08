const SHEET_ID = "1_6BgfNQzfoxxRwf9oAYkto0FBX8ihUZgDFe3CRE-Xuk";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const token = process.env.GOOGLESHEETS_ACCESS_TOKEN;

if (!token) {
  console.error("ERROR: GOOGLESHEETS_ACCESS_TOKEN not set");
  process.exit(1);
}

async function getSheetRows(sheetName, maxRows = 500) {
  const url = `${SHEETS_API}/${SHEET_ID}/values/${encodeURIComponent(sheetName)}!A1:J${maxRows}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`Sheet fetch failed: ${resp.status}`);
  const data = await resp.json();
  return data.values || [];
}

function sheetsDateToISO(val) {
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

async function runSync() {
  const athletes = ['AF', 'RR', 'JC', 'MA', 'TL', 'CC', 'SK', 'AS', 'AD', 'OO'];
  const results = { session_records: 0, testing_records: 0, errors: [] };

  console.log("Starting sync...");

  // ── 1. SYNC SESSION DATA ────────────────────
  const newSessionRecords = [];

  for (const ath of athletes) {
    try {
      console.log(`Fetching athlete ${ath}...`);
      const rows = await getSheetRows(`Athlete_${ath}`, 500);
      console.log(`  Got ${rows.length} rows from ${ath}`);
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
    } catch (e) {
      const msg = `Athlete_${ath}: ${e.message}`;
      console.error(`Error: ${msg}`);
      results.errors.push(msg);
    }
  }

  console.log(`Collected ${newSessionRecords.length} session records`);

  // ── 2. SYNC TESTING DATA ────────────────────
  try {
    console.log("Fetching Core_Testing_Responses...");
    const testRows = await getSheetRows('Core_Testing_Responses', 500);
    console.log(`  Got ${testRows.length} rows`);
    const newTestRecords = [];

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
        athlete_name: row[1].trim() + ' ' + row[2].trim(),
        year_level: row[3] || '',
        height: parseFloat(row[4]) || null,
        weight: parseFloat(row[5]) || null,
        hollow_hold: parseFloat(row[6]) || null,
        prone_plank: parseFloat(row[7]) || null,
        side_plank_left: parseFloat(row[8]) || null,
        side_plank_right: parseFloat(row[9]) || null,
      });
    }

    console.log(`Collected ${newTestRecords.length} testing records`);
    results.testing_records = newTestRecords.length;
  } catch (e) {
    const msg = `Testing: ${e.message}`;
    console.error(`Error: ${msg}`);
    results.errors.push(msg);
  }

  results.session_records = newSessionRecords.length;

  return {
    success: results.errors.length === 0,
    synced_at: new Date().toISOString(),
    ...results
  };
}

runSync().then(result => {
  console.log("\n=== SYNC RESULT ===");
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}).catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
