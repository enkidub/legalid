// legalid.cz — js/soukromi/soukromi.js
// Stránka „Zásady zpracování osobních údajů" (route "/soukromi") + sekce Bezpečnost
// (kotva /soukromi#bezpecnost). Každé tvrzení odpovídá realitě kódu (viz report).
//
// OTEVŘENÉ BODY (viz výstup pro uživatele):
//  - [TODO] identifikace provozovatele (firma + IČO) — dodá uživatel (sekce Úvod)
//  - [TODO] retenční politika dat v D1 po zrušení účtu — potvrdí uživatel (Doby uchování)

export function renderSoukromi() {
  return `
<div class="po sk">
  <section class="po-hero">
    <div class="lnd-wrap lnd-wrap--narrow">
      <div class="lnd-section-label">Právní</div>
      <h1 class="po-h1">Zásady zpracování osobních údajů</h1>
      <p class="po-intro">Jak Legalid nakládá s osobními údaji podle nařízení (EU) 2016/679 (GDPR)
        a zákona č. 110/2019 Sb. Popsané postupy odpovídají skutečnému fungování aplikace.</p>
    </div>
  </section>
  <section class="po-list-section">
    <div class="lnd-wrap lnd-wrap--narrow">
      <div class="sk-body">

        <section class="sk-sec">
          <h2 class="sk-h2">Úvod — dvojí role</h2>
          <p>Pro údaje klientů, které do Legalid vkládáte, jste <strong>správcem vy jako povinná osoba</strong>;
          Legalid vystupuje jako <strong>zpracovatel</strong> dle čl. 28 GDPR a údaje zpracovává podle vašich pokynů.</p>
          <p>Pro údaje vašeho uživatelského účtu je správcem provozovatel Legalid —
          <strong>[DOPLNÍ SE: obchodní firma a IČO provozovatele]</strong>.</p>
        </section>

        <section class="sk-sec">
          <h2 class="sk-h2">Co zpracováváme</h2>
          <ul class="sk-list">
            <li><strong>Údaje uživatelského účtu</strong> — e-mail a profil povinné osoby (jméno/firma, sídlo, evidenční údaje, kontakty, logo).</li>
            <li><strong>Identifikační údaje klientů</strong> dle § 5 a § 8 zákona č. 253/2008 Sb. — údaje z dokladu totožnosti, u právnických osob údaje o subjektu a jednající osobě.</li>
            <li><strong>Záznamy o kontrolách a jejich průběhu</strong> (§ 16) — výsledky lustrací s časovými razítky, hodnocení rizika a rozhodnutí.</li>
          </ul>
        </section>

        <section class="sk-sec sk-highlight">
          <h2 class="sk-h2">Co neukládáme</h2>
          <p><strong>Fotografie dokladů totožnosti a podpůrné dokumenty se na serverech Legalid neukládají.</strong>
          Při zpracování protečou k AI analýze a v systému zůstávají pouze extrahovaná data
          a kryptografický otisk dokumentu (SHA-256). Originály dokumentů zůstávají výhradně u vás.</p>
        </section>

        <section class="sk-sec">
          <h2 class="sk-h2">Právní základy zpracování</h2>
          <ul class="sk-list">
            <li><strong>Plnění právní povinnosti</strong> — úkony povinné osoby dle zákona č. 253/2008 Sb.</li>
            <li><strong>Plnění smlouvy</strong> — provoz uživatelského účtu a poskytování služby.</li>
            <li><strong>Oprávněný zájem</strong> — bezpečnost provozu a prevence zneužití.</li>
          </ul>
        </section>

        <section class="sk-sec">
          <h2 class="sk-h2">Sub-procesoři a příjemci dat</h2>
          <p>Pro poskytování služby využíváme následující zpracovatele a rejstříky. Data se předávají
          pouze v rozsahu nezbytném pro daný účel.</p>
          <div class="sk-table-wrap">
            <table class="sk-table">
              <thead><tr><th>Služba</th><th>Účel</th><th>Co se předává</th></tr></thead>
              <tbody>
                <tr><td>Cloudflare (Workers, D1)</td><td>Hosting API a databáze, plánované úlohy</td><td>Data případů a klientů, uživatelské účty (databáze běží v regionu EU — východní Evropa)</td></tr>
                <tr><td>Vercel</td><td>Hosting webové aplikace</td><td>Provozní logy (IP adresa, user-agent)</td></tr>
                <tr><td>Anthropic</td><td>AI čtení dokladů a dokumentů, kontrola konzistence, návrh rizika</td><td>Obraz dokladu/dokumentu a texty případu při zpracování; na straně Anthropic se neukládají a nepoužívají k trénování (zpracovatelská smlouva / DPA)</td></tr>
                <tr><td>Resend</td><td>Transakční e-maily (přihlašovací odkaz, notifikace)</td><td>E-mailová adresa a obsah zprávy</td></tr>
                <tr><td>Google</td><td>Přihlášení přes OAuth</td><td>Autentizační údaje (e-mail, identifikátor účtu)</td></tr>
                <tr><td>OpenSanctions</td><td>Globální PEP screening</td><td>Jméno a datum narození prověřované osoby</td></tr>
                <tr><td>MV ČR — evidence neplatných dokladů</td><td>Ověření platnosti dokladu</td><td>Typ a číslo dokladu</td></tr>
                <tr><td>ISIR (Ministerstvo spravedlnosti)</td><td>Kontrola insolvence</td><td>Jméno, příjmení, datum narození; u právnické osoby IČO</td></tr>
                <tr><td>ARES (MF ČR)</td><td>Ověření podnikatelského subjektu</td><td>IČO</td></tr>
                <tr><td>Konsolidovaný sankční seznam EU</td><td>Zdroj dat pro screening</td><td>Nic — seznam se denně importuje do naší databáze, screening probíhá lokálně; údaje klientů se neodesílají</td></tr>
                <tr><td>Česká PEP databáze (vlastní)</td><td>Screening českých politicky exponovaných osob</td><td>Nic — data jsou lokální, neodesílá se nic</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="sk-sec">
          <h2 class="sk-h2">Kde data žijí</h2>
          <p>Databáze s údaji účtů, klientů a záznamů o kontrolách běží u Cloudflare v regionu
          <strong>EU — východní Evropa</strong>. Webová aplikace je hostována u Vercelu. AI zpracování
          probíhá u Anthropic po dobu nezbytnou pro zpracování, bez trvalého uložení.</p>
        </section>

        <section class="sk-sec">
          <h2 class="sk-h2">Doby uchování</h2>
          <ul class="sk-list">
            <li><strong>Data účtu</strong> — po dobu trvání účtu; výmaz do 30 dnů od zrušení účtu.</li>
            <li><strong>Data kontrol</strong> — po dobu trvání účtu. Zákonnou archivaci záznamů po dobu 10 let
            dle § 16 zákona č. 253/2008 Sb. plní povinná osoba uchováním staženého PDF záznamu ve své evidenci.</li>
          </ul>
        </section>

        <section class="sk-sec">
          <h2 class="sk-h2">Práva subjektů údajů</h2>
          <p>Subjekty údajů mají právo na přístup, opravu a výmaz (s výhradou zákonných povinností
          dle AML předpisů), na přenositelnost údajů a právo vznést námitku.</p>
          <p>Práva uplatníte na <a href="mailto:info@legalid.cz">info@legalid.cz</a>.
          <em>Některá práva mohou být omezena zákonnou povinností uchovávat záznamy dle zákona č. 253/2008 Sb.</em></p>
        </section>

        <section class="sk-sec">
          <h2 class="sk-h2">Cookies a analytika</h2>
          <p>Používáme pouze <strong>technické cookies</strong> nezbytné pro provoz — přihlašovací
          session (a krátkodobě cookie pro ověření přihlášení přes OAuth). <strong>Nepoužíváme reklamní
          cookies ani analytické či trackovací nástroje třetích stran.</strong></p>
          <p>Aplikace načítá dvě knihovny (pro export do Wordu) z veřejné CDN; při tom se nepředávají
          žádné osobní údaje.</p>
        </section>

        <section class="sk-sec" id="bezpecnost">
          <h2 class="sk-h2">Bezpečnost</h2>
          <ul class="sk-list">
            <li><strong>Šifrování přenosu</strong> — veškerá komunikace probíhá přes HTTPS (TLS).</li>
            <li><strong>Šifrování dat v klidu</strong> — data v databázi u Cloudflare jsou šifrována at rest.</li>
            <li><strong>Přístup k datům</strong> — výhradně přes autentizovaný účet (přihlašovací odkaz e-mailem nebo Google OAuth).</li>
            <li><strong>Auditní stopa lustrací</strong> — každá kontrola se ukládá s časovým razítkem jednotlivých lustrací.</li>
            <li><strong>Kryptografický otisk záznamu</strong> — každý vygenerovaný AML záznam má otisk SHA-256.</li>
            <li><strong>Dokumenty klientů se neukládají</strong> — viz sekce <a href="#" onclick="event.preventDefault();document.querySelector('.sk-highlight').scrollIntoView({behavior:'smooth'})">Co neukládáme</a>.</li>
          </ul>
        </section>

        <p class="sk-contact">Dotazy ke zpracování osobních údajů: <a href="mailto:info@legalid.cz">info@legalid.cz</a>.</p>

      </div>
    </div>
  </section>
</div>`;
}

// Po mountu: pokud URL nese #bezpecnost, odscrolluj na sekci Bezpečnost.
export function initSoukromi() {
  const hash = (location.hash || '').replace('#', '');
  if (hash) requestAnimationFrame(() => {
    const el = document.getElementById(hash);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
