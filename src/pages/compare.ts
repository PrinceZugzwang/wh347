import "./page";
import { track } from "../ui/analytics";

// The switching offer: Pro free for a year with a competitor's invoice.
for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-switch]")) {
  link.addEventListener("click", () => track("Switch offer", { source: link.dataset.switch ?? "" }));
}
