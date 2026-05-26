const SYSTEM_PROMPT = `Jsi asistent pro extrakci dat z českých občanských průkazů.
Vrať POUZE validní JSON bez markdown formátování, bez backtick bloků, bez jakéhokoliv preamble.
Pokud pole není čitelné nebo chybí, nastav hodnotu null.`;

const USER_PROMPT = `Z přiložené fotografie nebo fotografií občanského průkazu extrahuj tato pole a vrať JSON:
{
  "jmeno_prijmeni": "celé jméno a příjmení přesně jak je na průkazu",
  "datum_narozeni": "DD.MM.YYYY",
  "misto_narozeni": "město nebo obec",
  "adresa_trvaleho_pobytu": "ulice č.p., město PSČ jako jeden řetězec",
  "cislo_op": "číslo dokladu 9 číslic bez mezer",
  "statni_obcanstvi": "státní občanství",
  "confidence": 0.0,
  "pole_s_nizkou_jistotou": []
}
Confidence je 0–1, celková jistota extrakce. Do pole_s_nizkou_jistotou uveď klíče polí, která jsou špatně čitelná.`;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || 'https://legalid.cz,http://localhost:8080')
      .split(',')
      .map(o => o.trim());

    const corsOk = allowed.some(o => {
      if (o.includes('localhost')) {
        return origin.startsWith('http://localhost');
      }
      return origin === o;
    });

    const corsHeaders = {
      'Access-Control-Allow-Origin': corsOk ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/ocr') {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'invalid_json' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { images } = body;
    if (!Array.isArray(images) || images.length === 0) {
      return new Response(JSON.stringify({ error: 'missing_images' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const imageContent = images.map(img => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.media_type || 'image/jpeg',
        data: img.data,
      },
    }));

    const anthropicPayload = {
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            ...imageContent,
            { type: 'text', text: USER_PROMPT },
          ],
        },
      ],
    };

    let anthropicRes;
    try {
      anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(anthropicPayload),
      });
    } catch {
      return new Response(JSON.stringify({ error: 'ocr_failed', message: 'Nepodařilo se kontaktovat AI.' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!anthropicRes.ok) {
      return new Response(JSON.stringify({ error: 'ocr_failed', message: 'Nepodařilo se rozpoznat údaje.' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const anthropicData = await anthropicRes.json();
    const text = anthropicData?.content?.[0]?.text || '';

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return new Response(JSON.stringify({ error: 'ocr_failed', message: 'Nepodařilo se rozpoznat údaje.' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  },
};
