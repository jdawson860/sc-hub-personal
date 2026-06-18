// Extracts erg workout data from a Concept2 screen photo using GPT-4o vision
// Also uploads the image to storage and returns image_url so it's saved with the session
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const APP_ID = "6a2139cf1719e3fb84188511";

Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => null);
    if (!body?.image_base64) {
      return Response.json({ error: 'No image provided' }, { status: 400, headers: cors });
    }

    const { image_base64, athlete = 'unknown' } = body;

    // ── 1. Upload image to storage (best-effort, don't fail extraction if this fails) ──
    let image_url: string | null = null;
    try {
      const imageBytes = Uint8Array.from(atob(image_base64), c => c.charCodeAt(0));
      const filename = `erg_screen_${athlete}_${Date.now()}.jpg`;
      const serviceToken = Deno.env.get('BASE44_SERVICE_TOKEN') || '';
      const uploadResp = await fetch(`https://app.base44.com/api/apps/${APP_ID}/storage/upload`, {
        method: 'POST',
        headers: {
          'api_key': serviceToken,
          'Content-Type': 'image/jpeg',
          'X-Filename': filename,
        },
        body: imageBytes,
      });
      if (uploadResp.ok) {
        const uploadData = await uploadResp.json();
        image_url = uploadData.file_url || uploadData.url || uploadData.public_url || null;
      }
    } catch (_) {
      // Image upload failed silently — extraction still proceeds
    }

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      return Response.json({
        ok: false,
        error: 'Vision AI not configured',
        fallback: true,
        image_url,
        message: 'Photo extraction unavailable — please use manual entry below.'
      }, { status: 200, headers: cors });
    }

    const prompt = `You are analyzing a photo of a Concept2 rowing ergometer screen showing a completed workout.

Extract ALL available workout data and return it as a single JSON object with these fields (omit any field not visible):

Top-level fields:
- workout_type: one of "Single Distance", "Single Time", "Intervals", "Custom"
- session_date: date string in YYYY-MM-DD format if visible on screen (e.g. "2026-06-18") — check for any date/time display on the erg
- total_distance: number in metres (e.g. 2000)
- total_time: string in mm:ss.t format (e.g. "6:42.3")
- avg_split: string in m:ss.t format per 500m (e.g. "1:41.0")
- avg_heart_rate: number in bpm
- stroke_rate: number (strokes per minute)
- rest_time: string for rest/recovery between intervals (e.g. "3:00")
- intervals: string describing interval structure (e.g. "4x4:00 / 3:00r")

Per-interval data (IMPORTANT — include this if the screen shows individual interval results):
- interval_splits: array of objects, one per interval, each with:
  - interval: number (1, 2, 3 ...)
  - distance: number in metres (e.g. 1048)
  - time: string in mm:ss.t format (e.g. "4:00.0")
  - split: string in m:ss.t format per 500m (e.g. "1:54.3")
  - stroke_rate: number if shown (optional)
  - heart_rate: number if shown (optional)

If this is an interval workout, always try to extract interval_splits — even if only distance or split is visible per interval. Extract as many fields as you can see per interval.

Respond ONLY with a valid JSON object. No explanation, no markdown, no code fences. Just the raw JSON.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${image_base64}`,
                detail: 'high'
              }
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      let userMessage = 'Photo extraction failed — please use manual entry.';
      if (errText.includes('insufficient_quota') || errText.includes('quota')) {
        userMessage = 'Photo extraction is temporarily unavailable (API quota). Use manual entry below — your photo is saved above for reference.';
      }
      return Response.json({
        ok: false,
        fallback: true,
        image_url,
        message: userMessage,
        error: errText,
      }, { status: 200, headers: cors });
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content?.trim() || '';

    let data: Record<string, unknown> = {};
    try {
      const clean = content.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
      data = JSON.parse(clean);
    } catch {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        try { data = JSON.parse(match[0]); } catch { /* leave empty */ }
      }
    }

    return Response.json({ ok: true, data, image_url }, { status: 200, headers: cors });

  } catch (error: any) {
    return Response.json({
      ok: false,
      fallback: true,
      message: 'Photo extraction failed — please fill in the form manually.',
      error: error.message,
    }, { status: 200, headers: cors });
  }
});
