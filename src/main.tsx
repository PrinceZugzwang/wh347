import "@fontsource/public-sans/400.css";
import "@fontsource/public-sans/600.css";
import "@fontsource/public-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";
import { render } from "preact";
import { initAdTag } from "./ui/analytics";
import { App } from "./ui/App";

const root = document.getElementById("app");
if (!root) throw new Error("#app is missing from index.html");
initAdTag();
render(<App />, root);
