import "./page";
import { track } from "../ui/analytics";

document.getElementById("join")?.addEventListener("click", () => track("Prime interest"));
