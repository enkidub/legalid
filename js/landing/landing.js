// legalid.cz — js/landing/landing.js
// Marketingový landing pro nepřihlášené uživatele (route "/").
// CTA volají window-bridged funkce: openRegistrationModal, navigate, selectPlan, openPrivacyModal, openAboutModal.

import { navigate } from '../core/router.js';
import { initExitIntentDemo } from '../demo/demo.js';

// Exit-intent demo popup (Blok B4) — VYPNUTO. Zapni změnou na true (žádný popup při načtení).
const EXIT_INTENT_DEMO = false;

// Skok na sekci landingu z hlavičky/patičky/hamburgeru (i z jiné routy).
// anchor: 'howto' → .lnd-howto | 'pricing'/'cenik' → #cenik (Pilotní přístup)
export function gotoLandingSection(anchor) {
  const sel = (anchor === 'pricing' || anchor === 'cenik') ? '#cenik' : '.lnd-howto';
  const doScroll = () => {
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  if (document.querySelector('.lnd')) {
    doScroll();
  } else {
    navigate('/');                                   // mountRoute vykreslí landing synchronně
    requestAnimationFrame(() => requestAnimationFrame(doScroll));
  }
}

export function renderLanding() {
  return `
<div class="lnd">

  <!-- HERO -->
  <section class="lnd-hero">
    <div class="lnd-wrap">
      <h1 class="lnd-h1">AML kontrola klientů za 3 minuty</h1>
      <p class="lnd-sub">Splňte AML povinnosti podle zákona č. 253/2008 Sb. — bez tabulek a papírování.</p>
      <div class="lnd-cta-row">
        <button class="lnd-btn lnd-btn-primary" onclick="openRegistrationModal()">Vyzkoušet zdarma</button>
        <button class="lnd-btn lnd-btn-ghost" onclick="openDemoModal()">Domluvit ukázku</button>
      </div>
      <div class="lnd-hero-trust">Záznam dle § 8 a násl. · 8 kontrol v jedné lustraci · doklady i dokumenty se čtou samy · Archiv dle § 16</div>

      <!-- Product proof — rámeček ve stylu prohlížečového okna.
           Click-to-play (bez autoplay/loop): přes poster velký play button; klik →
           přehrání s native controls; po skončení návrat na poster. Ovládá initLanding(). -->
      <div class="lnd-proof">
        <div class="lnd-proof-bar"><span></span><span></span><span></span></div>
        <div class="lnd-proof-media">
          <video id="lndProofVideo" src="/assets/landing/wizard-demo.mp4" muted playsinline preload="metadata"
                 poster="/assets/landing/wizard-demo-poster.png"
                 aria-label="Ukázka AML wizardu Legalid — vyplnění údajů klienta a lustrace v rejstřících"></video>
          <button class="lnd-proof-play" id="lndProofPlay" type="button" aria-label="Přehrát ukázku">
            <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
          </button>
        </div>
      </div>
    </div>
  </section>

  <!-- CO UMÍME -->
  <section class="lnd-section">
    <div class="lnd-wrap">
      <div class="lnd-section-label">Co umíme</div>
      <div class="lnd-cards lnd-cards--duo">
        <div class="lnd-card lnd-card--primary">
          <div class="lnd-card-icon"><i class="ti ti-shield-check"></i></div>
          <div class="lnd-card-title">AML kontrola</div>
          <div class="lnd-card-text">Identifikace klienta, lustrace sankcí a PEP, hodnocení rizika a záznam k archivaci.</div>
          <button class="lnd-btn lnd-btn-primary lnd-btn-sm" onclick="openRegistrationModal()">Vyzkoušet zdarma</button>
        </div>
        <div class="lnd-card">
          <div class="lnd-card-icon"><i class="ti ti-cloud-lock"></i></div>
          <div class="lnd-card-title">Archivace</div>
          <div class="lnd-card-text">AML záznamy s náležitostmi podle § 8 a násl. k dispozici pro pozdější dohledání a export.</div>
          <span class="lnd-card-badge">✓ Součást AML kontroly</span>
        </div>
      </div>
    </div>
  </section>

  <!-- 8 KONTROL — grid rejstříků a sankčních seznamů -->
  <section class="lnd-section lnd-section--alt">
    <div class="lnd-wrap">
      <div class="lnd-section-label">Kontroly a rejstříky</div>
      <h2 class="lnd-h2">8 kontrol v jedné lustraci</h2>
      <p class="lnd-lead">Jedním kliknutím prověříme klienta ve veřejných rejstřících a sankčních seznamech — s časovým razítkem.</p>
      <div class="lnd-grid">
        <div class="lnd-gcard">
          <div class="lnd-gcard-top"><span class="lnd-gcard-icon"><i class="ti ti-id-badge-2"></i></span><span class="lnd-gcard-state is-active">Aktivní</span></div>
          <div class="lnd-gcard-title">Neplatné doklady (MVČR)</div>
          <div class="lnd-gcard-text">Odhalí ztracený nebo odcizený průkaz totožnosti.</div>
        </div>
        <div class="lnd-gcard">
          <div class="lnd-gcard-top"><span class="lnd-gcard-icon"><i class="ti ti-gavel"></i></span><span class="lnd-gcard-state is-active">Aktivní</span></div>
          <div class="lnd-gcard-title">Insolvenční rejstřík (ISIR)</div>
          <div class="lnd-gcard-text">Insolvence klienta i firmy dřív, než uzavřete obchod.</div>
        </div>
        <div class="lnd-gcard">
          <div class="lnd-gcard-top"><span class="lnd-gcard-icon"><i class="ti ti-building-community"></i></span><span class="lnd-gcard-state is-active">Aktivní</span></div>
          <div class="lnd-gcard-title">ARES (podnikatelské subjekty)</div>
          <div class="lnd-gcard-text">Existence a stav podnikatelského subjektu.</div>
        </div>
        <div class="lnd-gcard">
          <div class="lnd-gcard-top"><span class="lnd-gcard-icon"><i class="ti ti-user-cancel"></i></span><span class="lnd-gcard-state is-active">Aktivní</span></div>
          <div class="lnd-gcard-title">Sankční seznam EU — osoby</div>
          <div class="lnd-gcard-text">4 400+ sankcionovaných osob, denní aktualizace.</div>
        </div>
        <div class="lnd-gcard">
          <div class="lnd-gcard-top"><span class="lnd-gcard-icon"><i class="ti ti-building-bank"></i></span><span class="lnd-gcard-state is-active">Aktivní</span></div>
          <div class="lnd-gcard-title">Sankční seznam EU — společnosti</div>
          <div class="lnd-gcard-text">Sankcionované firmy a entity, denní aktualizace.</div>
        </div>
        <div class="lnd-gcard">
          <div class="lnd-gcard-top"><span class="lnd-gcard-icon"><i class="ti ti-user-star"></i></span><span class="lnd-gcard-state is-active">Aktivní</span></div>
          <div class="lnd-gcard-title">PEP databáze (ČR + globální)</div>
          <div class="lnd-gcard-text">Politicky exponované osoby vč. globálního pokrytí (OpenSanctions).</div>
        </div>
        <div class="lnd-gcard">
          <div class="lnd-gcard-top"><span class="lnd-gcard-icon"><i class="ti ti-world"></i></span><span class="lnd-gcard-state is-active">Aktivní</span></div>
          <div class="lnd-gcard-title">Sankce OSN + národní seznam MZV ČR</div>
          <div class="lnd-gcard-text">Konsolidovaný seznam Rady bezpečnosti OSN a národní seznam MZV ČR (zákon č. 1/2023 Sb.), denní aktualizace.</div>
        </div>
        <div class="lnd-gcard lnd-gcard--soon">
          <div class="lnd-gcard-top"><span class="lnd-gcard-icon"><i class="ti ti-news"></i></span><span class="lnd-gcard-state is-soon">Připravujeme</span></div>
          <div class="lnd-gcard-title">Negativní média s AI posouzením</div>
          <div class="lnd-gcard-text">Zmínky v médiích s AI vyhodnocením, zda jde skutečně o vašeho klienta a zda je zmínka relevantní.</div>
        </div>
      </div>
    </div>
  </section>

  <!-- JAK TO FUNGUJE — horizontální timeline (5 kroků) -->
  <section class="lnd-section">
    <div class="lnd-wrap">
      <div class="lnd-howto">
        <div class="lnd-section-label">Jak to funguje</div>
        <h2 class="lnd-h2">5 kroků, cca 3 minuty na klienta</h2>
        <ol class="lnd-timeline">
          <li class="lnd-tl-step">
            <div class="lnd-tl-num">1</div>
            <div class="lnd-tl-title">Údaje klienta</div>
            <div class="lnd-tl-text">Vyfoťte doklad, nahrajte soubor nebo vyberte existujícího klienta. Údaje se vyplní samy během vteřin.</div>
          </li>
          <li class="lnd-tl-step">
            <div class="lnd-tl-num">2</div>
            <div class="lnd-tl-title">Lustrace</div>
            <div class="lnd-tl-text">Jedno kliknutí spustí 8 kontrol v rejstřících a sankčních seznamech. Každá s časovým razítkem.</div>
          </li>
          <li class="lnd-tl-step">
            <div class="lnd-tl-num">3</div>
            <div class="lnd-tl-title">Účel obchodu</div>
            <div class="lnd-tl-text">Popíšete obchod a zdroj prostředků. Doložené dokumenty se automaticky porovnají s deklarací.</div>
          </li>
          <li class="lnd-tl-step">
            <div class="lnd-tl-num">4</div>
            <div class="lnd-tl-title">Riziko</div>
            <div class="lnd-tl-text">Systém navrhne rizikový profil s odůvodněním. Závazně rozhodujete vy.</div>
          </li>
          <li class="lnd-tl-step">
            <div class="lnd-tl-num">5</div>
            <div class="lnd-tl-title">Záznam</div>
            <div class="lnd-tl-text">PDF záznam s náležitostmi § 8 a násl. stáhnete a uložíte do své evidence.</div>
          </li>
        </ol>
      </div>
    </div>
  </section>

  <!-- PRÁVNÍ UKOTVENÍ — dvousloupcový layout (intro vlevo, § karty vpravo) -->
  <section class="lnd-section lnd-section--alt">
    <div class="lnd-wrap">
      <div class="lnd-legal-grid">
        <div class="lnd-legal-intro">
          <div class="lnd-section-label">Právní ukotvení</div>
          <h2 class="lnd-h2">Postaveno přesně na zákoně <em class="lnd-gold-i">253/2008 Sb.</em></h2>
          <p class="lnd-lead">Každý výstup Legalid odpovídá konkrétním paragrafům AML zákona — od identifikace přes hodnocení rizika po archivaci. Nemusíte hlídat, co má záznam obsahovat.</p>
        </div>
        <div class="lnd-legal-cards">
          <div class="lnd-lcard">
            <span class="lnd-lcard-ico" aria-hidden="true">§</span>
            <div class="lnd-lcard-body">
              <div class="lnd-lcard-tag">§ 7–8 · Identifikace klienta</div>
              <div class="lnd-lcard-text">Povinnost identifikace při obchodu nad 1 000 EUR i u podezřelého obchodu. Legalid vede identifikaci krok za krokem a vytvoří záznam se všemi náležitostmi.</div>
            </div>
          </div>
          <div class="lnd-lcard">
            <span class="lnd-lcard-ico" aria-hidden="true">§</span>
            <div class="lnd-lcard-body">
              <div class="lnd-lcard-tag">§ 9 · Kontrola klienta</div>
              <div class="lnd-lcard-text">Zjištění účelu obchodu, přezkoumání zdrojů prostředků a průběžné sledování obchodního vztahu. V Legalid včetně AI kontroly konzistence s doloženými dokumenty.</div>
            </div>
          </div>
          <div class="lnd-lcard">
            <span class="lnd-lcard-ico" aria-hidden="true">§</span>
            <div class="lnd-lcard-body">
              <div class="lnd-lcard-tag">§ 16 · Uchovávání záznamů</div>
              <div class="lnd-lcard-text">Údaje a doklady o obchodech se uchovávají 10 let. Legalid generuje PDF záznam s časovými razítky a hashem pro důkazní integritu.</div>
            </div>
          </div>
          <div class="lnd-lcard">
            <span class="lnd-lcard-ico" aria-hidden="true">§</span>
            <div class="lnd-lcard-body">
              <div class="lnd-lcard-tag">§ 21 a § 21a · Vnitřní zásady a hodnocení rizik</div>
              <div class="lnd-lcard-text">Povinná osoba uplatňuje systém vnitřních zásad a písemné hodnocení rizik. Záznamy z Legalid slouží jako podklad rizikově orientovaného přístupu.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- UKÁZKA ZÁZNAMU — vygenerovaná z reálné pdf-lib šablony (scripts/render-zaznam-ukazka.mjs) -->
  <section class="lnd-section">
    <div class="lnd-wrap">
      <div class="lnd-zaznam">
        <div class="lnd-zaznam-media">
          <img src="/assets/landing/zaznam-ukazka.png" alt="Ukázka první strany AML záznamu z Legalid: hlavička s číslem kontroly, identifikace klienta dle § 8, výsledky lustrací s časovými razítky, hodnocení rizika a kryptografický otisk SHA-256." loading="lazy">
        </div>
        <div class="lnd-zaznam-text">
          <div class="lnd-section-label">Výstup</div>
          <h2 class="lnd-h2">Takto vypadá váš AML záznam</h2>
          <ul class="lnd-zaznam-feat">
            <li><span class="lnd-zaznam-tick">✓</span> Náležitosti § 8 a násl.</li>
            <li><span class="lnd-zaznam-tick">✓</span> Časová razítka všech lustrací</li>
            <li><span class="lnd-zaznam-tick">✓</span> Kryptografický otisk SHA-256</li>
          </ul>
        </div>
      </div>
    </div>
  </section>

  <!-- CENA (pilot) -->
  <!-- Sekce Ceník skryta pro fázi free (pilot zdarma pro prvních 10 testerů).
       Vrátíme se k ní při spuštění předplatného — původní znění včetně cenových
       karet je v gitu (commit s vypnutím Pro/ceníku). -->

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

  <!-- KDO ZA LEGALID STOJÍ — dočasně skryto (chybí reálný text a foto). Vrátit až s obsahem:
  <section class="lnd-section">
    <div class="lnd-wrap lnd-wrap--narrow">
      <div class="lnd-section-label">Kdo za Legalid stojí</div>
      <div class="lnd-about">
        <div class="lnd-about-photo" aria-hidden="true"></div>
        <div class="lnd-about-text">
          Legalid staví praktikující právník a vývojář — z frustrace z ručního papírování kolem AML.
          Cílem je nástroj, který povinné osobě ušetří čas a přitom drží zákonné náležitosti.
        </div>
      </div>
    </div>
  </section>
  -->

  <!-- PILOTNÍ PŘÍSTUP (cíl kotvy #cenik) -->
  <section class="lnd-section" id="cenik">
    <div class="lnd-wrap lnd-wrap--narrow">
      <div class="lnd-pilot">
        <div class="lnd-pilot-eyebrow">Pilotní přístup</div>
        <h2 class="lnd-pilot-title">Pilotní přístup zdarma</h2>
        <p class="lnd-pilot-text">Prvních 30 povinných osob získává plný přístup zdarma výměnou za zpětnou vazbu — a garanci zaváděcí ceny po spuštění ceníku.</p>
        <button class="lnd-btn lnd-btn-primary" onclick="openRegistrationModal()">Vyzkoušet zdarma</button>
      </div>
    </div>
  </section>

  <!-- DEMO CTA sekce (Blok B) -->
  <section class="lnd-section lnd-demo">
    <div class="lnd-wrap lnd-wrap--narrow">
      <div class="lnd-demo-inner">
        <h2 class="lnd-h2">Chcete to vidět naživo?</h2>
        <p class="lnd-sub">20 minut online, ukážeme vám celý průběh AML kontroly na reálném příkladu.</p>
        <button class="lnd-btn lnd-btn-primary" onclick="openDemoModal()">Domluvit ukázku</button>
      </div>
    </div>
  </section>

  <!-- Patička je globální (index.html #siteFooter) — sdílená s aplikací. -->

  <!-- Sticky CTA (jen mobil, zobrazí se po odscrollování hero) -->
  <div class="lnd-sticky-cta">
    <button class="lnd-btn lnd-btn-primary lnd-btn-block" onclick="openRegistrationModal()">Vyzkoušet zdarma</button>
  </div>

</div>`;
}

let _stickyIo = null;

// Volá se po mountu landingu (app.js). Sticky CTA se odhalí, až hero opustí viewport.
export function initLanding() {
  // Product-proof video: CLICK-TO-PLAY. Nic se nehýbe samo (žádný autoplay/loop),
  // takže prefers-reduced-motion už není blokující. Poster + play button; klik →
  // přehrání s native controls; po skončení návrat na poster.
  const video = document.getElementById('lndProofVideo');
  const playBtn = document.getElementById('lndProofPlay');
  if (video && playBtn) {
    const showPoster = () => {
      video.controls = false;
      video.pause();
      try { video.currentTime = 0; } catch {}
      video.load();                       // obnoví poster
      playBtn.style.display = '';
      video.classList.remove('is-playing');
    };
    playBtn.addEventListener('click', () => {
      playBtn.style.display = 'none';
      video.controls = true;
      video.classList.add('is-playing');
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => { showPoster(); });
    });
    video.addEventListener('ended', showPoster);
  }

  initExitIntentDemo(EXIT_INTENT_DEMO);   // default false → žádný listener

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
