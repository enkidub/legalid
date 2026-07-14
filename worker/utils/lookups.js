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
  const likeVals = (tokens.length ? tokens : [nn]).map(t => `%${t}%`);
  const where = likeVals.map(() => 'name_normalized LIKE ?').join(' OR ');
  const sql = `SELECT * FROM ${table} WHERE ${where} LIMIT 500`;
  const { results } = await db.prepare(sql).bind(...likeVals).all();
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

// ── 3) ARES — ekonomické subjekty ──
export async function lookupAres(ico) {
  if (!ico) return { status: 'clean', details: { note: 'Klient nemá IČO — ARES přeskočeno.' } };
  const clean = String(ico).replace(/\s/g, '');
  try {
    const res = await fetch(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${clean}`, {
      headers: { 'Accept': 'application/json' },
    });
    if (res.status === 404) {
      return { status: 'warning', details: { note: 'Subjekt s tímto IČO nebyl v ARES nalezen.', ico: clean } };
    }
    if (!res.ok) throw new Error(`http ${res.status}`);
    const d = await res.json();
    const active = !d.datumZaniku;
    return {
      status: active ? 'clean' : 'warning',
      details: {
        ico: clean,
        name: d.obchodniJmeno || null,
        address: d.sidlo?.textovaAdresa || null,
        active,
        zanik: d.datumZaniku || null,
      },
    };
  } catch (e) {
    return { status: 'error', details: `ARES byl nedostupný (${e.message}).` };
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
    const rows = await dbCandidates(env.DB, 'pep', name);
    const cands = rows.map(r => ({ row: r, cand_name: r.full_name, name_normalized: r.name_normalized }));
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
