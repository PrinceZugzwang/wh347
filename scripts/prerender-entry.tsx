import { renderToString } from "preact-render-to-string";
import { App } from "../src/ui/App";

export function prerender(): string {
  return renderToString(<App />);
}
