// Extracts erg workout data from a Concept2 screen photo using GPT-4o vision
Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  try {
    const body = await req.json().catch(() => null);
    if (!body?.image_base64) return Response.json({ error: 'No image provided' }, { status: 400, headers: cors });

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) return Response.json({ error: 'OpenAI key not configured' }, { status: 500, headers: cors });

    const prompt = `You are analyzing a photo of a Concept2 rowing ergometer screen showing a completed workout.
Extract ALL available workout data from the screen and return it as a JSON object with these fields (omit any field not visible):
- workout_type: one of "Single Distance", "Single Time", "Intervals", "Custom"
- total_distance: number in metres (e.g. 2000)
- total_time: string in mm:ss.t format (e.g. "6:42.3")
- avg_split: string in m:ss.t format per 500m (e.g. "1:41.0")
- avg_heart_rate: number in bpm
- stroke_rate: number (strokes per minute)
- intervals: string describing interval structure if applicable (e.g. "8x500m")

Respond ONLY with a valid JSON object. No explanation, no markdown, no code fences. Just the JSON.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${body.image_base64}`, detail: 'high' } }
          ]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return Response.json({ ok: false, error: `OpenAI error: ${err}` }, { status: 500, headers: cors });
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content?.trim() || '';

    // Parse the JSON response
    let data = {};
    try {
      data = JSON.parse(content);
    } catch {
      // Try to extract JSON from the response
      const match = content.match(/\{[\s\S]*\}/);
      if (match) data = JSON.parse(match[0]);
    }

    return Response.json({ ok: true, data }, { status: 200, headers: cors });

  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500, headers: cors });
  }
});
