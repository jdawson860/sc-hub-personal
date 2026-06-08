import { createClient } from "@base44/sdk";

const SHEET_ID = "1_6BgfNQzfoxxRwf9oAYkto0FBX8ihUZgDFe3CRE-Xuk";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const token = process.env.GOOGLESHEETS_ACCESS_TOKEN;

async function getSheetRows(sheetName, maxRows = 500) {
  const url = `${SHEETS_API}/${SHEET_ID}/values/${encodeURIComponent(sheetName)}!A1:J${maxRows}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`Sheet fetch failed: ${resp.status}`);
  const data = await resp.json();
  return data.values || [];
}

async function main() {
  const client = createClient({
    appId: process.env.VITE_BASE44_APP_ID,
    authToken: process.env.BASE44_SERVICE_TOKEN,
  });

  const athletes = ['AF', 'RR', 'JC', 'MA', 'TL', 'CC', 'SK', 'AS'];
  let totalRecords = 0;

  console.log("🔄 Syncing latest sheet data...\n");

  for (const ath of athletes) {
    try {
      const rows = await getSheetRows(`Athlete_${ath}`, 500);
      if (rows.length < 2) continue;

      const records = [];
      for (const row of rows.slice(1)) {
        if (!row[0] || !row[1] || !row[2]) continue;
        records.push({
          timestamp: row[0],
          athlete: ath,
          session_type: row[2],
          exercise: row[3] || "",
          set_number: row[4] || "1",
          reps: row[5] ? parseFloat(row[5]) : 0,
          load: row[6] || "0",
          rpe: row[7] ? parseFloat(row[7]) : 0,
        });
      }

      if (records.length > 0) {
        await client.entities.SessionLog.create(records);
        console.log(`✓ ${ath}: ${records.length} records`);
        totalRecords += records.length;
      }
    } catch (e) {
      console.error(`✗ ${ath}: ${e.message}`);
    }
  }

  // Testing data
  try {
    const testRows = await getSheetRows("Core_Testing_Responses", 500);
    if (testRows.length > 1) {
      const testRecords = [];
      for (const row of testRows.slice(1)) {
        if (!row[0] || !row[1]) continue;
        testRecords.push({
          timestamp: row[0],
          athlete_first: row[1],
          athlete_last: row[2] || "",
          athlete_name: `${row[1]} ${row[2] || ""}`.trim(),
          year_level: row[3] || "",
          height: row[4] || "",
          weight: row[5] || "",
          hollow_hold: row[6] || "",
          prone_plank: row[7] || "",
          side_plank_left: row[8] || "",
          side_plank_right: row[9] || "",
        });
      }
      if (testRecords.length > 0) {
        await client.entities.TestingResult.create(testRecords);
        console.log(`✓ Testing: ${testRecords.length} records`);
      }
    }
  } catch (e) {
    console.log(`Testing sync skipped: ${e.message}`);
  }

  console.log(`\n✅ Sync complete: ${totalRecords} session + testing records`);
}

main().catch(e => {
  console.error("Error:", e.message);
  process.exit(1);
});
