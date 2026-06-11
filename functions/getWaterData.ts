// getWaterData v2 - uses direct REST API (no SDK asServiceRole)

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

    const sessions = await fetchEntity('WaterSession', token);
    sessions.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const byAthlete: Record<string, any[]> = {};
    for (const s of sessions) {
      if (!s.athlete) continue;
      if (!byAthlete[s.athlete]) byAthlete[s.athlete] = [];
      byAthlete[s.athlete].push(s);
    }

    const athleteSummaries = Object.entries(byAthlete).map(([athlete, sList]) => {
      const rpes = sList.filter((s: any) => s.rpe).map((s: any) => s.rpe);
      const avgRpe = rpes.length ? parseFloat((rpes.reduce((a: number, b: number) => a + b, 0) / rpes.length).toFixed(1)) : null;
      const totalDist = sList.reduce((a: number, s: any) => a + (s.distance || 0), 0);
      return {
        athlete,
        sessions: sList.length,
        totalDistance: Math.round(totalDist),
        avgRpe,
        lastDate: sList[0]?.timestamp?.slice(0, 10),
        sessionTypes: [...new Set(sList.map((s: any) => s.session_type))],
      };
    }).sort((a, b) => a.athlete.localeCompare(b.athlete));

    const splitsLb: { athlete: string, split: string, secs: number, type: string, date: string }[] = [];
    for (const [athlete, sList] of Object.entries(byAthlete)) {
      const withSplits = (sList as any[]).filter(s => s.avg_split);
      if (!withSplits.length) continue;
      let best: any = null;
      let bestSecs = Infinity;
      for (const s of withSplits) {
        const parts = s.avg_split.split(':');
        if (parts.length === 2) {
          const secs = parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
          if (secs < bestSecs) { bestSecs = secs; best = s; }
        }
      }
      if (best) splitsLb.push({ athlete, split: best.avg_split, secs: bestSecs, type: best.session_type, date: best.timestamp?.slice(0, 10) });
    }
    splitsLb.sort((a, b) => a.secs - b.secs);

    const filteredSessions = body.athlete ? byAthlete[body.athlete] || [] : sessions.slice(0, 50);

    return Response.json({
      ok: true,
      sessions: filteredSessions,
      athleteSummaries,
      splitsLeaderboard: splitsLb,
      totalSessions: sessions.length,
    }, { status: 200, headers: cors });

  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500, headers: cors });
  }
});
