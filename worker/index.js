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

// --- JWT (HS256) pomocí Web Crypto ---
function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function signJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const enc = new TextEncoder();
  const h = b64url(enc.encode(JSON.stringify(header)));
  const p = b64url(enc.encode(JSON.stringify(payload)));
  const data = `${h}.${p}`;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return `${data}.${b64url(sig)}`;
}
function isValidEmail(e) {
  return typeof e === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
}
async function verifyJWT(token, secret) {
  try {
    const [h, p, s] = token.split('.');
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sigBuf = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBuf, enc.encode(`${h}.${p}`));
    if (!valid) return null;
    const payload = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}
function getSessionToken(request) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return m ? m[1] : null;
}

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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // --- POST /auth/send ---
    if (url.pathname === '/auth/send') {
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
          status: 405,
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

      const { email } = body;
      if (!isValidEmail(email)) {
        return new Response(JSON.stringify({ error: 'invalid_email' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const token = crypto.randomUUID();
      const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await env.DB.prepare(
        'INSERT INTO auth_tokens (token, user_id, expires_at, used) VALUES (?, NULL, ?, 0)'
      ).bind(token, expires).run();

      const link = `https://legalid.kuba-houser.workers.dev/auth/verify?token=${token}&email=${encodeURIComponent(email)}`;

      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'LegalID <login@legalid.cz>',
          reply_to: 'info@legalid.cz',
          to: [email],
          subject: 'Přihlášení do LegalID',
          html: `<p>Pro přihlášení klikni na odkaz (platí 15 minut):</p><p><a href="${link}">Přihlásit se do LegalID</a></p><p>Pokud jsi o přihlášení nežádal, ignoruj tento e-mail.</p>`,
        }),
      });
      const resendBody = await resendRes.text();
      console.log('RESEND status:', resendRes.status, 'body:', resendBody);
      if (!resendRes.ok) {
        return new Response(JSON.stringify({ ok: false, error: 'resend_failed', status: resendRes.status, detail: resendBody }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- GET /auth/verify ---
    if (url.pathname === '/auth/verify') {
      if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
          status: 405,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const token = url.searchParams.get('token');
      const email = url.searchParams.get('email');

      const row = await env.DB.prepare(
        'SELECT * FROM auth_tokens WHERE token = ?'
      ).bind(token).first();

      if (!row || row.used === 1 || new Date(row.expires_at) < new Date()) {
        return new Response(JSON.stringify({ error: 'invalid_token', message: 'Neplatný nebo expirovaný odkaz.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      await env.DB.prepare(
        'UPDATE auth_tokens SET used = 1 WHERE token = ?'
      ).bind(token).run();

      let user = await env.DB.prepare(
        'SELECT * FROM users WHERE email = ?'
      ).bind(email).first();
      if (!user) {
        await env.DB.prepare(
          'INSERT INTO users (email) VALUES (?)'
        ).bind(email).run();
        user = await env.DB.prepare(
          'SELECT * FROM users WHERE email = ?'
        ).bind(email).first();
      }

      const jwt = await signJWT(
        { sub: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600 },
        env.JWT_SECRET
      );

      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          'Location': 'https://legalid.cz/',
          'Set-Cookie': `session=${jwt}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${7 * 24 * 3600}`,
        },
      });
    }

    // --- GET /auth/me ---
    if (url.pathname === '/auth/me') {
      if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
          status: 405,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const sessionToken = getSessionToken(request);
      if (!sessionToken) {
        return new Response(JSON.stringify({ loggedIn: false }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const payload = await verifyJWT(sessionToken, env.JWT_SECRET);
      if (!payload) {
        return new Response(JSON.stringify({ loggedIn: false }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const user = await env.DB.prepare(
        'SELECT email, plan, trial_ends_at, dolozky_this_month FROM users WHERE id = ?'
      ).bind(payload.sub).first();

      return new Response(JSON.stringify({ loggedIn: true, email: user.email, plan: user.plan, trial_ends_at: user.trial_ends_at }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- POST /auth/logout ---
    if (url.pathname === '/auth/logout') {
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
          status: 405,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Set-Cookie': 'session=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0',
        },
      });
    }

    // --- /ocr a fallback ---
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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
      const errBody = await anthropicRes.text();
      return new Response(JSON.stringify({ error: 'ocr_failed', message: `Anthropic ${anthropicRes.status}: ${errBody}` }), {
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
