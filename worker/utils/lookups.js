// legalid.cz — worker/utils/lookups.js
// Pět lustrací pro AML krok 2. Každá vrací jednotný tvar:
//   { status: 'clean'|'warning'|'match'|'error', details, matched_against?, match_score? }
// Nikdy nevyhazuje ven — chyba se mapuje na status 'error' (volající je odolný).
//
// Stav zdrojů (týden 3):
//   ARES      — plně funkční (oficiální REST, bez klíče)
//   sanctions — plně funkční (D1 + fuzzy)
//   pep       — D1 (ruční CZ) + OpenSanctions fallback (vyžaduje OPENSANCTIONS_API_KEY)
//   mvcr,isir — best-effort scraping, konzervativně: při nejistotě 'error' (ne falešné 'clean')

import { normalizeName, findBestMatch } from './fuzzy.js';

// Načte kandidáty z D1 tabulky předfiltrem přes tokeny jména (LIKE), pak fuzzy v JS.
async function dbCandidates(db, table, name) {
  const nn = normalizeName(name);
  const tokens = nn.split(' ').filter(t => t.length >= 3);
  // BEZPEČNOSTNÍ GUARD: bez použitelných latinkových tokenů (vstup jen v azbuce/
  // arabštině → normalizace prázdná) NEHLEDEJ podle prázdného vzoru — matchoval by
  // VŠECHNY záznamy s prázdným name_normalized a dával falešné shody se skóre ~1.0.
  if (!tokens.length) return [];
  const likeVals = tokens.map(t => `%${t}%`);
  // Hledej každý token v name_normalized NEBO v aliases (latinkové přepisy — LIKE je
  // pro ASCII case-insensitive), aby se našel i záznam s primárním jménem v azbuce.
  const where = likeVals.map(() => '(name_normalized LIKE ? OR aliases LIKE ?)').join(' OR ');
  const binds = likeVals.flatMap(v => [v, v]);
  const sql = `SELECT * FROM ${table} WHERE ${where} LIMIT 500`;
  const { results } = await db.prepare(sql).bind(...binds).all();
  return results || [];
}

// Rozbalí i aliasy (u sankcí) do samostatných kandidátů, ať fuzzy matchuje i alternativní jména.
function expandAliases(rows) {
  const out = [];
  for (const r of rows) {
    out.push({ row: r, cand_name: r.full_name, name_normalized: r.name_normalized });
    if (r.aliases) {
      try {
        for (const a of JSON.parse(r.aliases)) {
          if (a) out.push({ row: r, cand_name: a, name_normalized: normalizeName(a) });
        }
      } catch { /* ignore malformed aliases */ }
    }
  }
  return out;
}

// ── 1) MVČR — neplatné doklady ──
// ASP.NET WebForms (aplikace.mv.gov.cz), stavový VIEWSTATE round-trip + session cookie.
// Pole formuláře (ověřeno 07/2026): ctl00$Application$txtCisloDokladu, ...$ddlTypDokladu
// (1=OP, 2=cestovní pas, 5=evropský zbrojní pas), ...$cmdZobraz.
// Výsledková věta: "Doklad s číslem X nebyl nalezen v databázi neplatných dokladů" = clean.
const MVCR_URL = 'https://aplikace.mv.gov.cz/neplatne-doklady/';
function mvcrDocType(clientDocType) {
  const t = (clientDocType || '').toLowerCase();
  if (t.includes('pas')) return '2';
  if (t.includes('zbroj')) return '5';
  return '1';   // default: občanský průkaz
}
export async function lookupMvcr(docNumber, docType) {
  if (!docNumber) return { status: 'clean', details: { note: 'Číslo dokladu nezadáno — přeskočeno.' } };
  try {
    const pageRes = await fetch(MVCR_URL, { headers: { 'User-Agent': 'legalid-aml/1.0' } });
    if (!pageRes.ok) throw new Error(`page ${pageRes.status}`);
    const cookie = (pageRes.headers.get('set-cookie') || '').split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
    const html = await pageRes.text();
    const hidden = name => (html.match(new RegExp(`id="${name}"[^>]*value="([^"]*)"`)) || [])[1] || '';
    const viewstate = hidden('__VIEWSTATE');
    if (!viewstate) throw new Error('no viewstate');

    const form = new URLSearchParams({
      __VIEWSTATE: viewstate,
      __VIEWSTATEGENERATOR: hidden('__VIEWSTATEGENERATOR'),
      __EVENTVALIDATION: hidden('__EVENTVALIDATION'),
      'ctl00$Application$ddlTypDokladu': mvcrDocType(docType),
      'ctl00$Application$txtCisloDokladu': String(docNumber),
      'ctl00$Application$cmdZobraz': 'Ověřit',
    });
    const res = await fetch(MVCR_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'legalid-aml/1.0',
        ...(cookie ? { 'Cookie': cookie } : {}),
      },
      body: form.toString(),
    });
    // Číslo i výsledek jsou obalené HTML tagy (<b>, <strong>) → před detekcí tagy odstranit.
    const body = (await res.text()).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    // Výsledková věta o konkrétním čísle dokladu.
    const sentence = (body.match(new RegExp(`Doklad s číslem\\s*${String(docNumber)}[^.]*`, 'i')) || [])[0] || '';
    if (/nebyl\s+nalezen/i.test(sentence)) {
      return { status: 'clean', details: { note: 'Doklad není v evidenci neplatných dokladů MVČR.', doc_number: docNumber } };
    }
    if (sentence && /(neplatn|evidov|veden|nalezen)/i.test(sentence)) {
      return { status: 'match', details: { note: 'Doklad nalezen v evidenci neplatných dokladů MVČR.', doc_number: docNumber, vysledek: sentence.trim().slice(0, 200) } };
    }
    return { status: 'error', details: 'Automatické ověření MVČR nebylo jednoznačné — zkontrolujte ručně na aplikace.mv.gov.cz/neplatne-doklady.' };
  } catch (e) {
    return { status: 'error', details: `Rejstřík MVČR byl nedostupný (${e.message}).` };
  }
}

// ── 2) ISIR — insolvenční rejstřík ──
// Živý dotaz na oficiální veřejnou SOAP službu ISIRWSCUZK (anonymní, zdarma) —
// getIsirWsCuzkData. Web UI vyžaduje CAPTCHA, ale tato služba ne. Vrací strukturovaná
// data dlužníků (spisová značka, soud, stav, data úpadku) → filtrujeme dle data narození.
const ISIR_CUZK_URL = 'https://isir.justice.cz:8443/isir_cuzk_ws/IsirWsCuzkService';

const xmlEsc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// "DD.MM.YYYY" | "YYYY-MM-DD" | "YYYY-MM-DDZ" → "YYYY-MM-DD" (jinak '')
function normDate(d) {
  if (!d) return '';
  const s = String(d).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}
function isirRecords(xml) {
  const out = [];
  const blocks = xml.split('<data>').slice(1);
  for (const b of blocks) {
    const seg = b.split('</data>')[0];
    const g = t => { const m = seg.match(new RegExp(`<${t}>([^<]*)</${t}>`)); return m ? m[1].trim() : ''; };
    out.push({
      jmeno: g('jmeno'), nazevOsoby: g('nazevOsoby'), ic: g('ic'),
      datumNarozeni: g('datumNarozeni').replace(/Z$/, ''),
      spis: [g('druhVec'), g('bcVec') && `${g('bcVec')}/${g('rocnik')}`].filter(Boolean).join(' '),
      soud: g('nazevOrganizace'), stav: g('druhStavKonkursu'),
      zahajeni: g('datumPmZahajeniUpadku').replace(/Z$/, ''),
      ukonceni: g('datumPmUkonceniUpadku').replace(/Z$/, ''),
      url: g('urlDetailRizeni'),
    });
  }
  return out;
}

export async function lookupIsir(surname, firstName, birthdate) {
  if (!surname && !firstName) return { status: 'clean', details: { note: 'Jméno nezadáno — přeskočeno.' } };
  const bd = normDate(birthdate);
  const body =
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:typ="http://isirws.cca.cz/types/">` +
    `<soapenv:Body><typ:getIsirWsCuzkDataRequest>` +
    (surname ? `<nazevOsoby>${xmlEsc(surname)}</nazevOsoby>` : '') +
    (firstName ? `<jmeno>${xmlEsc(firstName)}</jmeno>` : '') +
    (bd ? `<datumNarozeni>${bd}</datumNarozeni>` : '') +
    `<maxPocetVysledku>20</maxPocetVysledku>` +
    `<vyhledatBezDiakritiky>T</vyhledatBezDiakritiky>` +
    `</typ:getIsirWsCuzkDataRequest></soapenv:Body></soapenv:Envelope>`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let res;
    try {
      res = await fetch(ISIR_CUZK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '""' },
        body, signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }
    const text = await res.text();
    if (/<soap:Fault>|<faultstring>/i.test(text)) {
      const err = (text.match(/<faultstring>([^<]*)</i) || [])[1] || 'neznámá chyba';
      return { status: 'error', details: `ISIR dotaz odmítnut (${err.slice(0, 120)}).` };
    }
    if (/Prázdný výsledek/i.test(text) || !/<data>/.test(text)) {
      return { status: 'clean', details: { note: 'Žádný záznam v insolvenčním rejstříku.' } };
    }
    let recs = isirRecords(text);
    // Když známe datum narození, ponech jen odpovídající osoby (stejné příjmení, jiná osoba → clean).
    if (bd) {
      const matched = recs.filter(r => normDate(r.datumNarozeni) === bd);
      if (matched.length) recs = matched;
      else return { status: 'clean', details: { note: 'Osoba shodného jména v insolvenci nalezena, ale s jiným datem narození — nejde o klienta.' } };
    }
    if (!recs.length) return { status: 'clean', details: { note: 'Žádný odpovídající záznam v insolvenčním rejstříku.' } };
    const who = [firstName, surname].filter(Boolean).join(' ');
    const note = bd
      ? `Klient (${who}, nar. ${bd}) figuruje v ${recs.length} insolvenčních řízeních.`
      : `Nalezeno ${recs.length} řízení osob jménem ${who}. Bez data narození nelze odlišit jmenovce — porovnejte datum narození u jednotlivých záznamů níže.`;
    return {
      status: 'warning',
      matched_against: bd ? `${who}, nar. ${bd}` : who,
      details: {
        note,
        rizeni: recs.slice(0, 10).map(r => ({
          spis: r.spis, soud: r.soud, stav: r.stav,
          zahajeni: r.zahajeni || null, ukonceni: r.ukonceni || null,
          nar: r.datumNarozeni || null, url: r.url || null,
        })),
      },
    };
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'časový limit' : e.message;
    return { status: 'error', details: `Insolvenční rejstřík byl nedostupný (${msg}).` };
  }
}

// ── 2b) ISIR pro firmu (dotaz podle IČO) — pro subject_type='po' ──
export async function lookupIsirCompany(ico) {
  const clean = String(ico || '').replace(/\s/g, '');
  if (!clean) return { status: 'clean', details: { note: 'IČO nezadáno — přeskočeno.' } };
  const body =
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:typ="http://isirws.cca.cz/types/">` +
    `<soapenv:Body><typ:getIsirWsCuzkDataRequest>` +
    `<ic>${xmlEsc(clean)}</ic>` +
    `<maxPocetVysledku>20</maxPocetVysledku>` +
    `<vyhledatBezDiakritiky>T</vyhledatBezDiakritiky>` +
    `</typ:getIsirWsCuzkDataRequest></soapenv:Body></soapenv:Envelope>`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let res;
    try {
      res = await fetch(ISIR_CUZK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '""' },
        body, signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }
    const text = await res.text();
    if (/<soap:Fault>|<faultstring>/i.test(text)) {
      const err = (text.match(/<faultstring>([^<]*)</i) || [])[1] || 'neznámá chyba';
      return { status: 'error', details: `ISIR dotaz odmítnut (${err.slice(0, 120)}).` };
    }
    if (/Prázdný výsledek/i.test(text) || !/<data>/.test(text)) {
      return { status: 'clean', details: { note: 'Firma není v insolvenčním rejstříku.' } };
    }
    const recs = isirRecords(text);
    if (!recs.length) return { status: 'clean', details: { note: 'Firma není v insolvenčním rejstříku.' } };
    return {
      status: 'warning',
      matched_against: `IČO ${clean}`,
      details: {
        note: `Firma (IČO ${clean}) figuruje v ${recs.length} insolvenčních řízeních.`,
        rizeni: recs.slice(0, 10).map(r => ({
          spis: r.spis, soud: r.soud, stav: r.stav,
          zahajeni: r.zahajeni || null, ukonceni: r.ukonceni || null, url: r.url || null,
        })),
      },
    };
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'časový limit' : e.message;
    return { status: 'error', details: `Insolvenční rejstřík byl nedostupný (${msg}).` };
  }
}

// ── 3) ARES — ekonomické subjekty ──
// Sdílené jádro: stáhne a naparsuje subjekt z ARES. { found:false } když 404,
// jinak { found:true, ico, name, address, active, zanik }. Vyhazuje jen při chybě sítě.
export async function fetchAresSubject(ico) {
  const clean = String(ico || '').replace(/\s/g, '');
  const res = await fetch(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${clean}`, {
    headers: { 'Accept': 'application/json' },
  });
  if (res.status === 404) return { found: false, ico: clean };
  if (!res.ok) throw new Error(`http ${res.status}`);
  const d = await res.json();
  return {
    found: true, ico: clean,
    name: d.obchodniJmeno || null,
    address: d.sidlo?.textovaAdresa || null,
    active: !d.datumZaniku,
    zanik: d.datumZaniku || null,
  };
}

export async function lookupAres(ico) {
  if (!ico) return { status: 'clean', details: { note: 'Klient nemá IČO — ARES přeskočeno.' } };
  try {
    const s = await fetchAresSubject(ico);
    if (!s.found) return { status: 'warning', details: { note: 'Subjekt s tímto IČO nebyl v ARES nalezen.', ico: s.ico } };
    return {
      status: s.active ? 'clean' : 'warning',
      details: { ico: s.ico, name: s.name, address: s.address, active: s.active, zanik: s.zanik },
    };
  } catch (e) {
    return { status: 'error', details: `ARES byl nedostupný (${e.message}).` };
  }
}

// Odstraní právní formy (s.r.o., a.s., GmbH, Ltd…) jako samostatné tokeny,
// aby fuzzy porovnání firem neselhalo na koncovce. Vrací normalizovaný název.
const LEGAL_PATTERNS = [
  /\bspol s r o\b/g, /\bs r o\b/g, /\ba s\b/g, /\bk s\b/g, /\bv o s\b/g, /\bz s\b/g, /\bo p s\b/g,
  /\bgmbh\b/g, /\bag\b/g, /\bltd\b/g, /\bllc\b/g, /\binc\b/g, /\bcorp\b/g,
  /\bs a\b/g, /\bb v\b/g, /\booo\b/g, /\bzao\b/g, /\bpao\b/g, /\bao\b/g, /\bse\b/g,
];
export function stripLegalForms(name) {
  let n = normalizeName(name);   // lowercase, bez diakritiky a interpunkce
  for (const p of LEGAL_PATTERNS) n = n.replace(p, ' ');
  return n.replace(/\s+/g, ' ').trim();
}

// ── 4b) Sankční entity (firmy) — D1 sanctions_entities ──
export async function lookupSanctionsEntity(env, companyName) {
  if (!companyName) return { status: 'clean', details: { note: 'Název firmy nezadán — přeskočeno.' } };
  try {
    const needle = stripLegalForms(companyName);
    const tokens = needle.split(' ').filter(t => t.length >= 3);
    const likeVals = (tokens.length ? tokens : [needle]).map(t => `%${t}%`);
    // Token hledej v name_normalized NEBO aliases (stejný pattern jako u osob).
    const where = likeVals.map(() => '(name_normalized LIKE ? OR aliases LIKE ?)').join(' OR ');
    const binds = likeVals.flatMap(v => [v, v]);
    const { results } = await env.DB.prepare(
      `SELECT * FROM sanctions_entities WHERE ${where} LIMIT 500`
    ).bind(...binds).all();
    const rows = results || [];
    const cands = [];
    for (const r of rows) {
      cands.push({ row: r, cand_name: r.full_name, name_normalized: stripLegalForms(r.full_name) });
      if (r.aliases) {
        try { for (const a of JSON.parse(r.aliases)) if (a) cands.push({ row: r, cand_name: a, name_normalized: stripLegalForms(a) }); }
        catch { /* ignore */ }
      }
    }
    const { match, score } = findBestMatch(needle, cands, 0.85);
    if (match) {
      const r = match.row;
      return {
        status: 'match', matched_against: match.cand_name, match_score: Number(score.toFixed(3)),
        details: { source: r.source, full_name: r.full_name, nationality: r.nationality, reason: r.reason },
      };
    }
    return { status: 'clean', details: { note: 'Žádná shoda se sankčním seznamem firem (EU).', checked: rows.length } };
  } catch (e) {
    return { status: 'error', details: `Sankční kontrola firem selhala (${e.message}).` };
  }
}

// ── 4) Sankce (D1) ──
export async function lookupSanctions(env, name, birthDate) {
  if (!name) return { status: 'clean', details: { note: 'Jméno nezadáno — přeskočeno.' } };
  try {
    const rows = await dbCandidates(env.DB, 'sanctions', name);
    const cands = expandAliases(rows);
    const { match, score } = findBestMatch(name, cands, 0.85);
    if (match) {
      const r = match.row;
      return {
        status: 'match',
        matched_against: match.cand_name,
        match_score: Number(score.toFixed(3)),
        details: {
          source: r.source, full_name: r.full_name,
          birth_date: r.birth_date, nationality: r.nationality, reason: r.reason,
          client_birth_date: birthDate || null,
        },
      };
    }
    return { status: 'clean', details: { note: 'Žádná shoda se sankčním seznamem (EU).', checked: rows.length } };
  } catch (e) {
    return { status: 'error', details: `Sankční kontrola selhala (${e.message}).` };
  }
}

// ── 5) PEP — nejdřív D1 (ruční CZ), pak OpenSanctions ──
export async function lookupPep(env, name, birthDate) {
  if (!name) return { status: 'clean', source: 'cz_manual', details: { note: 'Jméno nezadáno — přeskočeno.' } };
  try {
    // Krok 1 — ruční CZ seznam v D1 (přísnější threshold 0.90 kvůli českým jménům).
    // expandAliases sjednocuje chování se sankcemi; při prázdných aliases (default '')
    // se rozbalí jen primární jméno, tj. beze změny oproti dosavadnímu chování.
    const rows = await dbCandidates(env.DB, 'pep', name);
    const cands = expandAliases(rows);
    const { match, score } = findBestMatch(name, cands, 0.90);
    if (match) {
      const r = match.row;
      return {
        status: 'warning', source: 'cz_manual',
        matched_against: match.cand_name, match_score: Number(score.toFixed(3)),
        details: { position: r.position, organization: r.organization, active_since: r.active_since, active_until: r.active_until },
      };
    }

    // Krok 2 — OpenSanctions (vyžaduje API klíč; bez klíče degradujeme).
    if (!env.OPENSANCTIONS_API_KEY) {
      return { status: 'clean', source: 'cz_manual', details: { note: 'Bez shody v CZ seznamu. OpenSanctions přeskočeno (chybí OPENSANCTIONS_API_KEY).' } };
    }
    const osRes = await fetch('https://api.opensanctions.org/match/peps?algorithm=best', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `ApiKey ${env.OPENSANCTIONS_API_KEY}` },
      body: JSON.stringify({ queries: { q1: { schema: 'Person', properties: { name: [name], ...(birthDate ? { birthDate: [birthDate] } : {}) } } } }),
    });
    if (!osRes.ok) throw new Error(`OpenSanctions http ${osRes.status}`);
    const data = await osRes.json();
    const top = data?.responses?.q1?.results?.[0];
    if (top && top.score >= 0.70) {
      const props = top.properties || {};
      return {
        status: 'warning', source: 'opensanctions',
        matched_against: top.caption, match_score: Number(top.score.toFixed(3)),
        details: {
          caption: top.caption || null,
          countries: props.country || top.countries || null,   // ISO kódy zemí
          positions: props.position || null,                    // názvy funkcí
          topics: props.topics || null,                         // role.pep, role.pol …
          datasets: top.datasets || null,                       // zdrojové databáze
          birth_date: props.birthDate || null,
        },
      };
    }
    return { status: 'clean', source: 'opensanctions', details: { note: 'Žádná shoda v OpenSanctions PEP.' } };
  } catch (e) {
    return { status: 'error', source: 'cz_manual', details: `PEP kontrola selhala (${e.message}).` };
  }
}

// ── Regresní selftest sankčního screeningu (volá cron po importu + admin endpoint) ──
// Per zdroj (eu/un/cz) + entity path (EU) + bezpečnostní kontroly. Kotvy jsou
// STABILNÍ záznamy vybrané z reálných dat (OSN-only osoby z výboru DRC; CZ osoba
// Gunďajev/Kirill). Jména jsou veřejné sankcionované subjekty (žádná data klientů).
export async function sanctionsSelftest(env) {
  const out = { eu: { ok: true, checks: [] }, un: { ok: true, checks: [] }, cz: { ok: true, checks: [] }, pep: { ok: true, checks: [] }, safety: { ok: true, checks: [] } };

  const cnt = async (t, s) => { try { return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE source=?`).bind(s).first())?.n ?? -1; } catch { return -1; } };
  async function person(bucket, name, { expect = 'match', source = null } = {}) {
    let r; try { r = await lookupSanctions(env, name, null); } catch (e) { r = { status: 'error', details: String(e.message || e) }; }
    const src = r.details?.source || null;
    const pass = r.status === expect && (expect !== 'match' || !source || src === source);
    out[bucket].checks.push({ name, expected: expect + (source ? '/' + source : ''), status: r.status, source: src, matched_against: r.matched_against || null, score: r.match_score || null, pass });
    if (!pass) out[bucket].ok = false;
  }
  async function entity(bucket, name, { source = null } = {}) {
    let r; try { r = await lookupSanctionsEntity(env, name); } catch (e) { r = { status: 'error', details: String(e.message || e) }; }
    const src = r.details?.source || null;
    const pass = r.status === 'match' && (!source || src === source);
    out[bucket].checks.push({ entity: name, expected: 'match' + (source ? '/' + source : ''), status: r.status, source: src, matched_against: r.matched_against || null, score: r.match_score || null, pass });
    if (!pass) out[bucket].ok = false;
  }
  // PEP: lokální D1 (ruční CZ seznam) = tvrdá kontrola; OpenSanctions větev = MĚKKÁ
  // (externí API — výpadek je warning, ne fail, není to naše chyba).
  async function pepCheck(name, { expect = 'warning', softExternal = false } = {}) {
    let r; try { r = await lookupPep(env, name, null); } catch (e) { r = { status: 'error', source: null, details: String(e.message || e) }; }
    const external = r.source === 'opensanctions' || /opensanctions/i.test(String(r.details || ''));
    if (softExternal && r.status === 'error' && external) {
      out.pep.checks.push({ name, expected: expect, status: r.status, source: r.source || null, soft: true, note: 'OpenSanctions nedostupné — měkký warning (nezpůsobuje fail)', pass: true });
      out.pep.warnings = (out.pep.warnings || 0) + 1;
      return;
    }
    const pass = r.status === expect;
    out.pep.checks.push({ name, expected: expect, status: r.status, source: r.source || null, matched_against: r.matched_against || null, score: r.match_score || null, pass });
    if (!pass) out.pep.ok = false;
  }

  // EU: osoba + ENTITA (entity path dosud selftest nekryl)
  await person('eu', 'Vladimir Putin', { source: 'EU' });
  await entity('eu', 'Sberbank', { source: 'EU' });
  // OSN: 2 stabilní OSN záznamy (výbor DRC). Source se NEfixuje — EU přebírá většinu
  // OSN sankcí, takže fuzzy legitimně vrátí i EU; přítomnost OSN dat potvrzuje count.
  await person('un', 'Jamil Mukulu');
  await person('un', 'Sylvestre Mudacumura');
  out.un.count = await cnt('sanctions', 'UN');
  if (out.un.count < 500) out.un.ok = false;   // OSN má stovky osob (sanity)
  // MZV ČR: 2 stabilní záznamy (jen v CZ)
  await person('cz', 'Vladimir Gundyayev', { source: 'CZ' });
  await person('cz', 'Vladimir Gundajev', { source: 'CZ' });
  out.cz.count = await cnt('sanctions', 'CZ');
  if (out.cz.count < 1) out.cz.ok = false;
  // PEP: pozitivní kotva z ručního CZ seznamu (stabilní historický záznam — bývalý
  // prezident) MUSÍ vrátit shodu přes lokální D1 (source cz_manual, status warning).
  // + negativní kontrola (smyšlené jméno). OpenSanctions výpadek u negativní kontroly
  // je měkký warning, ne fail.
  await pepCheck('Miloš Zeman', { expect: 'warning' });
  await pepCheck('Karel Zkušební Neexistující Osoba', { expect: 'clean', softExternal: true });
  try { out.pep.count = (await env.DB.prepare("SELECT COUNT(*) AS n FROM pep WHERE source='manual_cz'").first())?.n ?? -1; } catch { out.pep.count = -1; }
  if (out.pep.count < 1) out.pep.ok = false;
  // Bezpečnost: azbukový vstup NESMÍ dělat falešnou shodu (guard proti prázdné
  // normalizaci) + smyšlené jméno musí být clean.
  await person('safety', 'Владимир Путин', { expect: 'clean' });
  await person('safety', 'Karel Zkušební Neexistující Osoba', { expect: 'clean' });
  out.safety.note = 'Azbukový vstup se normalizací redukuje na prázdno → nematchuje (guard proti falešné shodě). Skutečné screeningy jedou přes latinku (viz EU test) + originál se ukládá do aliases.';

  out.ok = out.eu.ok && out.un.ok && out.cz.ok && out.pep.ok && out.safety.ok;
  return out;
}
