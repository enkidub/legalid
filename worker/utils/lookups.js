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
// ASP.NET WebForms (aplikace.mv.gov.cz), stavový VIEWSTATE round-trip → křehké.
// Konzervativně: jen pokud výsledek jednoznačně říká "neplatný", vrátíme 'match';
// jinak 'error' s pokynem na ruční kontrolu (nikdy nehlásíme falešné 'clean').
export async function lookupMvcr(docNumber) {
  if (!docNumber) return { status: 'clean', details: { note: 'Číslo dokladu nezadáno — přeskočeno.' } };
  const BASE = 'https://aplikace.mv.gov.cz/neplatne-doklady/';
  try {
    const pageRes = await fetch(BASE, { headers: { 'User-Agent': 'legalid-aml/1.0' } });
    if (!pageRes.ok) throw new Error(`page ${pageRes.status}`);
    const html = await pageRes.text();
    const hidden = name => (html.match(new RegExp(`id="${name}"[^>]*value="([^"]*)"`)) || [])[1] || '';
    const viewstate = hidden('__VIEWSTATE');
    const eventval = hidden('__EVENTVALIDATION');
    const vsgen = hidden('__VIEWSTATEGENERATOR');
    if (!viewstate) throw new Error('no viewstate');

    // Pozn.: přesné názvy polí formuláře je nutné doladit proti reálné odpovědi po deployi.
    const form = new URLSearchParams({
      __VIEWSTATE: viewstate,
      __VIEWSTATEGENERATOR: vsgen,
      __EVENTVALIDATION: eventval,
      cislo: String(docNumber),
    });
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'legalid-aml/1.0' },
      body: form.toString(),
    });
    const body = (await res.text()).toLowerCase();
    if (/neplatn/.test(body) && new RegExp(String(docNumber).toLowerCase()).test(body)) {
      return { status: 'match', details: { note: 'Doklad nalezen v evidenci neplatných dokladů MVČR.', doc_number: docNumber } };
    }
    if (/nebyl.*nalezen|nenalezen|žádn.*záznam|0 záznam/i.test(body)) {
      return { status: 'clean', details: { note: 'Doklad není v evidenci neplatných dokladů MVČR.' } };
    }
    return { status: 'error', details: 'Automatické ověření MVČR nebylo jednoznačné — zkontrolujte ručně na aplikace.mv.gov.cz/neplatne-doklady.' };
  } catch (e) {
    return { status: 'error', details: `Rejstřík MVČR byl nedostupný (${e.message}).` };
  }
}

// ── 2) ISIR — insolvenční rejstřík ──
// Veřejná evidence úpadců (isir.justice.cz). Scraping HTML výsledků → křehké.
export async function lookupIsir(name, birthdate) {
  if (!name) return { status: 'clean', details: { note: 'Jméno nezadáno — přeskočeno.' } };
  try {
    const url = 'https://isir.justice.cz/isir/ueu/evidence_upadcu_result.do?'
      + new URLSearchParams({ nazevOsoby: name, upadce: 'true', resitel: 'false', zverejnit: 'true' }).toString();
    const res = await fetch(url, { headers: { 'User-Agent': 'legalid-aml/1.0' } });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const html = await res.text();
    // Výsledková tabulka má řádky s třídou/odkazem na detail řízení; hrubá detekce.
    const hasRows = /detail_upadce|osobaId=|spisová značka|spisova znacka/i.test(html);
    const noRows = /nebyl.*nalezen|nenalezen|žádn|0 nalezených|no results/i.test(html);
    if (hasRows && !noRows) {
      return { status: 'warning', details: { note: 'Nalezen možný záznam v insolvenčním rejstříku — ověřte ručně.', name, birthdate: birthdate || null } };
    }
    if (noRows) {
      return { status: 'clean', details: { note: 'Žádný záznam v insolvenčním rejstříku.' } };
    }
    return { status: 'error', details: 'Automatické ověření ISIR nebylo jednoznačné — zkontrolujte ručně na isir.justice.cz.' };
  } catch (e) {
    return { status: 'error', details: `Rejstřík ISIR byl nedostupný (${e.message}).` };
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
      return {
        status: 'warning', source: 'opensanctions',
        matched_against: top.caption, match_score: Number(top.score.toFixed(3)),
        details: { datasets: top.datasets, topics: top.properties?.topics || null },
      };
    }
    return { status: 'clean', source: 'opensanctions', details: { note: 'Žádná shoda v OpenSanctions PEP.' } };
  } catch (e) {
    return { status: 'error', source: 'cz_manual', details: `PEP kontrola selhala (${e.message}).` };
  }
}
