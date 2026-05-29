// legalid.cz — js/core/router.js
// Jednoduchý history-based router. Mapování URL -> pohled řeší app.js přes handler.

let routeHandler = () => {};

export function currentPath() {
  return window.location.pathname || '/';
}

// Zaregistruje handler(path) volaný při popstate i navigate. Hned spustí pro aktuální URL.
export function initRouter(handler) {
  routeHandler = handler;
  window.addEventListener('popstate', () => routeHandler(currentPath()));
  routeHandler(currentPath());
}

// Programová navigace: změní URL (pushState) a přemountuje pohled.
export function navigate(path, { replace = false } = {}) {
  if (currentPath() !== path) {
    if (replace) history.replaceState({}, '', path);
    else history.pushState({}, '', path);
  }
  routeHandler(path);
}
