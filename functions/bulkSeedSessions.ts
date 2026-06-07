import { base44 } from '../base44/agents/your_agent.jsonc';

// This function inserts pre-generated SessionLog records in bulk
// Called internally during seeding operations

export default async function bulkSeedSessions(req: Request): Promise<Response> {
  try {
    const { records } = await req.json() as { records: Record<string, unknown>[] };
    
    if (!Array.isArray(records) || records.length === 0) {
      return Response.json({ error: 'No records provided' }, { status: 400 });
    }

    const BATCH = 200;
    let totalInserted = 0;
    const errors: string[] = [];

    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      try {
        // @ts-ignore
        const result = await base44.asServiceRole.entities.SessionLog.create(batch);
        const n = Array.isArray(result) ? result.length : 1;
        totalInserted += n;
      } catch (err: any) {
        errors.push(`Batch ${Math.floor(i/BATCH)+1}: ${err.message}`);
      }
    }

    return Response.json({ ok: true, inserted: totalInserted, errors });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
