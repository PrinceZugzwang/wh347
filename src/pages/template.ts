import "./page";
import { track } from "../ui/analytics";
import { downloadWorkbook } from "../ui/excel";

document.getElementById("download")?.addEventListener("click", () => {
  void downloadWorkbook("certified-payroll-template.xlsx", null, [], null);
  track("Template downloaded");
});
