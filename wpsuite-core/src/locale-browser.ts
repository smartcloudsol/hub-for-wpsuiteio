import { getSiteLocaleRuntime, matchLocale } from "./locale";

const runtime = getSiteLocaleRuntime();
// A plugin may have loaded core before the WordPress inline configuration.
runtime.configure(globalThis.WpSuiteLocaleConfig ?? {});
const update = () => {
  const snapshot = runtime.getSnapshot();
  if (snapshot.routeMode === "app") {
    document.documentElement.lang = snapshot.locale;
    document.documentElement.dir = snapshot.direction;
  }
  document.querySelectorAll<HTMLElement>("[data-wpsuite-locale]").forEach((item) => {
    const current = matchLocale(item.dataset.wpsuiteLocale, [snapshot.locale]) === snapshot.locale;
    if (current) item.setAttribute("aria-current", "true");
    else item.removeAttribute("aria-current");
  });
};
runtime.subscribe(update);
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", update, { once: true });
update();
window.dispatchEvent(new CustomEvent("wpsuite:locale:change", { detail: runtime.getSnapshot() }));
window.addEventListener("popstate", () => runtime.configure({}));
document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const item = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-wpsuite-locale]") : null;
  const locale = item?.dataset.wpsuiteLocale;
  if (!locale || item?.getAttribute("aria-disabled") === "true") return;
  const mode = runtime.getSnapshot().routeMode;
  if (mode === "docs" || mode === "docs-entry") return; // Docusaurus route bridge owns navigation.
  const target = item.dataset.wpsuiteLocaleUrl || item.getAttribute("href");
  if (mode === "content" && !target) return;
  event.preventDefault();
  runtime.setLocale(locale);
  if (mode === "content" && target) window.location.assign(target);
});
