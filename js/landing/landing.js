// legalid.cz — js/landing/landing.js
// Marketingový landing pro nepřihlášené uživatele (route "/").
// CTA volají window-bridged funkce: openRegistrationModal, navigate, selectPlan, openPrivacyModal, openAboutModal.

export function renderLanding() {
  return `
<div class="lnd">

  <!-- HERO -->
  <section class="lnd-hero">
    <div class="lnd-wrap">
      <div class="lnd-eyebrow">AML pro advokáty</div>
      <h1 class="lnd-h1">AML kontrola klientů za 3 minuty</h1>
      <p class="lnd-sub">Splňte AML povinnosti podle zákona č. 253/2008 Sb. — bez tabulek a papírování.</p>
      <div class="lnd-cta-row">
        <button class="lnd-btn lnd-btn-primary" onclick="openRegistrationModal()">Vyzkoušet zdarma</button>
        <button class="lnd-btn lnd-btn-ghost" onclick="navigate('/dolozka')">Vyzkoušet ověřovací doložku →</button>
      </div>
      <div class="lnd-hero-ai">AI rozpozná doklad za 3 vteřiny · automatická lustrace v 5 rejstřících</div>
      <div class="lnd-hero-note">Bez karty · 30 dní zdarma · zrušíte kdykoli</div>
    </div>
  </section>

  <!-- CO UMÍME -->
  <section class="lnd-section">
    <div class="lnd-wrap">
      <div class="lnd-section-label">Co umíme</div>
      <div class="lnd-cards">
        <div class="lnd-card lnd-card--primary">
          <div class="lnd-card-icon"><i class="ti ti-shield-check"></i></div>
          <div class="lnd-card-title">AML kontrola</div>
          <div class="lnd-card-text">Identifikace a kontrola klienta, screening sankčních a PEP seznamů, hodnocení rizik a archivace záznamů — vše na jednom místě.</div>
          <button class="lnd-btn lnd-btn-primary lnd-btn-sm" onclick="openRegistrationModal()">Vyzkoušet zdarma</button>
        </div>
        <div class="lnd-card">
          <div class="lnd-card-icon"><i class="ti ti-file-certificate"></i></div>
          <div class="lnd-card-title">Ověřovací doložka</div>
          <div class="lnd-card-text">Prohlášení o pravosti podpisu s automatickým rozpoznáním údajů z občanského průkazu. Tisk, .docx i PDF.</div>
          <button class="lnd-btn lnd-btn-ghost lnd-btn-sm" onclick="navigate('/dolozka')">Otevřít doložku →</button>
        </div>
        <div class="lnd-card lnd-card--soon">
          <div class="lnd-card-icon"><i class="ti ti-cloud-lock"></i></div>
          <div class="lnd-card-title">Cloud archivace <span class="lnd-soon-tag">Brzy</span></div>
          <div class="lnd-card-text">Bezpečné uložení AML dokumentace a doložek v cloudu s šifrováním a přístupem odkudkoli.</div>
          <button class="lnd-btn lnd-btn-ghost lnd-btn-sm" disabled>Připravujeme</button>
        </div>
      </div>
    </div>
  </section>

  <!-- JAK TO FUNGUJE -->
  <section class="lnd-section lnd-section--alt">
    <div class="lnd-wrap">
      <div class="lnd-section-label">Jak to funguje</div>
      <h2 class="lnd-h2">5 kroků AML kontroly</h2>
      <ol class="lnd-steps">
        <li class="lnd-step"><span class="lnd-step-num">1</span><div><div class="lnd-step-title">Identifikace klienta</div><div class="lnd-step-text">Naskenujte doklad nebo zadejte údaje. Aplikace vyplní formulář za vás.</div><div class="lnd-step-ai">AI rozpozná údaje z dokladu</div></div></li>
        <li class="lnd-step"><span class="lnd-step-num">2</span><div><div class="lnd-step-title">Screening seznamů</div><div class="lnd-step-text">Automatická kontrola sankčních seznamů (EU, OSN) a politicky exponovaných osob (PEP).</div><div class="lnd-step-ai">fuzzy matching i přes překlepy</div></div></li>
        <li class="lnd-step"><span class="lnd-step-num">3</span><div><div class="lnd-step-title">Hodnocení rizik</div><div class="lnd-step-text">Rizikové skóre klienta a obchodu podle metodiky — nízké, střední, vysoké riziko.</div><div class="lnd-step-ai">AI přečte podpůrné dokumenty a ověří konzistenci</div></div></li>
        <li class="lnd-step"><span class="lnd-step-num">4</span><div><div class="lnd-step-title">Generování záznamu</div><div class="lnd-step-text">Protokol o AML kontrole připravený k podpisu a archivaci podle zákona.</div><div class="lnd-step-ai">AI navrhne, vy rozhodnete</div></div></li>
        <li class="lnd-step"><span class="lnd-step-num">5</span><div><div class="lnd-step-title">Archivace</div><div class="lnd-step-text">Záznamy uchovány po zákonnou dobu, kdykoli dohledatelné při kontrole.</div><div class="lnd-step-ai">generování dokumentů automaticky</div></div></li>
      </ol>
      <div class="lnd-steps-note">Screenshoty a ukázky doplníme brzy.</div>
    </div>
  </section>

  <!-- PRICING -->
  <section class="lnd-section" id="lnd-pricing">
    <div class="lnd-wrap">
      <div class="lnd-section-label">Ceník</div>
      <h2 class="lnd-h2">Jednoduché ceny, bez závazků</h2>
      <div class="lnd-price-cards">
        <div class="lnd-price-card">
          <div class="lnd-price-name">Zdarma</div>
          <div class="lnd-price-amt">0 <span>Kč</span></div>
          <div class="lnd-price-sub">5 doložek bez registrace · po trialu 2 / měsíc</div>
          <ul class="lnd-price-feat">
            <li>Ověřovací doložka</li>
            <li>Rozpoznání údajů z OP</li>
            <li>Tisk, .docx, PDF</li>
          </ul>
          <button class="lnd-btn lnd-btn-ghost lnd-btn-block" onclick="navigate('/dolozka')">Začít zdarma</button>
        </div>
        <div class="lnd-price-card">
          <div class="lnd-price-name">Pro měsíční</div>
          <div class="lnd-price-amt">220 <span>Kč/měs</span></div>
          <div class="lnd-price-sub">zrušíte kdykoli</div>
          <ul class="lnd-price-feat">
            <li>Neomezené doložky</li>
            <li>AML kontrola (brzy)</li>
            <li>Faktura na IČO</li>
          </ul>
          <button class="lnd-btn lnd-btn-ghost lnd-btn-block" onclick="selectPlan('monthly')">Vybrat měsíční</button>
        </div>
        <div class="lnd-price-card lnd-price-card--featured">
          <div class="lnd-price-badge">2 měsíce zdarma</div>
          <div class="lnd-price-name">Pro roční</div>
          <div class="lnd-price-amt">182 <span>Kč/měs</span></div>
          <div class="lnd-price-sub">2 190 Kč/rok · ušetříte 450 Kč</div>
          <ul class="lnd-price-feat">
            <li>Neomezené doložky</li>
            <li>AML kontrola (brzy)</li>
            <li>Faktura na IČO</li>
          </ul>
          <button class="lnd-btn lnd-btn-primary lnd-btn-block" onclick="selectPlan('annual')">Vybrat roční</button>
        </div>
      </div>
      <div class="lnd-price-note">30 dní zdarma neomezeně po registraci · žádná karta při registraci</div>
    </div>
  </section>

  <!-- FAQ -->
  <section class="lnd-section lnd-section--alt">
    <div class="lnd-wrap lnd-wrap--narrow">
      <div class="lnd-section-label">Časté otázky</div>
      <div class="lnd-faq">
        <div class="lnd-faq-item">
          <button class="lnd-faq-q" onclick="this.parentElement.classList.toggle('open')">Kdo potřebuje AML kontrolu?<span class="lnd-faq-icon">+</span></button>
          <div class="lnd-faq-a">Advokáti jsou povinnými osobami podle zákona č. 253/2008 Sb. u řady úkonů — např. při správě majetku, zakládání společností, transakcích s nemovitostmi. AML kontrola klienta je u těchto úkonů povinná.</div>
        </div>
        <div class="lnd-faq-item">
          <button class="lnd-faq-q" onclick="this.parentElement.classList.toggle('open')">Jak chráníte naše data?<span class="lnd-faq-icon">+</span></button>
          <div class="lnd-faq-a">Údaje z dokladů jsou zpracovány na základě zpracovatelské smlouvy dle čl. 28 GDPR a neukládají se na našich serverech déle, než je nezbytné. Záznamy v Knize a u Klientů jsou uloženy lokálně ve vašem prohlížeči. Detaily v sekci Ochrana dat.</div>
        </div>
        <div class="lnd-faq-item">
          <button class="lnd-faq-q" onclick="this.parentElement.classList.toggle('open')">Můžu předplatné zrušit?<span class="lnd-faq-icon">+</span></button>
          <div class="lnd-faq-a">Ano, kdykoli a bez podmínek. U měsíčního plánu stačí neobnovit, u ročního zrušíte v nastavení účtu. Žádné poplatky za zrušení.</div>
        </div>
        <div class="lnd-faq-item">
          <button class="lnd-faq-q" onclick="this.parentElement.classList.toggle('open')">Jak se platí?<span class="lnd-faq-icon">+</span></button>
          <div class="lnd-faq-a">Platba kartou online. Na vyžádání vystavíme fakturu na IČO. Při registraci kartu nevyžadujeme — nejdřív 30 dní zdarma.</div>
        </div>
        <div class="lnd-faq-item">
          <button class="lnd-faq-q" onclick="this.parentElement.classList.toggle('open')">Jak Legalid používá AI?<span class="lnd-faq-icon">+</span></button>
          <div class="lnd-faq-a">Pro rozpoznání údajů z dokladu, fuzzy matching jmen v sankčních seznamech a porovnání podpůrných dokumentů. AI je asistent, ne rozhodovatel — všechna AML rozhodnutí podle zákona činíte vy.</div>
        </div>
        <div class="lnd-faq-item">
          <button class="lnd-faq-q" onclick="this.parentElement.classList.toggle('open')">Jsou data klientů v bezpečí?<span class="lnd-faq-icon">+</span></button>
          <div class="lnd-faq-a">Fotky dokladů AI zpracovává v reálném čase a okamžitě je zahazuje, neukládají se. Anthropic (poskytovatel AI) má smluvně sjednáno, že data nepoužívá pro trénování modelů.</div>
        </div>
      </div>
    </div>
  </section>

  <!-- FOOTER -->
  <footer class="lnd-footer">
    <div class="lnd-wrap lnd-footer-i">
      <div class="lnd-footer-brand">legalid.cz</div>
      <div class="lnd-footer-links">
        <a href="mailto:info@legalid.cz">info@legalid.cz</a>
        <button class="lnd-footer-link" onclick="openPrivacyModal()">Ochrana dat</button>
        <button class="lnd-footer-link" onclick="openAboutModal()">O aplikaci</button>
      </div>
      <div class="lnd-footer-copy">© 2026 legalid.cz · Zpracování dat dle GDPR</div>
    </div>
  </footer>

  <!-- Sticky CTA (jen mobil, zobrazí se po odscrollování hero) -->
  <div class="lnd-sticky-cta">
    <button class="lnd-btn lnd-btn-primary lnd-btn-block" onclick="openRegistrationModal()">Vyzkoušet zdarma</button>
  </div>

</div>`;
}

let _stickyIo = null;

// Volá se po mountu landingu (app.js). Sticky CTA se odhalí, až hero opustí viewport.
export function initLanding() {
  if (_stickyIo) { _stickyIo.disconnect(); _stickyIo = null; }
  const hero = document.querySelector('.lnd-hero');
  const cta = document.querySelector('.lnd-sticky-cta');
  if (!hero || !cta || typeof IntersectionObserver === 'undefined') return;
  _stickyIo = new IntersectionObserver(
    ([entry]) => { cta.classList.toggle('is-visible', !entry.isIntersecting); },
    { threshold: 0 }
  );
  _stickyIo.observe(hero);
}
