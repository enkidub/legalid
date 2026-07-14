# Nahrání demo videa AML wizardu

Skript `record-landing-demo.mjs` projede AML wizard na produkci (legalid.cz)
a nahraje z toho video (Playwright + Chromium). Nic nemaže — vytvoří jen jeden
testovací AML case, jehož ID vypíše na konci (můžeš ho ignorovat / ručně smazat).

## 1. Instalace (jednorázově)

```bash
npm i -D playwright
npx playwright install chromium
```

## 2. Session cookie (přihlášení)

Skript se přihlásí přes tvou session cookie. Cookie se jmenuje **`session`** a patří
doméně **`legalid.kuba-houser.workers.dev`** (backend worker; je to cross-site cookie
`SameSite=None`, proto ji frontend na legalid.cz posílá na API workeru).

Jak ji zkopírovat z DevTools:

1. Přihlas se normálně na **https://legalid.cz**.
2. Otevři **DevTools** (F12) → záložka **Application** (Chrome) / **Storage** (Firefox).
3. Vlevo **Cookies** → vyber **`https://legalid.kuba-houser.workers.dev`**
   (ne legalid.cz — cookie je na doméně workeru).
4. Najdi řádek **`session`** a zkopíruj celou hodnotu (Value) — je to dlouhý JWT
   (`eyJ...` se dvěma tečkami).

> Pozn.: cookie je `HttpOnly`, takže ji nepřečteš přes `document.cookie` v konzoli —
> musíš ji vzít z panelu Application/Storage.

## 3. Spuštění

```bash
# macOS / Linux
LEGALID_SESSION="eyJhbGciOi...celý.jwt.token" node scripts/record-landing-demo.mjs

# Windows PowerShell
$env:LEGALID_SESSION="eyJhbGciOi...celý.jwt.token"; node scripts/record-landing-demo.mjs
```

Video se uloží do `scripts/output/` (soubor `*.webm`). Cestu skript vypíše.

## 4. Konverze na MP4 pro landing

```bash
ffmpeg -i vystup.webm -vf "scale=1280:-2,fps=24" -c:v libx264 -crf 28 -an -movflags +faststart wizard-demo.mp4
```

Výsledný `wizard-demo.mp4` nahraj do `assets/landing/` a v `js/landing/landing.js`
vyměň `<img …>` za `<video autoplay loop muted playsinline src="/assets/landing/wizard-demo.mp4">`
(CSS pro video variantu je připravené — `.lnd-proof-media video`).

## Co skript dělá

- viewport 1440×900, video 1440×900, locale cs-CZ, timezone Europe/Prague
- skryje install banner (`installBannerDismissed`) a pravou část hlavičky s e-mailem (`#headerAuth`)
- projde: legalid.cz → AML wizard → nový případ → Fyzická osoba → Zadat ručně →
  vyplní Jan Novák / 15.03.1985 / OP / 123456789 / platnost 01.01.2030 / občanství
  (lidsky, s prodlevami) → Pokračovat na lustraci → počká na dokončení všech lustrací
  (max 60 s) → 2,5 s pauza na výsledku → konec
- na konci vypíše cestu k videu a **ID vytvořeného AML case**
