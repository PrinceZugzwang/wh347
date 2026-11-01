/**
 * Usage counting. Event names and properties never include anything from the
 * payroll file: only counts, file types and which button was used.
 */

type Props = Record<string, string | number | boolean>;

declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: Props }) => void;
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const ADS_ID = "AW-18525221637";
const PDF_CONVERSION = "AW-18525221637/6Ad1COeq4a8dEIXmwYFF";

export function track(event: string, props?: Props): void {
  window.plausible?.(event, props ? { props } : undefined);
}

/**
 * The Google Ads tag only loads for visitors who arrived from one of our ads
 * (the click adds a gclid to the URL), so other visitors get no ad cookies.
 */
export function initAdTag(): void {
  const params = new URLSearchParams(window.location.search);
  let fromAd = params.has("gclid") || params.has("gbraid") || params.has("wbraid");
  try {
    if (fromAd) sessionStorage.setItem("wh347:from-ad", "1");
    else fromAd = sessionStorage.getItem("wh347:from-ad") === "1";
  } catch {
    // Without session storage only the landing page view can be attributed.
  }
  if (!fromAd) return;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${ADS_ID}`;
  document.head.append(script);
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() {
    // gtag.js reads the arguments object itself, so it has to be pushed as is.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer?.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", ADS_ID);
}

export function adConversion(): void {
  window.gtag?.("event", "conversion", { send_to: PDF_CONVERSION });
}

/** Records a download and reports when it's from a later week than the last one: the repeat use we care about. */
export function noteDownload(): void {
  const now = Date.now();
  try {
    const last = Number(localStorage.getItem("wh347:last-download") ?? 0);
    const count = Number(localStorage.getItem("wh347:downloads") ?? 0) + 1;
    localStorage.setItem("wh347:last-download", String(now));
    localStorage.setItem("wh347:downloads", String(count));
    const days = Math.floor((now - last) / 86_400_000);
    if (last > 0 && days >= 3) track("Came back", { days, downloads: count });
  } catch {
    // Storage blocked: repeat use just isn't counted.
  }
}
