// getTestingData v2 - uses direct REST API (no SDK asServiceRole)

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
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  try {
    const token = Deno.env.get("BASE44_SERVICE_TOKEN") || "";
    const records = await fetchEntity('TestingResult', token);

    const byYear: Record<string, any[]> = {};
    for (const r of records) {
      const yr = r.year_level || 'Unknown';
      if (!byYear[yr]) byYear[yr] = [];
      byYear[yr].push(r);
    }

    const METRICS = [
      { key: 'hollow_hold', label: 'Hollow Hold', unit: 's', higherBetter: true },
      { key: 'prone_plank', label: 'Prone Plank', unit: 's', higherBetter: true },
      { key: 'side_plank_left', label: 'Side Plank Left', unit: 's', higherBetter: true },
      { key: 'side_plank_right', label: 'Side Plank Right', unit: 's', higherBetter: true },
    ];

    const yearGroups = Object.keys(byYear).sort((a, b) => (parseInt(a) || 999) - (parseInt(b) || 999));

    const result = yearGroups.map(yr => {
      const athletes = byYear[yr];
      const metricRankings = METRICS.map(metric => {
        const scored = athletes
          .filter(a => a[metric.key] !== null && a[metric.key] !== undefined)
          .sort((a, b) => metric.higherBetter ? b[metric.key] - a[metric.key] : a[metric.key] - b[metric.key]);
        return {
          ...metric,
          rankings: scored.map((a, idx) => ({
            rank: idx + 1,
            athlete: a.athlete_name,
            score: a[metric.key],
            date: a.timestamp?.slice(0, 10),
          })),
        };
      });

      const athleteScores: Record<string, { totalRank: number, count: number, scores: Record<string, number> }> = {};
      metricRankings.forEach(metric => {
        metric.rankings.forEach(r => {
          if (!athleteScores[r.athlete]) athleteScores[r.athlete] = { totalRank: 0, count: 0, scores: {} };
          athleteScores[r.athlete].totalRank += r.rank;
          athleteScores[r.athlete].count++;
          athleteScores[r.athlete].scores[metric.key] = r.score;
        });
      });

      const overallRanking = Object.entries(athleteScores)
        .map(([athlete, s]) => ({
          athlete,
          avgRank: s.count > 0 ? parseFloat((s.totalRank / s.count).toFixed(1)) : 999,
          testsCompleted: s.count,
          scores: s.scores,
        }))
        .sort((a, b) => a.avgRank - b.avgRank)
        .map((a, idx) => ({ ...a, overallRank: idx + 1 }));

      return { yearLevel: yr, athleteCount: athletes.length, metricRankings, overallRanking };
    });

    return Response.json({ ok: true, yearGroups: result, totalRecords: records.length }, { headers: cors });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500, headers: cors });
  }
});
