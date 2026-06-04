import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const records = await base44.asServiceRole.entities.TestingResult.list();

    // Group by year level
    const byYear: Record<string, any[]> = {};
    for (const r of records) {
      const yr = r.year_level || 'Unknown';
      if (!byYear[yr]) byYear[yr] = [];
      byYear[yr].push(r);
    }

    // For each year level, rank athletes on each test metric (higher = better for all current tests)
    const METRICS = [
      { key: 'hollow_hold', label: 'Hollow Hold', unit: 's', higherBetter: true },
      { key: 'prone_plank', label: 'Prone Plank', unit: 's', higherBetter: true },
      { key: 'side_plank_left', label: 'Side Plank Left', unit: 's', higherBetter: true },
      { key: 'side_plank_right', label: 'Side Plank Right', unit: 's', higherBetter: true },
    ];

    const yearGroups = Object.keys(byYear).sort((a,b) => {
      const na = parseInt(a) || 999;
      const nb = parseInt(b) || 999;
      return na - nb;
    });

    const result = yearGroups.map(yr => {
      const athletes = byYear[yr];

      // For each metric, rank athletes (only those with a score)
      const metricRankings = METRICS.map(metric => {
        const scored = athletes
          .filter(a => a[metric.key] !== null && a[metric.key] !== undefined)
          .sort((a, b) => metric.higherBetter
            ? b[metric.key] - a[metric.key]
            : a[metric.key] - b[metric.key]
          );

        return {
          ...metric,
          rankings: scored.map((a, idx) => ({
            rank: idx + 1,
            athlete: a.athlete_name,
            score: a[metric.key],
            date: a.timestamp?.slice(0, 10),
          }))
        };
      });

      // Overall score per athlete (avg rank across all metrics they have)
      const athleteScores: Record<string, { totalRank: number, count: number, scores: Record<string,number> }> = {};
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

      return {
        yearLevel: yr,
        athleteCount: athletes.length,
        metricRankings,
        overallRanking,
      };
    });

    return Response.json({ ok: true, yearGroups: result, totalRecords: records.length });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
