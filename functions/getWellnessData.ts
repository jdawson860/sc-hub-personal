// getWellnessData v2 - uses direct REST API (no SDK asServiceRole)

const APP_ID = "6a2139cf1719e3fb84188511";
const BASE = `https://app.base44.com/api/apps/${APP_ID}/entities`;

async function fetchEntity(entity: string, token: string): Promise<any[]> {
  const res = await fetch(`${BASE}/${entity}`, { headers: { 'api_key': token } });
  if (!res.ok) throw new Error(`${entity} fetch failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  try {
    const token = Deno.env.get("BASE44_SERVICE_TOKEN") || "";
    const body = await req.json().catch(() => ({}));
    const { athlete } = body;

    const allWellness = await fetchEntity('WellnessCheckIn', token);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 28);

    const recent = allWellness
      .filter((w: any) => new Date(w.timestamp) >= cutoff)
      .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const filtered = athlete ? recent.filter((w: any) => w.athlete === athlete) : recent;

    const latestMap: Record<string, any> = {};
    for (const w of recent) {
      if (!latestMap[w.athlete]) latestMap[w.athlete] = w;
    }
    const latest = Object.values(latestMap).map((w: any) => ({
      athlete: w.athlete,
      readiness_score: w.readiness_score,
      sleep: w.sleep,
      soreness: w.soreness,
      motivation: w.motivation,
      notes: w.notes,
      timestamp: w.timestamp,
      date: w.timestamp?.slice(0, 10),
    })).sort((a: any, b: any) => (a.readiness_score ?? 10) - (b.readiness_score ?? 10));

    const readinessScores = latest.map((w: any) => w.readiness_score).filter((s: any) => s != null);
    const squad_avg_readiness = readinessScores.length
      ? parseFloat((readinessScores.reduce((a: number, b: number) => a + b, 0) / readinessScores.length).toFixed(1))
      : null;

    const low_readiness = latest.filter((w: any) => (w.readiness_score ?? 10) < 5).map((w: any) => w.athlete);

    const series = filtered.map((w: any) => ({
      athlete: w.athlete,
      date: w.timestamp?.slice(0, 10),
      readiness_score: w.readiness_score,
      sleep: w.sleep,
      soreness: w.soreness,
      motivation: w.motivation,
      notes: w.notes,
    }));

    const athletes = [...new Set(recent.map((w: any) => w.athlete as string))].sort();

    return Response.json({ ok: true, athletes, latest, series, squad_avg_readiness, low_readiness }, { status: 200, headers: cors });
  } catch (err: any) {
    return Response.json({ ok: false, error: err.message }, { status: 500, headers: cors });
  }
});
