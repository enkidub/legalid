// legalid.cz — js/landing/landing.js
// Landing pro nepřihlášené — PLACEHOLDER, zatím nenapojeno na routing.
// Dnes nepřihlášený uživatel vidí přímo Doložku (limit 5 zdarma). Až bude landing aktivní,
// app.js rozhodne mezi landing a Doložkou.
export function renderLanding() {
  return `
    <div style="max-width:560px;margin:80px auto;text-align:center;padding:0 24px;">
      <h1 style="font-family:var(--serif);font-size:32px;color:var(--navy);margin-bottom:16px;">Brzy přijde AML pro advokáty</h1>
      <p style="color:var(--ink-lt);font-size:15px;line-height:1.6;">Připravujeme nástroj pro AML kontrolu klientů. Mezitím můžete využít generátor advokátní doložky.</p>
    </div>`;
}
