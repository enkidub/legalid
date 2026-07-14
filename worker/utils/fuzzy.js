// legalid.cz — worker/utils/fuzzy.js
// Fuzzy matching jmen pro lustrace (sankce, PEP). Bez závislostí — běží ve Workeru i v Node.
//
// Kombinace dvou metrik:
//   - trigram similarity  → odolné vůči přehození/vypuštění částí jména
//   - Levenshtein (norm.)  → odolné vůči překlepům a diakritice
// findBestMatch bere max(trigram, levenshtein) jako skóre kandidáta (vyšší recall —
// v AML je horší přehlédnout shodu než mít falešně pozitivní k ruční kontrole).

// Normalizace jména pro porovnání.
export function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // bez diakritiky
    .replace(/[^a-z0-9\s]/g, '')                        // jen písmena, číslice a mezery
    .replace(/\s+/g, ' ')
    .trim();
}

// Množina trigramů se dvěma mezerami na okrajích (zvýrazní začátky/konce slov).
function trigrams(s) {
  const padded = `  ${s} `;
  const set = new Set();
  for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3));
  return set;
}

// Trigram similarity (Diceův koeficient), 0.0–1.0.
export function trigramSimilarity(a, b) {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = trigrams(na), tb = trigrams(nb);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}

// Levenshteinova vzdálenost (dvouřádková DP, O(min) paměť).
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

// Levenshtein normalizovaný na 0.0–1.0 (1 = shoda).
export function levenshteinSimilarity(a, b) {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  const maxLen = Math.max(na.length, nb.length);
  return 1 - levenshtein(na, nb) / maxLen;
}

// Token-subset skóre: každý token kratšího jména se napáruje na nejlepší token
// delšího jména. Řeší časté prostřední jméno / patronymum (např. klient
// "Ramzan Kadyrov" vs sankční "Ramzan Akhmadovitch Kadyrov"). Vyžaduje, aby
// VŠECHNY tokeny kratšího jména měly silnou shodu → drží slušnou přesnost.
export function tokenSubsetSimilarity(a, b) {
  const ta = normalizeName(a).split(' ').filter(Boolean);
  const tb = normalizeName(b).split(' ').filter(Boolean);
  if (ta.length < 2 || tb.length < 2) return 0;   // u jednoslovných jmen nedává smysl
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  let sum = 0;
  for (const s of short) {
    let best = 0;
    for (const l of long) best = Math.max(best, trigramSimilarity(s, l), levenshteinSimilarity(s, l));
    sum += best;
  }
  return sum / short.length;
}

// Skóre jednoho páru — nejvyšší z celojmenných metrik i token-subset skóre.
export function nameSimilarity(a, b) {
  return Math.max(trigramSimilarity(a, b), levenshteinSimilarity(a, b), tokenSubsetSimilarity(a, b));
}

// Hlavní funkce — najde nejlepší match v seznamu.
//   needle    = klientovo jméno (raw i normalized je jedno, normalizuje se uvnitř)
//   haystack  = pole objektů { full_name, name_normalized, ... } z DB
//   threshold = minimální skóre pro "match" (0.85 sankce, 0.90 PEP)
// Vrací { match: object|null, score: number, all_candidates: [{ ...row, score, trigram, levenshtein }] }
export function findBestMatch(needle, haystack, threshold = 0.85) {
  const nn = normalizeName(needle);
  const scored = (haystack || []).map(row => {
    const cand = row.name_normalized || normalizeName(row.full_name);
    const trigram = trigramSimilarity(nn, cand);
    const lev = levenshteinSimilarity(nn, cand);
    const subset = tokenSubsetSimilarity(nn, cand);
    return { ...row, trigram, levenshtein: lev, subset, score: Math.max(trigram, lev, subset) };
  }).sort((x, y) => y.score - x.score);

  const best = scored[0];
  const match = best && best.score >= threshold ? best : null;
  return {
    match,
    score: best ? best.score : 0,
    all_candidates: scored.slice(0, 10),
  };
}
