// legalid.cz — js/soukromi/soukromi.js
// Stránka „Ochrana osobních údajů" (route "/soukromi").
// TODO: nahradit placeholder plným zněním zásad zpracování osobních údajů (GDPR).

export function renderSoukromi() {
  return `
<div class="po">
  <section class="po-hero">
    <div class="lnd-wrap lnd-wrap--narrow">
      <div class="lnd-section-label">Právní</div>
      <h1 class="po-h1">Ochrana osobních údajů</h1>
      <p class="po-intro">Zásady zpracování osobních údajů podle nařízení GDPR a zákona č. 110/2019 Sb.</p>
    </div>
  </section>
  <section class="po-list-section">
    <div class="lnd-wrap lnd-wrap--narrow">
      <!-- TODO: doplnit plné znění zásad ochrany osobních údajů. Níže pracovní placeholder. -->
      <div class="soukromi-body">
        <p><strong>TODO — pracovní text.</strong> Tato stránka zatím obsahuje pouze placeholder.
        Finální znění zásad ochrany osobních údajů bude doplněno.</p>
        <p>Legalid zpracovává osobní údaje v souladu s nařízením (EU) 2016/679 (GDPR) a zákonem
        č. 110/2019 Sb. Fotografie dokladů jsou zpracovávány externím poskytovatelem AI služeb
        na základě zpracovatelské smlouvy dle čl. 28 GDPR a nejsou uchovávány déle, než je nezbytné.
        Data jsou hostována v EU.</p>
        <p>Dotazy ke zpracování osobních údajů: <a href="mailto:info@legalid.cz">info@legalid.cz</a>.</p>
      </div>
    </div>
  </section>
</div>`;
}
