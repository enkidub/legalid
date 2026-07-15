// legalid.cz — js/core/entities.js
// Typy povinných osob dle § 2 zák. č. 253/2008 Sb. — sdíleno profilem i PDF šablonou.

export const ENTITY_ORDER = ['advokat', 'notar', 'exekutor', 'insolvencni_spravce', 'danovy_poradce',
  'auditor', 'ucetni', 'realitni', 'drazebnik', 'sverensky_spravce', 'obchodnik', 'zastavarna', 'jina'];

export const ENTITY_LABELS = {
  advokat: 'Advokát', notar: 'Notář', exekutor: 'Soudní exekutor',
  insolvencni_spravce: 'Insolvenční správce', danovy_poradce: 'Daňový poradce',
  auditor: 'Auditor', ucetni: 'Účetní', realitni: 'Realitní zprostředkovatel',
  drazebnik: 'Dražebník', sverensky_spravce: 'Svěřenský správce',
  obchodnik: 'Obchodník s uměním či drahými kovy', zastavarna: 'Zastavárna',
  jina: 'Jiná povinná osoba',
};

// Label evidenčního čísla dle komory. Ostatní → obecné „Registrační číslo" (nepovinné).
const REG_LABELS = {
  advokat: 'Ev. č. ČAK', notar: 'Ev. č. NK ČR', exekutor: 'Ev. č. EK ČR',
  danovy_poradce: 'Ev. č. KDP ČR', auditor: 'Ev. č. KA ČR',
};
export function regLabel(entityType) { return REG_LABELS[entityType] || 'Registrační číslo'; }
export function regIsOptional(entityType) { return !REG_LABELS[entityType]; }

// Dozorový orgán: advokát → ČAK, notář → NK ČR, ostatní → FAÚ.
export function dozorFor(entityType) {
  if (entityType === 'advokat') return 'Česká advokátní komora';
  if (entityType === 'notar') return 'Notářská komora ČR';
  return 'Finanční analytický úřad (FAÚ)';
}
