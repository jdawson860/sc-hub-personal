import { createClientFromRequest } from "npm:@base44/sdk@0.8.31";

const SHEET_ID = "1_6BgfNQzfoxxRwf9oAYkto0FBX8ihUZgDFe3CRE-Xuk";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

async function getSheetRows(
  token: string,
  sheetName: string,
  maxRows = 2000,
  maxCols = "J"
): Promise<string[][]> {
  const url = `${SHEETS_API}/${SHEET_ID}/values/${encodeURIComponent(sheetName)}!A1:${maxCols}${maxRows}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Sheet fetch failed (${sheetName}): ${resp.status}`);
  const data = (await resp.json()) as { values?: string[][] };
  return data.values || [];
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const token = Deno.env.get("GOOGLESHEETS_ACCESS_TOKEN");
    if (!token) {
      return Response.json({ error: "GOOGLESHEETS_ACCESS_TOKEN not set", success: false });
    }

    const results = {
      session_records: 0,
      testing_records: 0,
      erg_records: 0,
      errors: [] as string[],
    };

    // ── 1. SYNC SESSION DATA from "Athlete Hub Responses" ──────────────────
    // Columns: Timestamp(A), Date(B), Athlete(C), Session Type(D), Exercise(E), Set(F), Reps(G), Load(H), RPE(I)
    const hubRows = await getSheetRows(token, "Athlete Hub Responses", 2000, "I");
    const newSessionRecords: Record<string, unknown>[] = [];

    for (const row of hubRows.slice(1)) {
      // Need at least athlete + exercise
      const athlete = row[2]?.trim();
      const exercise = row[4]?.trim();
      if (!athlete || !exercise) continue;
      // Skip test entries
      if (athlete === "JDT" || athlete === "TEST") continue;

      // Use col B (Date) as primary date, fall back to col A (Timestamp)
      const rawDate = row[1]?.trim() || row[0]?.trim() || "";
      let dateStr = "";
      try {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) dateStr = d.toISOString().split("T")[0];
      } catch {}
      if (!dateStr) continue;

      newSessionRecords.push({
        timestamp: `${dateStr}T09:00:00`,
        athlete: athlete,
        session_type: row[3]?.trim() || "",
        exercise: exercise,
        set_number: row[5] ? parseInt(row[5]) || 1 : 1,
        reps: row[6]?.trim() || "",
        load: row[7]?.trim() || "",
        rpe: row[8] ? parseFloat(row[8]) : null,
      });
    }

    // Clear existing and re-insert (sheet is source of truth)
    const existingSessions = await base44.asServiceRole.entities.SessionLog.list({ limit: 1 });
    if (existingSessions.length > 0) {
      // Delete in batches
      let skip = 0;
      while (true) {
        const batch = await base44.asServiceRole.entities.SessionLog.list({ limit: 200, skip });
        if (batch.length === 0) break;
        for (const rec of batch) {
          await base44.asServiceRole.entities.SessionLog.delete(rec.id);
        }
        if (batch.length < 200) break;
      }
    }

    // Insert fresh from sheet in chunks of 100
    for (let i = 0; i < newSessionRecords.length; i += 100) {
      const chunk = newSessionRecords.slice(i, i + 100);
      await base44.asServiceRole.entities.SessionLog.create(chunk);
    }
    results.session_records = newSessionRecords.length;

    // ── 2. SYNC TESTING DATA ────────────────────────────────────────────────
    const testRows = await getSheetRows(token, "Core_Testing_Responses", 500, "K");
    const newTestRecords: Record<string, unknown>[] = [];

    for (const row of testRows.slice(1)) {
      if (row.length < 6) continue;
      const firstName = (row[1] || "").trim().toUpperCase();
      if (!firstName || firstName === "TEST" || firstName === "NOTREAL") continue;

      let ts = row[0];
      try { ts = new Date(row[0]).toISOString(); } catch {}

      newTestRecords.push({
        timestamp: ts,
        athlete_first: row[1]?.trim() || "",
        athlete_last: row[2]?.trim() || "",
        athlete_name: `${row[1]?.trim() || ""} ${row[2]?.trim() || ""}`.trim(),
        year_level: row[3] || "",
        height: row[4] ? parseFloat(row[4]) : null,
        weight: row[5] ? parseFloat(row[5]) : null,
        hollow_hold: row[6] ? parseFloat(row[6]) : null,
        prone_plank: row[7] ? parseFloat(row[7]) : null,
        side_plank_left: row[8] ? parseFloat(row[8]) : null,
        side_plank_right: row[9] ? parseFloat(row[9]) : null,
      });
    }

    if (newTestRecords.length > 0) {
      for (let i = 0; i < newTestRecords.length; i += 100) {
        await base44.asServiceRole.entities.TestingResult.create(newTestRecords.slice(i, i + 100));
      }
      results.testing_records = newTestRecords.length;
    }

    // ── 3. SYNC ERG SESSIONS ────────────────────────────────────────────────
    // Columns: Timestamp(A), Athlete(B), WorkoutType(C), TotalDistance(D), TotalTime(E),
    //          AvgSplit(F), AvgHR(G), StrokeRate(H), RPE(I), Intervals(J), Notes(K), ImageURL(L)
    try {
      const ergRows = await getSheetRows(token, "Erg_Session_Responses", 500, "M");
      const newErgRecords: Record<string, unknown>[] = [];

      for (const row of ergRows.slice(1)) {
        if (!row[0] || !row[1] || !row[2]) continue;
        let ts = row[0];
        try { ts = new Date(row[0]).toISOString(); } catch {}
        newErgRecords.push({
          timestamp: ts,
          athlete: row[1]?.trim() || "",
          workout_type: row[2]?.trim() || "",
          total_distance: row[3] ? parseFloat(row[3]) : null,
          total_time: row[4]?.trim() || null,
          avg_split: row[5]?.trim() || null,
          avg_heart_rate: row[6] ? parseFloat(row[6]) : null,
          stroke_rate: row[7] ? parseFloat(row[7]) : null,
          rpe: row[8] ? parseFloat(row[8]) : null,
          intervals: row[9]?.trim() || null,
          notes: row[10]?.trim() || null,
          image_url: row[11]?.trim() || null,
        });
      }

      // Wipe and re-insert
      const existingErg = await base44.asServiceRole.entities.ErgSession.list({ limit: 500 });
      for (const rec of existingErg) {
        await base44.asServiceRole.entities.ErgSession.delete(rec.id);
      }
      for (let i = 0; i < newErgRecords.length; i += 100) {
        await base44.asServiceRole.entities.ErgSession.create(newErgRecords.slice(i, i + 100));
      }
      results.erg_records = newErgRecords.length;
    } catch (e: unknown) {
      results.errors.push(`Erg: ${e instanceof Error ? e.message : String(e)}`);
    }

    return Response.json({ success: true, synced_at: new Date().toISOString(), ...results });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return Response.json({ error: msg, success: false }, { status: 500 });
  }
});
