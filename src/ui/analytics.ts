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
    fbq?: ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown };
    _fbq?: unknown;
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
 * The arrival is remembered for 90 days, the conversion window, so someone who
 * clicks an ad and comes back later to finish their payroll is still counted.
 */
const AD_VISIT_KEY = "wh347:from-ad";
const META_VISIT_KEY = "wh347:from-meta";
const META_PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID as string | undefined;
const AD_WINDOW_MS = 90 * 86_400_000;

/** True when this visit came from an ad (its click id is in the URL) or one did in the last 90 days. */
function cameFromAd(params: URLSearchParams, ids: string[], key: string): boolean {
  let fromAd = ids.some((id) => params.has(id));
  try {
    if (fromAd) localStorage.setItem(key, String(Date.now()));
    else {
      const since = Number(localStorage.getItem(key) ?? 0);
      fromAd = since > 0 && Date.now() - since < AD_WINDOW_MS;
    }
  } catch {
    // Without storage only the landing visit can be attributed.
  }
  return fromAd;
}

/** Meta's pixel, under the same rule as the Google tag: only for visitors who came from a Meta ad. */
function initMetaPixel(params: URLSearchParams): void {
  if (!META_PIXEL_ID || !cameFromAd(params, ["fbclid"], META_VISIT_KEY)) return;
  // Meta's standard stub: calls queue until fbevents.js loads and supplies callMethod.
  type Fbq = NonNullable<Window["fbq"]> & { callMethod?: (...args: unknown[]) => void };
  const fbq: Fbq = Object.assign(
    function (...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue?.push(args);
    },
    { queue: [] as unknown[], loaded: true, version: "2.0" },
  );
  fbq.push = fbq;
  window.fbq = fbq;
  window._fbq = fbq;
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.append(script);
  window.fbq("init", META_PIXEL_ID);
  window.fbq("track", "PageView");
}

export function metaEvent(name: "Lead" | "CompleteRegistration" | "Subscribe", params?: Props): void {
  window.fbq?.("track", name, params);
}

export function initAdTag(): void {
  const params = new URLSearchParams(window.location.search);
  initMetaPixel(params);
  if (!cameFromAd(params, ["gclid", "gbraid", "wbraid"], AD_VISIT_KEY)) return;

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
  metaEvent("Lead");
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
