import { lookupMvcr, lookupIsir, lookupIsirCompany, lookupAres, fetchAresSubject, lookupSanctions, lookupSanctionsEntity, lookupPep } from './utils/lookups.js';
import { importEuSanctions } from './utils/sanctions.js';

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

// --- AML režim: bohatší extrakce z dokladu totožnosti (OP/pas), zpracuje po stranách ---
const AML_SYSTEM_PROMPT = `Jsi asistent pro extrakci dat z českých dokladů totožnosti (občanský průkaz, cestovní pas).
Vrať POUZE validní JSON bez markdown formátování, bez backtick bloků, bez jakéhokoliv preamble.
Pokud pole není na zpracovávané straně čitelné nebo tam není, nastav hodnotu null. Nehádej.`;

function amlUserPrompt(side) {
  const which = side === 'back' ? 'ZADNÍ' : side === 'multi' ? 'VÍCE STRAN' : 'PŘEDNÍ';
  const focus = side === 'back'
    ? `Zpracováváš ZADNÍ stranu českého OP. Na zadní straně bývá adresa trvalého pobytu, datum vydání, datum platnosti a úřad. Zaměř se na tato pole; pole, která jsou jen na přední straně (jméno, datum/místo narození, číslo dokladu), nech null, pokud nejsou na této straně viditelná.`
    : side === 'multi'
    ? `Analyzuj VŠECHNA nahraná média jako JEDEN doklad totožnosti — mohou to být přední a zadní strana občanského průkazu, více stránek cestovního pasu, řidičský průkaz, nebo scan PDF s více stranami. Slouč údaje ze všech stran do jednoho výsledku. Pokud se údaj objevuje na více stranách, použij nejčitelnější hodnotu.`
    : `Zpracováváš PŘEDNÍ stranu dokladu. Vyplň pole čitelná z přední strany (jméno, příjmení, datum a místo narození, číslo dokladu, pohlaví, státní občanství); pole typicky jen na zadní straně (adresa, vydání, platnost) nech null, pokud nejsou viditelná.`;
  return `${focus}

Rozpoznej typ dokladu z obsahu a vrať jako client_doc_type jednu z hodnot: "OP" (občanský průkaz), "Pas" (cestovní pas), "ŘP" (řidičský průkaz) nebo "Jiné".

Extrahuj tato pole a vrať JSON:
{
  "jmeno": "křestní jméno (jen jméno, bez příjmení)",
  "prijmeni": "příjmení",
  "datum_narozeni": "DD.MM.YYYY",
  "misto_narozeni": "město nebo obec",
  "adresa_trvaleho_pobytu": "ulice č.p., město PSČ jako jeden řetězec",
  "cislo_dokladu": "číslo dokladu bez mezer",
  "typ_dokladu": "OP / Pas / ŘP / Jiné",
  "datum_vydani": "DD.MM.YYYY",
  "datum_platnosti": "DD.MM.YYYY",
  "statni_obcanstvi": "státní občanství",
  "pohlavi": "M nebo Ž",
  "strana": "${side === 'back' ? 'back' : side === 'multi' ? 'multi' : 'front'}",
  "confidence": 0.0,
  "pole_s_nizkou_jistotou": []
}
Zpracovávaná strana: ${which}. Confidence je 0–1, celková jistota extrakce. Do pole_s_nizkou_jistotou uveď klíče polí, která jsou špatně čitelná.`;
}

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

// Vrátí user_id z platné session, jinak null.
async function requireUserId(request, env) {
  const token = getSessionToken(request);
  if (!token) return null;
  const payload = await verifyJWT(token, env.JWT_SECRET);
  return payload ? payload.sub : null;
}

// Vygeneruje číslo kontroly 'AML-YYYYMM-XXXXXX' (6 náhodných znaků A-Z0-9).
function genCaseNumber() {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let rand = '';
  for (const b of bytes) rand += alphabet[b % alphabet.length];
  return `AML-${ym}-${rand}`;
}

// SHA-256 (hex) z base64 řetězce (Web Crypto).
async function sha256Hex(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Zavolá Anthropic a vrátí naparsovaný JSON. Při chybě parsování 1× zopakuje, pak vyhodí.
async function anthropicJson(env, { system, userContent, max_tokens = 1400 }) {
  const payload = { model: 'claude-sonnet-4-6', max_tokens, system, messages: [{ role: 'user', content: userContent }] };
  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(payload),
      });
    } catch (e) { lastErr = `network ${e?.message || e}`; continue; }
    if (!res.ok) { lastErr = `anthropic ${res.status}`; continue; }
    const data = await res.json();
    let text = (data?.content?.[0]?.text || '').trim();
    text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(text); } catch { lastErr = 'parse'; }
  }
  throw new Error(lastErr);
}

// Blok 4 — úrovně rizika a jejich pořadí (MAX = přísnější vyhrává).
const RISK_RANK = { nizke: 0, stredni: 1, vysoke: 2 };
function maxRisk(a, b) { return (RISK_RANK[a] ?? 0) >= (RISK_RANK[b] ?? 0) ? a : b; }
function safeParse(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

// U2 — když klient má jméno v originále (azbuka…), sankce+PEP běží i na tuto variantu.
// Vrátí závažnější (příp. vyšší skóre) ze dvou výsledků.
const LOOKUP_SEVERITY = { match: 3, warning: 2, manual: 1, clean: 0, error: -1 };
function higherLookup(a, b) {
  const ra = LOOKUP_SEVERITY[a.status] ?? 0;
  const rb = LOOKUP_SEVERITY[b.status] ?? 0;
  if (rb > ra) return b;
  if (ra > rb) return a;
  return (b.match_score ?? 0) > (a.match_score ?? 0) ? b : a;
}

// Spustí všech 5 lustrací paralelně nad daty případu, uloží každou do aml_lookups
// a vrátí pole výsledků. Každá lustrace je odolná (interní try/catch → status 'error'),
// takže selhání jedné nikdy nebrání ostatním.
async function runAllLookups(env, c) {
  const name = [c.client_name, c.client_surname].filter(Boolean).join(' ').trim();
  const birth = c.client_birth_date || null;
  const nameOrig = (c.client_name_original || '').trim();
  // U2 — sankce/PEP: primární kolo na latinku, druhé kolo na originál jména (vyšší z obou).
  const sanctionsTask = (async () => {
    const primary = await lookupSanctions(env, name, birth);
    if (!nameOrig) return primary;
    try { return higherLookup(primary, await lookupSanctions(env, nameOrig, birth)); }
    catch { return primary; }
  })();
  const pepTask = (async () => {
    const primary = await lookupPep(env, name, birth);
    if (!nameOrig) return primary;
    try { return higherLookup(primary, await lookupPep(env, nameOrig, birth)); }
    catch { return primary; }
  })();
  // Pozn.: aml_cases zatím nemá IČO klienta → ARES se přeskočí (klient je fyzická osoba).
  const tasks = [
    ['mvcr', lookupMvcr(c.client_doc_number, c.client_doc_type)],
    ['isir', lookupIsir(c.client_surname, c.client_name, birth)],
    ['ares', lookupAres(c.client_ico || null)],
    ['sanctions', sanctionsTask],
    ['pep', pepTask],
  ];
  // Právnická osoba: 5 lustrací výše běží na JEDNAJÍCÍ OSOBU; navíc lustrace firmy.
  if (c.subject_type === 'po') {
    tasks.push(['isir_po', lookupIsirCompany(c.client_ico)]);
    tasks.push(['sanctions_entity', lookupSanctionsEntity(env, c.company_name)]);
  }
  const checkedAt = new Date().toISOString();
  return Promise.all(tasks.map(async ([type, p]) => {
    let r;
    try { r = await p; } catch (e) { r = { status: 'error', details: `Neočekávaná chyba: ${e?.message || e}` }; }
    const details = typeof r.details === 'string' ? r.details : JSON.stringify(r.details ?? null);
    try {
      await env.DB.prepare(
        `INSERT INTO aml_lookups (case_id, lookup_type, result_status, result_details, matched_against, match_score, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(c.id, type, r.status, details, r.matched_against || null, r.match_score ?? null, checkedAt).run();
    } catch { /* log fail nesmí shodit odpověď */ }
    return {
      lookup_type: type, status: r.status,
      details: r.details ?? null,
      matched_against: r.matched_against || null,
      match_score: r.match_score ?? null,
      source: r.source || null,
      checked_at: checkedAt,
    };
  }));
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
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Krátký helper na JSON odpověď s CORS hlavičkami.
    const json = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

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

      const { email, remember } = body;
      if (!isValidEmail(email)) {
        return new Response(JSON.stringify({ error: 'invalid_email' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Magic link platí 15 min (bezpečnost). Délku SESSION zvolí uživatel přes remember.
      const token = crypto.randomUUID();
      const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await env.DB.prepare(
        'INSERT INTO auth_tokens (token, user_id, expires_at, used) VALUES (?, NULL, ?, 0)'
      ).bind(token, expires).run();

      const rememberParam = remember ? '&remember=1' : '';
      const link = `https://legalid.kuba-houser.workers.dev/auth/verify?token=${token}&email=${encodeURIComponent(email)}${rememberParam}`;

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
        const trialEnd = new Date(Date.now() + 30*24*3600*1000).toISOString();
        await env.DB.prepare(
          "INSERT INTO users (email, plan, trial_ends_at) VALUES (?, 'trial', ?)"
        ).bind(email, trialEnd).run();
        user = await env.DB.prepare(
          'SELECT * FROM users WHERE email = ?'
        ).bind(email).first();
      }

      // Délka session: remember=1 → 90 dní, jinak 7 dní (default, bezpečnější).
      // SameSite=None je POVINNÉ — frontend (legalid.cz) a API (workers.dev) jsou různé
      // domény, cookie je cross-site a bez None by se u API volání vůbec neposílala.
      const sessionDays = url.searchParams.get('remember') === '1' ? 90 : 7;
      const maxAge = sessionDays * 24 * 3600;
      const jwt = await signJWT(
        { sub: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + maxAge },
        env.JWT_SECRET
      );

      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          'Location': 'https://legalid.cz/',
          'Set-Cookie': `session=${jwt}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAge}`,
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

    // --- GET /api/auth/google --- (zahájení OAuth: redirect na Google)
    // Session mechanismus (JWT + cookie) zůstává; OAuth jen přidává cestu, jak session vznikne.
    const GOOGLE_REDIRECT_URI = 'https://legalid.kuba-houser.workers.dev/api/auth/google/callback';
    const FRONTEND_URL = 'https://legalid.cz/';
    if (url.pathname === '/api/auth/google') {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      if (!env.GOOGLE_CLIENT_ID) return json({ error: 'oauth_not_configured' }, 500);
      // CSRF state — náhodný token uložený do krátkodobé cookie, ověříme v callbacku.
      const state = b64url(crypto.getRandomValues(new Uint8Array(16)).buffer);
      const remember = url.searchParams.get('remember') === '1' ? '1' : '0';
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', GOOGLE_REDIRECT_URI);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', 'openid email');
      authUrl.searchParams.set('state', `${state}.${remember}`);   // stav + volba „zapamatovat"
      authUrl.searchParams.set('prompt', 'select_account');
      return new Response(null, {
        status: 302,
        headers: {
          'Location': authUrl.toString(),
          // Krátkodobá cookie na ověření state (10 min). Lax stačí — callback je na téže doméně.
          'Set-Cookie': `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
        },
      });
    }

    // --- GET /api/auth/google/callback --- (výměna code → email → session)
    if (url.pathname === '/api/auth/google/callback') {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      const fail = (reason) => new Response(null, {
        status: 302,
        headers: { 'Location': `${FRONTEND_URL}?login_error=${reason}` },
      });

      const code = url.searchParams.get('code');
      const [stateToken, rememberFlag] = (url.searchParams.get('state') || '').split('.');
      const cookie = request.headers.get('Cookie') || '';
      const cm = cookie.match(/(?:^|;\s*)oauth_state=([^;]+)/);
      const cookieState = cm ? cm[1] : null;
      if (!code || !stateToken || !cookieState || stateToken !== cookieState) return fail('oauth_state');

      // Výměna authorization code za token.
      let tokenData;
      try {
        const tr = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: GOOGLE_REDIRECT_URI,
            grant_type: 'authorization_code',
          }),
        });
        tokenData = await tr.json();
        if (!tr.ok || !tokenData.access_token) return fail('oauth_token');
      } catch { return fail('oauth_token'); }

      // E-mail z userinfo endpointu (jednodušší než ověřovat podpis id_tokenu proti JWKS).
      let info;
      try {
        const ur = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
        });
        info = await ur.json();
      } catch { return fail('oauth_userinfo'); }

      const email = (info.email || '').trim().toLowerCase();
      // Odmítni neověřený e-mail (email_verified !== true; userinfo vrací boolean, snese i string).
      const emailVerified = info.email_verified === true || info.email_verified === 'true';
      if (!isValidEmail(email) || !emailVerified) return fail('oauth_email');

      // KRITICKÉ — propojení účtů: hledej podle e-mailu case-insensitive → přihlas do TÉHOŽ účtu.
      let user = await env.DB.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').bind(email).first();
      if (!user) {
        const trialEnd = new Date(Date.now() + 30*24*3600*1000).toISOString();
        await env.DB.prepare("INSERT INTO users (email, plan, trial_ends_at) VALUES (?, 'trial', ?)").bind(email, trialEnd).run();
        user = await env.DB.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').bind(email).first();
      }

      // Session identická s /auth/verify: JWT { sub, email, exp } + cookie SameSite=None.
      const sessionDays = rememberFlag === '1' ? 90 : 7;
      const maxAge = sessionDays * 24 * 3600;
      const jwt = await signJWT(
        { sub: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + maxAge },
        env.JWT_SECRET
      );
      const headers = new Headers({ 'Location': FRONTEND_URL });
      headers.append('Set-Cookie', `session=${jwt}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAge}`);
      headers.append('Set-Cookie', 'oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
      return new Response(null, { status: 302, headers });
    }

    // --- POST /api/demo-request --- (žádost o demo → e-mail majiteli + D1, rate limit 3/IP/hod)
    if (url.pathname === '/api/demo-request') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
      const name = (body.name || '').trim();
      const email = (body.email || '').trim();
      const phone = (body.phone || '').trim();
      const message = (body.message || '').trim();
      const utmSource = ((body.utm_source || '').trim().slice(0, 120)) || null;
      if (!name || !isValidEmail(email)) return json({ error: 'invalid_input' }, 400);
      if (name.length > 200 || phone.length > 60 || message.length > 4000) return json({ error: 'too_long' }, 400);

      // Rate limit: max 3 žádosti / IP / hodinu.
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
      try {
        const rl = await env.DB.prepare(
          'SELECT COUNT(*) AS c FROM demo_requests WHERE ip = ? AND created_at > ?'
        ).bind(ip, hourAgo).first();
        if (rl && rl.c >= 3) return json({ error: 'rate_limited' }, 429);
      } catch { /* tabulka ještě neexistuje (před migrací) → pokračuj */ }

      const createdAt = new Date().toISOString();
      try {
        await env.DB.prepare(
          'INSERT INTO demo_requests (name, email, phone, message, utm_source, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(name, email, phone || null, message || null, utmSource, ip, createdAt).run();
      } catch (e) {
        return json({ error: 'db_failed', detail: String(e?.message || e) }, 500);
      }

      // E-mail majiteli (Resend). Selhání e-mailu neshodí uložení — vrať ok.
      try {
        const esc = (s) => (s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'LegalID <login@legalid.cz>',
            reply_to: email,
            to: ['kuba.houser@gmail.com'],
            subject: `Legalid: žádost o demo od ${name}`,
            html: `<p><strong>Nová žádost o demo</strong></p>
              <p><strong>Jméno:</strong> ${esc(name)}<br>
              <strong>E-mail:</strong> ${esc(email)}<br>
              <strong>Telefon:</strong> ${esc(phone) || '—'}<br>
              <strong>utm_source:</strong> ${esc(utmSource) || '—'}</p>
              <p><strong>Zpráva:</strong><br>${esc(message) || '—'}</p>`,
          }),
        });
      } catch (e) { console.log('demo-request resend fail:', e?.message || e); }

      return json({ ok: true });
    }

    // --- POST /api/admin/sanctions/reimport (jen správce) ---
    if (url.pathname === '/api/admin/sanctions/reimport') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      const token = getSessionToken(request);
      const payload = token ? await verifyJWT(token, env.JWT_SECRET) : null;
      if (!payload || payload.email !== 'kuba.houser@gmail.com') return json({ error: 'forbidden' }, 403);
      try {
        const r = await importEuSanctions(env);   // { persons, entities }
        return json({ ok: true, ...r });
      } catch (e) {
        return json({ error: 'import_failed', message: String(e.message || e) }, 502);
      }
    }

    // --- POST /api/track ---
    if (url.pathname === '/api/track') {
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
          status: 405,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const sessionToken = getSessionToken(request);
      const payload = sessionToken ? await verifyJWT(sessionToken, env.JWT_SECRET) : null;

      if (!payload) {
        return new Response(JSON.stringify({ allowed: true, anonymous: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const user = await env.DB.prepare(
        'SELECT id, plan, trial_ends_at, dolozky_this_month, dolozky_month FROM users WHERE id = ?'
      ).bind(payload.sub).first();

      if (user.plan === 'pro') {
        return new Response(JSON.stringify({ allowed: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (user.plan === 'trial' && new Date(user.trial_ends_at) > new Date()) {
        return new Response(JSON.stringify({ allowed: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // free + vypršelý trial — měsíční limit 2
      const currentMonth = new Date().toISOString().slice(0, 7);
      let used = user.dolozky_month !== currentMonth ? 0 : (user.dolozky_this_month || 0);

      if (used >= 2) {
        return new Response(JSON.stringify({ allowed: false, reason: 'limit' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      used += 1;
      await env.DB.prepare(
        'UPDATE users SET dolozky_this_month = ?, dolozky_month = ? WHERE id = ?'
      ).bind(used, currentMonth, user.id).run();

      return new Response(JSON.stringify({ allowed: true, used, plan: 'free' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ════════════════ AML ════════════════
    if (url.pathname.startsWith('/api/aml/')) {
      const userId = await requireUserId(request, env);
      if (!userId) return json({ error: 'unauthorized' }, 401);

      // POST /api/aml/lookup/run — spustí všech 5 lustrací nad případem vlastníka
      if (url.pathname === '/api/aml/lookup/run') {
        if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        let b;
        try { b = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
        const caseId = b.case_id;
        if (!caseId) return json({ error: 'missing_case_id' }, 400);
        const amlCase = await env.DB.prepare(
          'SELECT * FROM aml_cases WHERE id = ? AND user_id = ?'
        ).bind(caseId, userId).first();
        if (!amlCase) return json({ error: 'not_found' }, 404);
        const results = await runAllLookups(env, amlCase);
        return json({ results });
      }

      // POST /api/aml/:caseId/terminate — ukončení kontroly (§ 15): status='terminated'
      const termM = url.pathname.match(/^\/api\/aml\/(\d+)\/terminate$/);
      if (termM) {
        if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        const caseId = termM[1];
        let b; try { b = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
        const owner = await env.DB.prepare('SELECT id FROM aml_cases WHERE id = ? AND user_id = ?').bind(caseId, userId).first();
        if (!owner) return json({ error: 'not_found' }, 404);
        const reason = String(b.reason || '').slice(0, 2000);
        const completedAt = new Date().toISOString();
        await env.DB.prepare(
          "UPDATE aml_cases SET status = 'terminated', terminated_reason = ?, completed_at = ? WHERE id = ? AND user_id = ?"
        ).bind(reason, completedAt, caseId, userId).run();
        return json({ ok: true, completed_at: completedAt });
      }

      // POST /api/aml/:caseId/analyze-document — AI analýza podpůrného dokumentu (Blok 3)
      const anaM = url.pathname.match(/^\/api\/aml\/(\d+)\/analyze-document$/);
      if (anaM) {
        if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        const caseId = anaM[1];
        let b; try { b = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
        const owner = await env.DB.prepare('SELECT id FROM aml_cases WHERE id = ? AND user_id = ?').bind(caseId, userId).first();
        if (!owner) return json({ error: 'not_found' }, 404);
        const { filename, mime, data_base64 } = b;
        if (!data_base64) return json({ error: 'missing_data' }, 400);
        const mt = mime || 'application/octet-stream';
        const block = mt === 'application/pdf'
          ? { type: 'document', source: { type: 'base64', media_type: mt, data: data_base64 } }
          : { type: 'image', source: { type: 'base64', media_type: mt, data: data_base64 } };
        const system = 'Jsi asistent AML kontroly v ČR. Analyzuj dokument. Vrať POUZE validní JSON bez markdownu: {"doc_type":"kupni_smlouva|vypis_uctu|darovaci_smlouva|potvrzeni|danove_priznani|jine","parties":[{"name","role"}],"amounts":[{"value","currency","context"}],"dates":[],"subject":"","source_indicators":[],"red_flags":[],"summary_cs":"2-3 věty"}. Red flags: zahraniční jurisdikce, hotovost, třetí strany, nesoulad částek, offshore, krypto.';
        let analysis;
        try {
          analysis = await anthropicJson(env, { system, userContent: [block, { type: 'text', text: 'Analyzuj přiložený dokument dle instrukcí a vrať JSON.' }], max_tokens: 1500 });
        } catch (e) {
          return json({ error: 'analyze_failed', message: String(e.message || e) }, 502);
        }
        const sha256 = await sha256Hex(data_base64);
        try {
          const r = await env.DB.prepare(
            `INSERT INTO aml_documents (case_id, doc_type, filename, mime_type, sha256, extracted_json, ai_summary, content_base64, content_size_bytes)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`
          ).bind(caseId, analysis.doc_type || 'jine', filename || null, mt, sha256,
                 JSON.stringify(analysis), analysis.summary_cs || null,
                 Math.floor(data_base64.length * 3 / 4)).run();
          return json({ ...analysis, sha256, document_id: r.meta.last_row_id });
        } catch (e) {
          return json({ error: 'db_failed', message: String(e.message || e) }, 500);
        }
      }

      // POST /api/aml/:caseId/check-consistency — AI porovnání účelu/zdroje s dokumenty (Blok 3)
      const consM = url.pathname.match(/^\/api\/aml\/(\d+)\/check-consistency$/);
      if (consM) {
        if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        const caseId = consM[1];
        let b; try { b = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
        const owner = await env.DB.prepare('SELECT id FROM aml_cases WHERE id = ? AND user_id = ?').bind(caseId, userId).first();
        if (!owner) return json({ error: 'not_found' }, 404);
        const context = {
          declared_purpose: b.purpose || '',
          source_of_funds_type: b.source_of_funds_type || '',
          source_of_funds_detail: b.source_of_funds || '',
          documents: Array.isArray(b.documents) ? b.documents : [],
        };
        const system = 'Porovnej deklarovaný účel a zdroj prostředků s daty z dokumentů. POUZE JSON: {"consistency":"consistent|partial|inconsistent","signals":[{"type","severity":"low|medium|high","description_cs"}],"summary_cs"}. Konzervativně: dokumenty nepokrývající zdroj = partial.';
        let result;
        try {
          result = await anthropicJson(env, { system, userContent: [{ type: 'text', text: JSON.stringify(context) }], max_tokens: 1000 });
        } catch (e) {
          return json({ error: 'consistency_failed', message: String(e.message || e) }, 502);
        }
        try {
          await env.DB.prepare('UPDATE aml_cases SET consistency_json = ? WHERE id = ? AND user_id = ?')
            .bind(JSON.stringify(result), caseId, userId).run();
        } catch { /* uložení konzistence nesmí shodit odpověď */ }
        return json(result);
      }

      // POST /api/aml/:caseId/risk-suggest — deterministická pravidla + AI návrh rizika (Blok 4)
      const rsM = url.pathname.match(/^\/api\/aml\/(\d+)\/risk-suggest$/);
      if (rsM) {
        if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        const caseId = rsM[1];
        let b; try { b = await request.json(); } catch { b = {}; }
        const c = await env.DB.prepare('SELECT * FROM aml_cases WHERE id = ? AND user_id = ?').bind(caseId, userId).first();
        if (!c) return json({ error: 'not_found' }, 404);
        const decl = b.client_declaration || {};

        // Poslední lustrace na typ.
        const { results: lkRows } = await env.DB.prepare(
          'SELECT lookup_type, result_status, matched_against, match_score FROM aml_lookups WHERE case_id = ? ORDER BY id'
        ).bind(caseId).all();
        const byType = {};
        for (const r of (lkRows || [])) byType[r.lookup_type] = r;

        // Podpůrné dokumenty (bez souboru) + jejich red flags.
        const { results: docRows } = await env.DB.prepare(
          'SELECT extracted_json FROM aml_documents WHERE case_id = ? AND content_base64 IS NULL'
        ).bind(caseId).all();
        const redFlags = [];
        for (const d of (docRows || [])) { const j = safeParse(d.extracted_json); if (j && Array.isArray(j.red_flags)) redFlags.push(...j.red_flags); }

        // Tvrdá pravidla (arch. rozhodnutí #3).
        const detFactors = [];
        let floor = 'nizke';
        const sancMatch = ['sanctions', 'sanctions_entity'].some(t => byType[t]?.result_status === 'match');
        if (sancMatch) {
          floor = maxRisk(floor, 'vysoke');
          detFactors.push({ factor: 'Sankční shoda', impact: 'critical', note_cs: 'Shoda klienta se sankčním seznamem — riziko vysoké, obchod nelze uskutečnit bez prověření (§ 15).' });
        }
        const pepHit = ['warning', 'match'].includes(byType.pep?.result_status);
        const declPep = decl.pep === 'is';
        if (pepHit || declPep) {
          floor = maxRisk(floor, 'stredni');
          detFactors.push({ factor: 'Politicky exponovaná osoba', impact: 'raises', note_cs: declPep ? 'Klient prohlásil, že je PEP — uplatněte zesílenou kontrolu (§ 4 odst. 5).' : 'Možná shoda s PEP databází — ověřte a uplatněte zesílenou kontrolu.' });
        }
        const noDocs = (docRows || []).length === 0;
        if (noDocs && c.deal_value_band === '15k_plus') {
          detFactors.push({ factor: 'Chybějící podpůrné dokumenty', impact: 'raises', note_cs: 'Vysoká hodnota obchodu (15 000 € a více) bez doložení původu prostředků.' });
        }

        const aiData = {
          subject_type: c.subject_type, relation_type: c.relation_type, deal_value_band: c.deal_value_band,
          deal_countries: c.deal_countries, purpose_category: c.purpose_category, business_purpose: c.business_purpose,
          source_of_funds_type: c.source_of_funds_type, source_of_funds: c.source_of_funds, client_occupation: c.client_occupation,
          consistency: safeParse(c.consistency_json),
          lookups: Object.values(byType).map(r => ({ type: r.lookup_type, status: r.result_status, matched: r.matched_against, score: r.match_score })),
          red_flags: redFlags, client_declaration: decl,
        };
        const system = 'Jsi AML analytik (zákon č. 253/2008 Sb., risk-based approach). Navrhni rizikový profil klienta. Zohledni: rizikové země (mimo EU/EHP zvyšují riziko), hodnotu obchodu, typ vztahu, konzistenci dokumentů, povolání vs. hodnotu obchodu, výsledky lustrací a red flags. Vrať POUZE validní JSON bez markdownu: {"suggested_level":"nizke|stredni|vysoke","factors":[{"factor":"...","impact":"neutral|raises|critical","note_cs":"..."}],"reasoning_cs":"3-4 věty"}.';
        let ai;
        try {
          ai = await anthropicJson(env, { system, userContent: [{ type: 'text', text: JSON.stringify(aiData) }], max_tokens: 1200 });
        } catch {
          ai = { suggested_level: floor, factors: [], reasoning_cs: 'Automatický návrh AI je dočasně nedostupný; navržená úroveň vychází z tvrdých pravidel (sankce, PEP, dokumenty). Posuďte prosím riziko sami.' };
        }
        const finalLevel = maxRisk(floor, ['nizke', 'stredni', 'vysoke'].includes(ai.suggested_level) ? ai.suggested_level : 'nizke');
        const factors = [...detFactors, ...(Array.isArray(ai.factors) ? ai.factors : [])];
        const suggestion = { suggested_level: finalLevel, factors, reasoning_cs: ai.reasoning_cs || '', deterministic_floor: floor };

        try {
          await env.DB.prepare('UPDATE aml_cases SET ai_risk_suggestion = ?, ai_risk_reasoning = ? WHERE id = ? AND user_id = ?')
            .bind(finalLevel, JSON.stringify(suggestion), caseId, userId).run();
          if (b.client_declaration) {
            await env.DB.prepare('UPDATE aml_cases SET client_declaration_json = ? WHERE id = ? AND user_id = ?')
              .bind(JSON.stringify({ ...decl, timestamp: new Date().toISOString() }), caseId, userId).run();
          }
        } catch { /* uložení nesmí shodit odpověď */ }
        return json(suggestion);
      }

      // POST /api/aml/:caseId/risk-decision — závazné rozhodnutí + validace odůvodnění (Blok 4)
      const rdM = url.pathname.match(/^\/api\/aml\/(\d+)\/risk-decision$/);
      if (rdM) {
        if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        const caseId = rdM[1];
        let b; try { b = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
        const c = await env.DB.prepare('SELECT ai_risk_suggestion FROM aml_cases WHERE id = ? AND user_id = ?').bind(caseId, userId).first();
        if (!c) return json({ error: 'not_found' }, 404);
        const finalLevel = b.final_risk_level;
        if (!['nizke', 'stredni', 'vysoke'].includes(finalLevel)) return json({ error: 'invalid_level' }, 400);
        const decl = b.client_declaration || {};
        if (!decl.pep || !decl.sanctions_confirmed || !decl.source_confirmed) return json({ error: 'declaration_incomplete' }, 400);
        const justification = String(b.risk_justification || '').trim();
        const deviates = finalLevel !== (c.ai_risk_suggestion || finalLevel);
        const pepYes = decl.pep === 'is';
        if ((deviates || pepYes) && !justification) return json({ error: 'justification_required' }, 400);
        const decidedAt = new Date().toISOString();
        await env.DB.prepare(
          'UPDATE aml_cases SET final_risk_level = ?, risk_justification = ?, risk_decided_at = ?, client_declaration_json = ?, current_step = MAX(current_step, 4) WHERE id = ? AND user_id = ?'
        ).bind(finalLevel, justification || null, decidedAt, JSON.stringify({ ...decl, timestamp: decidedAt }), caseId, userId).run();
        return json({ ok: true, final_risk_level: finalLevel, risk_decided_at: decidedAt });
      }

      // POST /api/aml/:caseId/complete — dokončení kontroly (Blok 5): status='completed'
      const cmpM = url.pathname.match(/^\/api\/aml\/(\d+)\/complete$/);
      if (cmpM) {
        if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        const caseId = cmpM[1];
        let b; try { b = await request.json(); } catch { b = {}; }
        const c = await env.DB.prepare('SELECT final_risk_level, risk_decided_at FROM aml_cases WHERE id = ? AND user_id = ?').bind(caseId, userId).first();
        if (!c) return json({ error: 'not_found' }, 404);
        if (!c.risk_decided_at) return json({ error: 'risk_not_decided' }, 400);
        // Interval revize: nízké +36 m, střední +24 m, vysoké +12 m.
        const months = c.final_risk_level === 'vysoke' ? 12 : (c.final_risk_level === 'stredni' ? 24 : 36);
        const now = new Date();
        const review = new Date(now); review.setMonth(review.getMonth() + months);
        const completedAt = now.toISOString();
        const nextReview = review.toISOString();
        const sha = String(b.record_sha256 || '').slice(0, 64) || null;
        await env.DB.prepare(
          "UPDATE aml_cases SET status = 'completed', final_pdf_generated = 1, completed_at = ?, next_review_due = ?, record_sha256 = ? WHERE id = ? AND user_id = ?"
        ).bind(completedAt, nextReview, sha, caseId, userId).run();
        return json({ ok: true, completed_at: completedAt, next_review_due: nextReview });
      }

      // POST /api/aml/case/create — založí nový případ
      if (url.pathname === '/api/aml/case/create') {
        if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        // Rozdělané případy uzavři jako 'abandoned', ať se nehromadí in_progress.
        await env.DB.prepare(
          "UPDATE aml_cases SET status = 'abandoned' WHERE user_id = ? AND status = 'in_progress'"
        ).bind(userId).run();
        const caseNumber = genCaseNumber();
        const r = await env.DB.prepare(
          "INSERT INTO aml_cases (user_id, status, current_step, case_number) VALUES (?, 'in_progress', 0, ?)"
        ).bind(userId, caseNumber).run();
        return json({ case_id: r.meta.last_row_id, case_number: caseNumber });
      }

      // GET /api/aml/ares/:ico — předvyplnění firmy z ARES (subject_type='po')
      const aresM = url.pathname.match(/^\/api\/aml\/ares\/(\d{1,10})$/);
      if (aresM) {
        if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        try {
          return json(await fetchAresSubject(aresM[1]));
        } catch (e) {
          return json({ error: 'ares_failed', message: String(e.message || e) }, 502);
        }
      }

      // GET /api/aml/case/:id/lookups — uložené výsledky lustrací (poslední na typ) vč. checked_at.
      const lkM = url.pathname.match(/^\/api\/aml\/case\/(\d+)\/lookups$/);
      if (lkM) {
        if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        const caseId = lkM[1];
        const owner = await env.DB.prepare('SELECT id FROM aml_cases WHERE id = ? AND user_id = ?').bind(caseId, userId).first();
        if (!owner) return json({ error: 'not_found' }, 404);
        const { results } = await env.DB.prepare(
          `SELECT lookup_type, result_status, result_details, matched_against, match_score, checked_at
             FROM aml_lookups WHERE case_id = ? ORDER BY id`
        ).bind(caseId).all();
        // poslední záznam na typ (novější id přepíše starší)
        const byType = new Map();
        for (const r of (results || [])) {
          let details = r.result_details;
          try { details = JSON.parse(r.result_details); } catch { /* ponech string */ }
          byType.set(r.lookup_type, {
            lookup_type: r.lookup_type, status: r.result_status, details,
            matched_against: r.matched_against || null, match_score: r.match_score ?? null,
            source: null,   // source se do aml_lookups neukládá; PEP detail se na reloadu vykreslí obecně
            checked_at: r.checked_at || null,
          });
        }
        return json({ results: [...byType.values()] });
      }

      // GET /api/aml/clients — uložení klienti (distinct z případů uživatele, nejnovější výskyt)
      // Zdroj pro dlaždici „Ze seznamu" v kroku Údaje klienta.
      if (url.pathname === '/api/aml/clients') {
        if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        // Klíč klienta = číslo dokladu, jinak jméno+příjmení+nar. Bereme nejnovější případ na klíč.
        const { results } = await env.DB.prepare(
          `SELECT client_name, client_surname, client_birth_date, client_birth_place,
                  client_address, client_nationality, client_doc_type, client_doc_number,
                  client_doc_issued_at, client_doc_valid_until, client_gender, client_rc, client_ico,
                  MAX(created_at) AS last_seen
             FROM aml_cases
            WHERE user_id = ? AND (client_name IS NOT NULL OR client_surname IS NOT NULL)
            GROUP BY COALESCE(NULLIF(client_doc_number,''),
                              client_name || '|' || client_surname || '|' || COALESCE(client_birth_date,''))
            ORDER BY last_seen DESC
            LIMIT 200`
        ).bind(userId).all();
        return json({ clients: results || [] });
      }

      // GET /api/aml/cases — seznam případů uživatele (Archiv i „rozdělaná kontrola")
      if (url.pathname === '/api/aml/cases') {
        if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        const { results } = await env.DB.prepare(
          `SELECT id, case_number, status, current_step, identification_method, subject_type,
                  client_name, client_surname, company_name, final_risk_level,
                  created_at, completed_at, next_review_due, terminated_reason
             FROM aml_cases WHERE user_id = ? ORDER BY created_at DESC`
        ).bind(userId).all();
        return json({ cases: results || [] });
      }

      // GET /api/aml/case/:id/documents — metadata podpůrných dokumentů (pro archiv/regeneraci)
      const docsM = url.pathname.match(/^\/api\/aml\/case\/(\d+)\/documents$/);
      if (docsM) {
        if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
        const caseId = docsM[1];
        const owner = await env.DB.prepare('SELECT id FROM aml_cases WHERE id = ? AND user_id = ?').bind(caseId, userId).first();
        if (!owner) return json({ error: 'not_found' }, 404);
        const { results } = await env.DB.prepare(
          'SELECT doc_type, filename, sha256, ai_summary FROM aml_documents WHERE case_id = ? AND content_base64 IS NULL ORDER BY id'
        ).bind(caseId).all();
        return json({ documents: (results || []).map(r => ({ doc_type: r.doc_type, filename: r.filename, sha256: r.sha256, summary: r.ai_summary })) });
      }

      // /api/aml/case/:id  a  /api/aml/case/:id/document
      const m = url.pathname.match(/^\/api\/aml\/case\/(\d+)(\/document)?$/);
      if (m) {
        const caseId = m[1];
        const isDoc = !!m[2];

        // jen vlastník
        const amlCase = await env.DB.prepare(
          'SELECT * FROM aml_cases WHERE id = ? AND user_id = ?'
        ).bind(caseId, userId).first();
        if (!amlCase) return json({ error: 'not_found' }, 404);

        // POST /api/aml/case/:id/document — uložení dokumentu (base64)
        if (isDoc) {
          if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
          let b;
          try { b = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
          const { doc_type, filename, content_base64, ai_extracted_data } = b;
          if (!doc_type) return json({ error: 'missing_doc_type' }, 400);
          const size = content_base64 ? Math.floor(content_base64.length * 3 / 4) : 0;
          const aiData = ai_extracted_data == null ? null
            : (typeof ai_extracted_data === 'string' ? ai_extracted_data : JSON.stringify(ai_extracted_data));
          const r = await env.DB.prepare(
            `INSERT INTO aml_documents (case_id, doc_type, filename, content_base64, content_size_bytes, ai_extracted_data)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(caseId, doc_type, filename || null, content_base64 || null, size, aiData).run();
          return json({ ok: true, document_id: r.meta.last_row_id });
        }

        // GET /api/aml/case/:id — stav případu
        if (request.method === 'GET') return json({ case: amlCase });

        // PATCH /api/aml/case/:id — částečný update (whitelist sloupců)
        if (request.method === 'PATCH') {
          let b;
          try { b = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
          const ALLOWED = [
            'client_id', 'status', 'current_step', 'identification_method',
            'client_name', 'client_surname', 'client_birth_date', 'client_birth_place',
            'client_address', 'client_nationality', 'client_doc_type', 'client_doc_number',
            'client_doc_valid_until', 'client_doc_issued_at', 'client_gender',
            'client_rc', 'client_ico',
            'subject_type', 'company_name', 'company_address',
            'acting_person_role', 'acting_person_note', 'esm_checked', 'esm_note',
            'business_purpose', 'ai_risk_suggestion',
            'ai_risk_reasoning', 'final_risk_level', 'risk_decided_at',
            'final_pdf_generated', 'completed_at', 'next_review_due',
            // Týden 4 (aml_v6): kroky Účel / Riziko / Záznam + originál jména (kromě case_number, record_sha256).
            'client_name_original', 'client_occupation',
            'relation_type', 'deal_value_band', 'deal_countries', 'purpose_category',
            'source_of_funds_type', 'source_of_funds',
            'consistency_json', 'client_declaration_json', 'verifier_declaration_json',
            'risk_justification', 'terminated_reason',
          ];
          const keys = Object.keys(b).filter(k => ALLOWED.includes(k));
          if (keys.length === 0) return json({ ok: true, updated: 0 });
          const setClause = keys.map(k => `${k} = ?`).join(', ');
          const values = keys.map(k => b[k]);
          await env.DB.prepare(
            `UPDATE aml_cases SET ${setClause} WHERE id = ? AND user_id = ?`
          ).bind(...values, caseId, userId).run();
          return json({ ok: true, updated: keys.length });
        }

        return json({ error: 'method_not_allowed' }, 405);
      }

      return json({ error: 'not_found' }, 404);
    }

    // ════════════════ Jednotlivé lustrace (vyžadují session) ════════════════
    if (url.pathname.startsWith('/api/lookup/')) {
      const userId = await requireUserId(request, env);
      if (!userId) return json({ error: 'unauthorized' }, 401);
      const p = url.pathname;
      const q = url.searchParams;

      if (p === '/api/lookup/mvcr' && request.method === 'GET') {
        return json(await lookupMvcr(q.get('doc_number'), q.get('doc_type')));
      }
      if (p === '/api/lookup/isir' && request.method === 'GET') {
        return json(await lookupIsir(q.get('surname') || q.get('name'), q.get('jmeno'), q.get('birthdate')));
      }
      if (p === '/api/lookup/ares' && request.method === 'GET') {
        return json(await lookupAres(q.get('ico')));
      }
      if (p === '/api/lookup/sanctions' && request.method === 'POST') {
        let b; try { b = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
        return json(await lookupSanctions(env, b.name, b.birth_date));
      }
      if (p === '/api/lookup/pep' && request.method === 'POST') {
        let b; try { b = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
        return json(await lookupPep(env, b.name, b.birth_date));
      }
      return json({ error: 'not_found' }, 404);
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

    const { images, mode, side, multi } = body;
    if (!Array.isArray(images) || images.length === 0) {
      return new Response(JSON.stringify({ error: 'missing_images' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // mode: 'dolozka' (default, beze změny) | 'aml' (bohatší extrakce)
    // multi: true → všechna média jsou jeden doklad (přední+zadní / více stran / PDF)
    const isAml = mode === 'aml';
    const systemPrompt = isAml ? AML_SYSTEM_PROMPT : SYSTEM_PROMPT;
    const userPrompt = isAml ? amlUserPrompt(multi ? 'multi' : side) : USER_PROMPT;

    // Obrázky → image block, PDF → document block (Anthropic podporuje base64 PDF).
    const imageContent = images.map(img => {
      const mt = img.media_type || 'image/jpeg';
      const kind = mt === 'application/pdf' ? 'document' : 'image';
      return { type: kind, source: { type: 'base64', media_type: mt, data: img.data } };
    });

    const anthropicPayload = {
      model: 'claude-sonnet-4-6',
      max_tokens: isAml ? 1500 : 1024,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            ...imageContent,
            { type: 'text', text: userPrompt },
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

  // Denní cron (viz wrangler.toml crons) — přepíše EU sankce v D1 aktuálním seznamem.
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const r = await importEuSanctions(env);
        console.log(`[cron] EU sankce: parsed=${r.parsed} inserted=${r.inserted}`);
      } catch (e) {
        console.error('[cron] import EU sankcí selhal:', e?.message || e);
      }
    })());
  },
};
