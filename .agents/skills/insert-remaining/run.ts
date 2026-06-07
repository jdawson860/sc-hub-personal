// Insert remaining S&C session data batches 001-014
import base44 from "npm:@base44/sdk";

const client = base44.createClient({
  appId: "6a2139cf1719e3fb84188511",
  serviceRoleKey: Deno.env.get("BASE44_SERVICE_ROLE_KEY") || "",
});

import { readFileSync } from "node:fs";

let totalInserted = 0;
let totalFailed = 0;

for (let i = 1; i <= 14; i++) {
  const filename = `/tmp/batch_${String(i).padStart(3, "0")}.json`;
  let records: any[];
  try {
    records = JSON.parse(readFileSync(filename, "utf-8"));
  } catch (e) {
    console.error(`Could not read ${filename}: ${e}`);
    continue;
  }

  console.log(`Inserting batch ${i} (${records.length} records)...`);

  // Insert in sub-batches of 50
  const SUB = 50;
  for (let j = 0; j < records.length; j += SUB) {
    const chunk = records.slice(j, j + SUB);
    try {
      await client.asServiceRole.entities.SessionLog.bulkCreate(chunk);
      totalInserted += chunk.length;
      console.log(`  Batch ${i} chunk ${Math.floor(j/SUB)+1}: +${chunk.length} (total: ${totalInserted})`);
    } catch (e: any) {
      // Try one at a time as fallback
      for (const rec of chunk) {
        try {
          await client.asServiceRole.entities.SessionLog.create(rec);
          totalInserted++;
        } catch (e2: any) {
          console.error(`  Failed record: ${JSON.stringify(rec).slice(0,100)} — ${e2.message}`);
          totalFailed++;
        }
      }
    }
    await new Promise(r => setTimeout(r, 100));
  }
}

console.log(`\nDone. Inserted: ${totalInserted}, Failed: ${totalFailed}`);
