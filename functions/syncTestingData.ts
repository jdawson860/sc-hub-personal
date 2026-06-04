import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const SPREADSHEET_ID = '1_6BgfNQzfoxxRwf9oAYkto0FBX8ihUZgDFe3CRE-Xuk';
const SHEET_NAME = 'Core_Testing_Responses';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlesheets');

    const sheetsRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!sheetsRes.ok) {
      const err = await sheetsRes.text();
      return Response.json({ error: `Sheets API error: ${err}` }, { status: 500 });
    }

    const sheetsData = await sheetsRes.json();
    const rows: string[][] = sheetsData.values || [];
    const dataRows = rows.slice(1).filter(r => r && r.some(c => c?.trim()));

    if (dataRows.length === 0) {
      return Response.json({ ok: true, synced: 0, message: 'No data rows found' });
    }

    // Fetch existing to deduplicate
    const existing = await base44.asServiceRole.entities.TestingResult.list();
    const existingKeys = new Set(
      existing.map((r: any) => `${r.timestamp?.slice(0,10)}|${r.athlete_name}`)
    );

    let synced = 0, skipped = 0, errors = 0;

    for (const row of dataRows) {
      // Timestamp, First Name, Last Name, Year Level, Height, Weight, Hollow Hold, Prone Plank, Side Plank Left, Side Plank Right
      const [timestamp, firstName, lastName, yearLevel, height, weight, hollowHold, pronePlank, sidePlankLeft, sidePlankRight] = row;

      if (!firstName || !lastName) { skipped++; continue; }

      const athleteName = `${firstName.trim()} ${lastName.trim()}`;

      // Normalise timestamp
      let ts = timestamp?.trim() || '';
      const dtMatch = ts.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(.*)$/);
      if (dtMatch) {
        const [, m, d, y, time] = dtMatch;
        ts = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}${time ? 'T'+time : 'T00:00:00'}`;
      }

      const key = `${ts.slice(0,10)}|${athleteName}`;
      if (existingKeys.has(key)) { skipped++; continue; }

      try {
        await base44.asServiceRole.entities.TestingResult.create({
          timestamp: ts,
          athlete_first: firstName.trim(),
          athlete_last: lastName.trim(),
          athlete_name: athleteName,
          year_level: yearLevel?.trim() || 'Unknown',
          height: height ? parseFloat(height) : null,
          weight: weight ? parseFloat(weight) : null,
          hollow_hold: hollowHold ? parseFloat(hollowHold) : null,
          prone_plank: pronePlank ? parseFloat(pronePlank) : null,
          side_plank_left: sidePlankLeft ? parseFloat(sidePlankLeft) : null,
          side_plank_right: sidePlankRight ? parseFloat(sidePlankRight) : null,
        });
        existingKeys.add(key);
        synced++;
      } catch(e) {
        errors++;
      }
    }

    return Response.json({
      ok: true, synced, skipped, errors,
      message: `Synced ${synced} new testing records, skipped ${skipped} duplicates`
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
