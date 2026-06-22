// getTestingData v3 - Z-score composite ranking + latest record per athlete

const APP_ID = "6a2139cf1719e3fb84188511";
const BASE = `https://app.base44.com/api/apps/${APP_ID}/entities`;

async function fetchEntity(entity: string, token: string): Promise<any[]> {
  const res = await fetch(`${BASE}/${entity}`, { headers: { 'api_key': token } });
  if (!res.ok) throw new Error(`${entity} fetch failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

const METRICS = [
  { key: 'hollow_hold',    label: 'Hollow Hold',    unit: 's', higherBetter: true },
  { key: 'prone_plank',    label: 'Prone Plank',    unit: 's', higherBetter: true },
  { key: 'side_plank_left', label: 'Side Plank Left', unit: 's', higherBetter: true },
  { key: 'side_plank_right', label: 'Side Plank Right', unit: 's', higherBetter: true },
];

function mean(vals: number[]) {
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
function std(vals: number[], m: number) {
  if (vals.length < 2) return 1; // avoid div/0 — return 1 so z-score = raw diff
  const variance = vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length;
  return Math.sqrt(variance) || 1;
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

    // ── Keep only the LATEST record per athlete (by timestamp) ──────────
    const latestMap: Record<string, any> = {};
    for (const r of records) {
      const key = (r.athlete_name || '').trim().toLowerCase();
      if (!key) continue;
      if (!latestMap[key] || r.timestamp > latestMap[key].timestamp) {
        latestMap[key] = r;
      }
    }
    const latest = Object.values(latestMap);

    // ── Group by year level ──────────────────────────────────────────────
    const byYear: Record<string, any[]> = {};
    for (const r of latest) {
      const yr = r.year_level || 'Unknown';
      if (!byYear[yr]) byYear[yr] = [];
      byYear[yr].push(r);
    }

    const yearGroups = Object.keys(byYear).sort((a, b) => (parseInt(a) || 999) - (parseInt(b) || 999));

    const result = yearGroups.map(yr => {
      const athletes = byYear[yr];

      // ── Compute Z-scores per metric ──────────────────────────────────
      const metricStats: Record<string, { mean: number; std: number }> = {};
      for (const m of METRICS) {
        const vals = athletes.map(a => a[m.key]).filter(v => v != null && !isNaN(Number(v))).map(Number);
        if (vals.length > 0) {
          const mu = mean(vals);
          metricStats[m.key] = { mean: mu, std: std(vals, mu) };
        }
      }

      // ── Build per-athlete composite Z-score ──────────────────────────
      const ranked = athletes.map(a => {
        const scores: Record<string, number> = {};
        let zSum = 0;
        let zCount = 0;
        let testsCompleted = 0;

        for (const m of METRICS) {
          const raw = a[m.key];
          if (raw != null && !isNaN(Number(raw)) && metricStats[m.key]) {
            scores[m.key] = Number(raw);
            testsCompleted++;
            const { mean: mu, std: sd } = metricStats[m.key];
            const z = (Number(raw) - mu) / sd;
            // higherBetter: positive z = above average = good
            zSum += m.higherBetter ? z : -z;
            zCount++;
          }
        }

        const compositeZ = zCount > 0 ? parseFloat((zSum / zCount).toFixed(3)) : -999;
        return {
          athlete: (a.athlete_name || '').trim(),
          compositeZ,
          testsCompleted,
          scores,
          lastTested: a.timestamp?.slice(0, 10) || null,
        };
      });

      // Sort by compositeZ descending
      ranked.sort((a, b) => b.compositeZ - a.compositeZ);
      const overallRanking = ranked.map((a, idx) => ({ ...a, overallRank: idx + 1 }));

      // Keep metricRankings for compatibility (sorted per metric)
      const metricRankings = METRICS.map(m => ({
        ...m,
        rankings: [...athletes]
          .filter(a => a[m.key] != null)
          .sort((a, b) => m.higherBetter ? b[m.key] - a[m.key] : a[m.key] - b[m.key])
          .map((a, idx) => ({
            rank: idx + 1,
            athlete: (a.athlete_name || '').trim(),
            score: a[m.key],
            date: a.timestamp?.slice(0, 10),
          })),
      }));

      return { yearLevel: yr, athleteCount: athletes.length, metricRankings, overallRanking };
    });

    return Response.json({ ok: true, yearGroups: result, totalRecords: records.length }, { headers: cors });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500, headers: cors });
  }
});
