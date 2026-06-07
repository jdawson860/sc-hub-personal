export default async function seedSessionLogs(req: Request): Promise<Response> {
  try {
    const body = await req.json() as { records: Record<string, unknown>[], apiKey: string, appId: string };
    const { records, apiKey, appId } = body;
    
    if (!Array.isArray(records) || records.length === 0) {
      return Response.json({ error: "No records provided" }, { status: 400 });
    }

    const BASE_URL = `https://api.base44.com/api/apps/${appId}/entities/SessionLog`;
    const BATCH = 200;
    let totalInserted = 0;
    const errors: string[] = [];

    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      try {
        const resp = await fetch(BASE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api_key": apiKey,
          },
          body: JSON.stringify(batch),
        });
        
        if (!resp.ok) {
          const text = await resp.text();
          errors.push(`Batch ${i}: HTTP ${resp.status} - ${text.slice(0, 200)}`);
          continue;
        }
        
        const result = await resp.json();
        const n = Array.isArray(result) ? result.length : 1;
        totalInserted += n;
      } catch (err: any) {
        errors.push(`Batch ${i}: ${err?.message || String(err)}`);
      }
    }

    return Response.json({ 
      ok: errors.length === 0, 
      inserted: totalInserted, 
      errors,
      total: records.length
    });
  } catch (err: any) {
    return Response.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
