// legalid.cz — js/povinne-osoby/povinne-osoby.js
// Statická informační stránka (route "/povinne-osoby"): kdo je povinná osoba podle
// AML zákona č. 253/2008 Sb. Accordion 12 profesí, kotvy #advokati atd.
//
// ⚠ PRÁVNÍ TEXTY ČEKAJÍ NA KONTROLU — každý text „kdy povinnost vzniká" má v šabloně
//    HTML komentář <!-- OVĚŘIT -->. Editovat lze zde v poli PROFESE bez zásahu do šablony.

import { navigate } from '../core/router.js';

const DOZOR_FAU = 'Finanční analytický úřad (FAÚ)';

// ── Konfigurační pole profesí (editovatelné) ─────────────────────────
// id     → kotva (#id) a DOM id karty (po-<id>); musí sedět s odkazy ve footeru
// zaklad → řádek ZÁKONNÝ ZÁKLAD (§ … zákona č. 253/2008 Sb.) — OVĚŘIT
// kdy    → box „KDY POVINNOST VZNIKÁ" (2–3 věty) — na konci HTML komentář <!-- OVĚŘIT -->
// dozor  → box „DOZOR"
// pomoc  → odstavec „Jak pomůže Legalid" (2 věty, odkaz na registraci)
export const PROFESE = [
  {
    id: 'advokati', name: 'Advokáti', dolozka: true,
    zaklad: '§ 2 odst. 1 písm. g) zákona č. 253/2008 Sb.',
    dozor: 'Česká advokátní komora (ČAK)',
    kdy: 'Advokát je povinnou osobou, pokud pro klienta jedná při vymezených úkonech — zejména při nakládání s jeho penězi, cennými papíry či jiným majetkem, při obchodech s nemovitostmi, správě majetku a při zakládání a správě obchodních společností nebo svěřenských fondů. Na samotné právní porady a zastupování v řízení se AML povinnosti nevztahují. <!-- OVĚŘIT -->',
    pomoc: 'Legalid provede identifikaci klienta, lustraci v rejstřících (sankce, PEP, insolvence, ARES) a vyhodnocení rizika. Výsledkem je AML záznam s náležitostmi podle § 8 a násl. — hotový do tří minut.',
  },
  {
    id: 'notari', name: 'Notáři', dolozka: true,
    zaklad: '§ 2 odst. 1 písm. g) zákona č. 253/2008 Sb.',
    dozor: 'Notářská komora ČR (NK ČR)',
    kdy: 'Notář je povinnou osobou při úkonech obdobných advokátům — zejména při úschovách peněz a listin, jednání jménem klienta při obchodech s nemovitostmi, správě majetku a při zakládání a správě obchodních společností nebo svěřenských fondů. Rozhoduje povaha úkonu, nikoli forma. <!-- OVĚŘIT -->',
    pomoc: 'Legalid zvládne identifikaci klienta i lustraci v rejstřících a vytvoří archivovatelný AML záznam. Ušetří ruční papírování a drží zákonné náležitosti podle § 8 a násl.',
  },
  {
    id: 'exekutori', name: 'Soudní exekutoři',
    zaklad: '§ 2 odst. 1 písm. h) zákona č. 253/2008 Sb.',
    dozor: DOZOR_FAU,
    kdy: 'Soudní exekutor je povinnou osobou zejména při provádění dražeb a při správě majetku, tedy když nakládá s peněžními prostředky nebo majetkem účastníků řízení. Povinnost se váže na tuto majetkovou činnost, nikoli na samotný výkon rozhodnutí. <!-- OVĚŘIT -->',
    pomoc: 'Legalid provede identifikaci a lustraci účastníků a vytvoří AML záznam k archivaci. Vše online, bez tabulek, s časovým razítkem lustrace.',
  },
  {
    id: 'insolvencni-spravci', name: 'Insolvenční správci',
    zaklad: '§ 2 odst. 1 písm. h) zákona č. 253/2008 Sb.',
    dozor: DOZOR_FAU,
    kdy: 'Insolvenční správce je povinnou osobou při výkonu své funkce, kdy spravuje a zpeněžuje majetkovou podstatu dlužníka a nakládá s peněžními prostředky určenými věřitelům. Povinnost dopadá na tuto správu a nakládání s majetkem. <!-- OVĚŘIT -->',
    pomoc: 'Legalid identifikuje dotčené osoby, prověří je v rejstřících a připraví AML záznam. Snižuje riziko přehlédnutí sankčního či PEP zásahu díky fuzzy matchingu.',
  },
  {
    id: 'danovi-poradci', name: 'Daňoví poradci',
    zaklad: '§ 2 odst. 1 písm. h) zákona č. 253/2008 Sb.',
    dozor: DOZOR_FAU,
    kdy: 'Daňový poradce je povinnou osobou při poskytování daňového poradenství a souvisejících služeb klientovi, zejména pomáhá-li se strukturováním transakcí, majetku nebo obchodních společností. Rozhodující je obsah poskytované služby. <!-- OVĚŘIT -->',
    pomoc: 'Legalid provede identifikaci klienta a lustraci v rejstřících a vygeneruje AML záznam s náležitostmi podle zákona. Hotovo do tří minut, připraveno k archivaci.',
  },
  {
    id: 'auditori-ucetni', name: 'Auditoři a účetní',
    zaklad: '§ 2 odst. 1 písm. h) zákona č. 253/2008 Sb.',
    dozor: DOZOR_FAU,
    kdy: 'Auditor, účetní a osoba poskytující účetní služby jsou povinnými osobami při výkonu této činnosti pro klienta — typicky při vedení účetnictví, sestavování účetních výkazů a při auditu. Povinnost se váže na poskytování služby, ne na jednorázovou výpomoc. <!-- OVĚŘIT -->',
    pomoc: 'Legalid zajistí identifikaci klienta, lustraci sankcí a PEP a hodnocení rizika. AML záznam si stáhnete jako PDF a uložíte do evidence.',
  },
  {
    id: 'realitni', name: 'Realitní zprostředkovatelé',
    zaklad: '§ 2 odst. 1 písm. d) zákona č. 253/2008 Sb.',
    dozor: DOZOR_FAU,
    kdy: 'Realitní zprostředkovatel je povinnou osobou při zprostředkování nákupu, prodeje nebo pronájmu nemovitostí. U nájmu vzniká povinnost při měsíčním nájemném ve výši 10 000 EUR nebo vyšší. <!-- OVĚŘIT -->',
    pomoc: 'Legalid provede identifikaci klienta z dokladu, lustraci v rejstřících a vyhodnocení rizika. Výsledný AML záznam splňuje náležitosti podle § 8 a násl.',
  },
  {
    id: 'drazebnici', name: 'Dražebníci nemovitostí',
    zaklad: '§ 2 odst. 1 písm. h) zákona č. 253/2008 Sb.',
    dozor: DOZOR_FAU,
    kdy: 'Dražebník je povinnou osobou při provádění dobrovolných i nedobrovolných dražeb, kdy nakládá s výtěžkem dražby a s prostředky účastníků. Povinnost se váže na organizaci dražby a vypořádání. <!-- OVĚŘIT -->',
    pomoc: 'Legalid identifikuje účastníky a prověří je v sankčních a PEP seznamech. AML záznam vzniká automaticky a je připraven k archivaci.',
  },
  {
    id: 'sverensti-spravci', name: 'Svěřenští správci (TCSP)',
    zaklad: '§ 2 odst. 1 písm. i) zákona č. 253/2008 Sb.',
    dozor: DOZOR_FAU,
    kdy: 'Svěřenský správce a osoba poskytující služby pro svěřenské fondy nebo obchodní společnosti (TCSP) jsou povinnými osobami při zakládání a správě těchto útvarů, poskytování sídla nebo výkonu funkce pověřené osoby. Povinnost dopadá na tyto služby poskytované třetím osobám. <!-- OVĚŘIT -->',
    pomoc: 'Legalid provede identifikaci a lustraci zúčastněných osob i společností a vyhodnotí riziko. AML záznam získáte jako PDF do tří minut.',
  },
  {
    id: 'umeni-kovy', name: 'Obchodníci s uměním a drahými kovy',
    zaklad: '§ 2 odst. 1 písm. j) zákona č. 253/2008 Sb.',
    dozor: DOZOR_FAU,
    kdy: 'Osoba obchodující s uměleckými díly, kulturními památkami, drahými kovy nebo drahými kameny je povinnou osobou při obchodu v hodnotě 10 000 EUR nebo vyšší. Povinnost platí i tehdy, je-li částka rozdělena do více na sebe navazujících plateb. <!-- OVĚŘIT -->',
    pomoc: 'Legalid identifikuje kupujícího či prodávajícího a prověří jej v rejstřících. Vytvoří AML záznam se všemi náležitostmi a časovým razítkem.',
  },
  {
    id: 'zastavarny', name: 'Zastavárny',
    zaklad: '§ 2 odst. 1 písm. l) zákona č. 253/2008 Sb.',
    dozor: DOZOR_FAU,
    kdy: 'Provozovatel zastavárny je povinnou osobou při poskytování zápůjček proti zástavě a při výkupu věcí, kdy přijímá nebo vyplácí peněžní prostředky. Povinnost se váže na tuto podnikatelskou činnost. <!-- OVĚŘIT -->',
    pomoc: 'Legalid provede identifikaci zákazníka z dokladu a lustraci v rejstřících. AML záznam vzniká automaticky a uložíte si jej do evidence.',
  },
  {
    id: 'hotovostni-platby', name: 'Podnikatelé s hotovostními platbami ≥ 10 000 EUR',
    zaklad: '§ 2 odst. 2 písm. d) zákona č. 253/2008 Sb.',
    dozor: DOZOR_FAU,
    kdy: 'Kterýkoli podnikatel se stává povinnou osobou, přijme-li platbu v hotovosti v hodnotě 10 000 EUR nebo vyšší. Povinnost platí i v případě, že je platba rozdělena do více na sebe navazujících částí. <!-- OVĚŘIT -->',
    pomoc: 'Legalid provede identifikaci plátce a lustraci v sankčních a PEP seznamech. Výsledkem je AML záznam s náležitostmi podle § 8 a násl. připravený k archivaci.',
  },
];

function cardHtml(p, open) {
  return `
  <article class="po-card${open ? ' open' : ''}" id="po-${p.id}">
    <button class="po-card-head" onclick="togglePoCard('${p.id}')" aria-expanded="${open ? 'true' : 'false'}">
      <span class="po-card-name">${p.name}</span>
      <span class="po-card-arrow" aria-hidden="true">▾</span>
    </button>
    <div class="po-card-body">
      <div class="po-basis">
        <span class="po-basis-label">Zákonný základ</span>
        <span class="po-basis-val">${p.zaklad}</span>
      </div>
      <div class="po-boxes">
        <div class="po-box">
          <div class="po-box-label">Kdy povinnost vzniká</div>
          <div class="po-box-text">${p.kdy}</div>
        </div>
        <div class="po-box po-box--dozor">
          <div class="po-box-label">Dozor</div>
          <div class="po-box-text">${p.dozor}</div>
        </div>
      </div>
      <p class="po-help"><strong>Jak pomůže Legalid.</strong> ${p.pomoc}
        <button class="po-help-link" onclick="openRegistrationModal()">Vyzkoušet zdarma →</button></p>
      ${p.dolozka ? `<p class="po-dolozka"><strong>Navíc pro vás:</strong> ověřovací doložka — prohlášení o pravosti podpisu s AI rozpoznáním údajů z dokladu.
        <button class="po-help-link" onclick="navigate('/dolozka')">Otevřít doložku →</button></p>` : ''}
    </div>
  </article>`;
}

export function renderPovinneOsoby() {
  const cards = PROFESE.map((p, i) => cardHtml(p, i === 0)).join('');
  return `
<div class="po">
  <section class="po-hero">
    <div class="lnd-wrap lnd-wrap--narrow">
      <div class="lnd-section-label">Povinné osoby</div>
      <h1 class="po-h1">Kdo je povinná osoba podle AML zákona</h1>
      <p class="po-intro">Zákon č. 253/2008 Sb. o některých opatřeních proti legalizaci výnosů z trestné
        činnosti ukládá řadě profesí a podnikatelů provádět AML kontrolu klienta. Níže najdete přehled,
        koho se povinnost týká a kdy vzniká. Informace slouží pro orientaci — rozhodující je vždy platné
        znění zákona.</p>
    </div>
  </section>
  <section class="po-list-section">
    <div class="lnd-wrap lnd-wrap--narrow">
      <div class="po-list">${cards}</div>
      <div class="po-cta">
        <p class="po-cta-text">AML kontrolu zvládnete s Legalid za 3 minuty na klienta.</p>
        <button class="lnd-btn lnd-btn-primary" onclick="openRegistrationModal()">Vyzkoušet zdarma</button>
      </div>
    </div>
  </section>
</div>`;
}

// ── Interakce ────────────────────────────────────────────────────────
function openCard(id, scroll) {
  const card = document.getElementById('po-' + id);
  if (!card) return;
  card.classList.add('open');
  const head = card.querySelector('.po-card-head');
  if (head) head.setAttribute('aria-expanded', 'true');
  if (scroll) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function togglePoCard(id) {
  const card = document.getElementById('po-' + id);
  if (!card) return;
  const open = card.classList.toggle('open');
  const head = card.querySelector('.po-card-head');
  if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false');
}

// Skok na konkrétní profesi (z footeru) — i z jiné routy.
export function gotoProfese(id) {
  if (document.querySelector('.po')) {
    openCard(id, true);
  } else {
    navigate('/povinne-osoby');
    requestAnimationFrame(() => requestAnimationFrame(() => openCard(id, true)));
  }
}

// Po mountu: pokud URL nese #kotvu, otevři a odscrolluj na danou kartu.
export function initPovinneOsoby() {
  const hash = (location.hash || '').replace('#', '');
  if (hash) requestAnimationFrame(() => openCard(hash, true));
}
