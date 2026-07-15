// legalid.cz — js/landing/landing.js
// Marketingový landing pro nepřihlášené uživatele (route "/").
// CTA volají window-bridged funkce: openRegistrationModal, navigate, selectPlan, openPrivacyModal, openAboutModal.

export function renderLanding() {
  return `
<div class="lnd">

  <!-- HERO -->
  <section class="lnd-hero">
    <div class="lnd-wrap">
      <div class="lnd-eyebrow">AML pro povinné osoby</div>
      <h1 class="lnd-h1">AML kontrola klientů za 3 minuty</h1>
      <p class="lnd-sub">Splňte AML povinnosti podle zákona č. 253/2008 Sb. — bez tabulek a papírování.</p>
      <div class="lnd-cta-row">
        <button class="lnd-btn lnd-btn-primary" onclick="openRegistrationModal()">Vyzkoušet zdarma</button>
        <button class="lnd-btn lnd-btn-ghost" onclick="navigate('/dolozka')">Vyzkoušet ověřovací doložku →</button>
      </div>
      <div class="lnd-hero-trust">Záznam s náležitostmi § 8 a násl. · Archiv dle § 16 · Lustrace s časovým razítkem</div>
      <div class="lnd-hero-ai">AI rozpozná doklad · lustrace v 5 rejstřících · AML záznam k archivaci</div>

      <!-- Product proof — rámeček ve stylu prohlížečového okna.
           TODO: až bude nahrávka wizardu, vyměň <img> za <video autoplay loop muted playsinline>
           (CSS pro video variantu je připraveno: .lnd-proof-media video). -->
      <div class="lnd-proof">
        <div class="lnd-proof-bar"><span></span><span></span><span></span></div>
        <div class="lnd-proof-media">
          <video src="/assets/landing/wizard-demo.mp4" autoplay loop muted playsinline preload="metadata"
                 poster="/assets/landing/wizard-demo.png"
                 aria-label="Ukázka AML wizardu Legalid — vyplnění údajů klienta a lustrace v rejstřících"></video>
        </div>
      </div>
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
          <div class="lnd-card-text">Identifikace, lustrace sankcí a PEP, hodnocení rizika a záznam.</div>
          <button class="lnd-btn lnd-btn-primary lnd-btn-sm" onclick="openRegistrationModal()">Vyzkoušet zdarma</button>
        </div>
        <div class="lnd-card">
          <div class="lnd-card-icon"><i class="ti ti-file-certificate"></i></div>
          <div class="lnd-card-title">Ověřovací doložka</div>
          <div class="lnd-card-text">Prohlášení o pravosti podpisu s AI rozpoznáním z OP.</div>
          <button class="lnd-btn lnd-btn-ghost lnd-btn-sm" onclick="navigate('/dolozka')">Otevřít doložku →</button>
        </div>
        <div class="lnd-card">
          <div class="lnd-card-icon"><i class="ti ti-cloud-lock"></i></div>
          <div class="lnd-card-title">Archivace</div>
          <div class="lnd-card-text">AML záznamy k dispozici pro pozdější dohledání a export.</div>
          <button class="lnd-btn lnd-btn-ghost lnd-btn-sm" disabled>Součást AML kontroly</button>
        </div>
      </div>
    </div>
  </section>

  <!-- JAK TO FUNGUJE (jeden centrovaný sloupec, AI features integrované do kroků) -->
  <section class="lnd-section lnd-section--alt">
    <div class="lnd-wrap">
      <div class="lnd-howto">
        <div class="lnd-section-label">Jak to funguje</div>
        <h2 class="lnd-h2">5 kroků, cca 3 minuty na klienta</h2>
        <ul class="lnd-steps">
          <li class="lnd-step"><span class="lnd-step-num">1</span><div><div class="lnd-step-title">Identifikace klienta</div><div class="lnd-step-text">Naskenujte doklad, nahrajte soubor nebo zadejte údaje ručně. Můžete i vybrat klienta z předchozích AML kontrol.</div><div class="lnd-step-ai">✨ AI rozpozná údaje z dokladu za 3 vteřiny</div></div></li>
          <li class="lnd-step"><span class="lnd-step-num">2</span><div><div class="lnd-step-title">Lustrace v rejstřících</div><div class="lnd-step-text">Automatická kontrola v MVČR, ISIR, ARES, sankčních seznamech EU (osoby i společnosti) a v globální PEP databázi (OpenSanctions).</div><div class="lnd-step-ai">✨ Fuzzy matching jmen i přes překlepy a přepisy</div></div></li>
          <li class="lnd-step"><span class="lnd-step-num">3</span><div><div class="lnd-step-title">Účel obchodu</div><div class="lnd-step-text">Popíšete, co pro klienta děláte.</div><div class="lnd-step-ai">✨ AI přečte podpůrné dokumenty a ověří konzistenci se zdrojem prostředků</div></div></li>
          <li class="lnd-step"><span class="lnd-step-num">4</span><div><div class="lnd-step-title">Riziko</div><div class="lnd-step-text">AI navrhne rizikový profil (nízké / střední / vysoké). Vy rozhodujete závazně.</div></div></li>
          <li class="lnd-step"><span class="lnd-step-num">5</span><div><div class="lnd-step-title">Záznam k archivaci</div><div class="lnd-step-text">Vygenerovaný PDF AML záznam si stáhnete a uložíte do vlastní evidence. PDF záznam s náležitostmi podle § 8 a násl. zákona č. 253/2008 Sb.</div></div></li>
        </ul>
      </div>
    </div>
  </section>

  <!-- CENA (pilot) -->
  <section class="lnd-section" id="lnd-pricing">
    <div class="lnd-wrap lnd-wrap--narrow">
      <div class="lnd-section-label">Cena</div>
      <h2 class="lnd-h2">Zdarma pro prvních 10 povinných osob</h2>
      <p class="lnd-sub">Pilotní přístup zdarma pro první povinné osoby. Napište: <a href="mailto:info@legalid.cz">info@legalid.cz</a></p>
    </div>
    <!-- Ceníkové karty zakomentovány do spuštění Stripe (nemazat, vrátíme se k nim):
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
    -->
  </section>

  <!-- FAQ -->
  <section class="lnd-section lnd-section--alt">
    <div class="lnd-wrap lnd-wrap--narrow">
      <div class="lnd-section-label">Časté otázky</div>
      <div class="lnd-faq">
        <div class="lnd-faq-item">
          <button class="lnd-faq-q" onclick="this.parentElement.classList.toggle('open')">Kdo potřebuje AML kontrolu?<span class="lnd-faq-icon">+</span></button>
          <div class="lnd-faq-a">Povinné osoby podle zákona č. 253/2008 Sb. musí u řady úkonů provést AML kontrolu klienta — např. při správě majetku, zakládání společností nebo transakcích s nemovitostmi. Kdo přesně je povinná osoba, najdete na stránce <a href="/povinne-osoby" onclick="event.preventDefault();navigate('/povinne-osoby')">Povinné osoby</a>.</div>
        </div>
        <div class="lnd-faq-item">
          <button class="lnd-faq-q" onclick="this.parentElement.classList.toggle('open')">Který zákon Legalid řeší?<span class="lnd-faq-icon">+</span></button>
          <div class="lnd-faq-a">Zákon č. 253/2008 Sb. (AML zákon) a související AML směrnice EU.</div>
        </div>
        <div class="lnd-faq-item">
          <button class="lnd-faq-q" onclick="this.parentElement.classList.toggle('open')">Jak Legalid používá AI?<span class="lnd-faq-icon">+</span></button>
          <div class="lnd-faq-a">Pro rozpoznání údajů z dokladu, fuzzy matching jmen v sankčních seznamech a porovnání podpůrných dokumentů. AI je asistent, ne rozhodovatel — všechna AML rozhodnutí podle zákona činíte vy.</div>
        </div>
        <div class="lnd-faq-item">
          <button class="lnd-faq-q" onclick="this.parentElement.classList.toggle('open')">Co když AI něco přehlédne?<span class="lnd-faq-icon">+</span></button>
          <div class="lnd-faq-a">AI je asistent, ne rozhodovatel. Odpovědnost za AML kontrolu nesete vy jako povinná osoba. Fuzzy matching a globální PEP databáze snižují riziko, ale nikdy nezaručují 100 %.</div>
        </div>
        <div class="lnd-faq-item">
          <button class="lnd-faq-q" onclick="this.parentElement.classList.toggle('open')">Jak chráníte data klientů?<span class="lnd-faq-icon">+</span></button>
          <div class="lnd-faq-a">Fotky dokladů se ukládají zašifrovaně, AI je zpracovává v reálném čase bez trénování modelů. Data hostována v EU (Cloudflare + Vercel).</div>
        </div>
        <div class="lnd-faq-item">
          <button class="lnd-faq-q" onclick="this.parentElement.classList.toggle('open')">Kdy bude Legalid veřejně dostupný?<span class="lnd-faq-icon">+</span></button>
          <div class="lnd-faq-a">Pilotní přístup pro prvních 10 povinných osob teď. Veřejné spuštění a ceník do konce Q4 2026.</div>
        </div>
      </div>
    </div>
  </section>

  <!-- KDO ZA LEGALID STOJÍ (TODO: doplnit reálný text a foto) -->
  <section class="lnd-section lnd-section--alt">
    <div class="lnd-wrap lnd-wrap--narrow">
      <div class="lnd-section-label">Kdo za Legalid stojí</div>
      <div class="lnd-about">
        <div class="lnd-about-photo" aria-hidden="true"></div>
        <div class="lnd-about-text">
          <!-- TODO: nahradit placeholder reálným textem (2–3 věty) a fotem. -->
          Legalid staví praktikující právník a vývojář — z frustrace z ručního papírování kolem AML.
          Cílem je nástroj, který advokátovi ušetří čas a přitom drží zákonné náležitosti.
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
