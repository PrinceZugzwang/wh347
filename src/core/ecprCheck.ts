/**
 * Checks a California DIR eCPR XML file (version 2) against the rules DIR
 * publishes in its V2 guide, before the contractor uploads it:
 *   https://www.dir.ca.gov/Public-Works/cpr/eCPR-XML-Guidelines-V2.pdf
 *
 * It runs in the browser on a file the user picks, so nothing is uploaded.
 * DIR's own validator stays the final word: some figures (totals, gross and
 * net pay) are stored as entered and never cross-checked by DIR, so they are
 * only checked here where the guide gives a rule.
 */

export interface EcprProblem {
  /** Where in the file, for example "Employee 3 (Ruiz) › classification Electrician › day 5". */
  where: string;
  message: string;
  /** Anchor on the error library page that explains the fix. */
  topic: string;
}

export interface EcprReport {
  ok: boolean;
  employees: number;
  weekEnding: string;
  problems: EcprProblem[];
}

const REMOVED_V1 = [
  "contractorLicense",
  "contractorFEIN",
  "contractorAddress",
  "insuranceNum",
  "contractorEmail",
  "contractAgencyID",
  "contractAgency",
  "projectName",
  "awardingBodyID",
  "projectNum",
  "contractID",
  "projectLocation",
];

const EMPLOYEE_ORDER = [
  "firstName",
  "lastName",
  "middleName",
  "address",
  "ssn",
  "itin",
  "notes",
  "classifications",
  "payments",
  "deductions",
  "earnings",
];
const CLASSIFICATION_ORDER = [
  "craft",
  "employeeLevel",
  "apprenticeLevel",
  "hrsWorkedEachDay",
  "fringePaid",
  "fringe",
  "totHrs",
  "hrlyPayRate",
];
const FRINGES = ["healthWelfare", "vacationHoliday", "pension", "training", "other"];
const RATES = [
  "hrlyPayRateStraightTime",
  "hrlyPayRateOvertime",
  "hrlyPayRateDoubletime",
  "totalHrlyPayRateStraightTime",
  "totalHrlyPayRateOvertime",
  "totalHrlyPayRateDoubletime",
];
const DEDUCTIONS = ["fedTax", "FICA", "stateTax", "SDI", "fundAdmin", "savings", "dues", "other"];
const EARNINGS = ["grossThisProject", "grossAllWork", "netWagePaidWeek"];

const kids = (el: Element | null | undefined, name?: string): Element[] =>
  el ? [...el.children].filter((c) => name === undefined || c.localName === name) : [];
const kid = (el: Element | null | undefined, name: string): Element | null => kids(el, name)[0] ?? null;
const text = (el: Element | null | undefined): string => (el?.textContent ?? "").trim();

function isDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A non-negative number with at most two decimals, below `max`. */
function amount(s: string, max: number): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n < max ? n : null;
}

export function checkEcpr(
  xml: string,
  parse: (s: string) => Document = (s) => new DOMParser().parseFromString(s, "application/xml"),
): EcprReport {
  const problems: EcprProblem[] = [];
  const add = (where: string, message: string, topic: string) => problems.push({ where, message, topic });
  const report = (employees = 0, weekEnding = ""): EcprReport => ({ ok: problems.length === 0, employees, weekEnding, problems });

  const doc = parse(xml);
  const parseError = doc.getElementsByTagName("parsererror")[0];
  if (parseError || !doc.documentElement) {
    add(
      "Whole file",
      "This isn't well-formed XML, so DIR can't read it. Usually a tag is left open or a character like & isn't escaped.",
      "not-xml",
    );
    return report();
  }
  const root = doc.documentElement;
  if (root.localName !== "eCPR") {
    add("Whole file", `The file starts with <${root.tagName}>, not <CPR:eCPR>. It may be another state's format or a V1 file.`, "root");
    return report();
  }

  for (const name of REMOVED_V1) {
    if (root.getElementsByTagNameNS("*", name).length || root.getElementsByTagName(name).length)
      add("Whole file", `<${name}> was removed in version 2 and makes the upload fail. Delete it.`, "v1-fields");
  }

  const version = text(kid(root, "version"));
  if (!/^2\.\d+$/.test(version)) add("Version", `Version is "${version || "missing"}". Version 2 files must say 2.0.`, "version");

  const contractor = kid(root, "contractorInfo");
  const contractorName = text(kid(contractor, "contractorName"));
  if (!contractorName) add("Contractor", "Contractor name is missing.", "contractor");
  else if (contractorName.length > 56)
    add("Contractor", `Contractor name is ${contractorName.length} characters; the limit is 56.`, "lengths");
  const pwcr = text(kid(contractor, "contractorPWCR"));
  if (!/^\d{10}$/.test(pwcr))
    add(
      "Contractor",
      `Registration number is "${pwcr || "missing"}". It must be your 10-digit DIR PWCR number; "NA" is no longer accepted.`,
      "pwcr",
    );

  const project = kid(root, "projectInfo");
  const awarding = text(kid(project, "awardingBody"));
  if (awarding.length > 56) add("Project", `Awarding body is ${awarding.length} characters; the limit is 56.`, "lengths");
  const projectId = text(kid(project, "projectID"));
  if (!/^\d+$/.test(projectId))
    add(
      "Project",
      `Project ID is "${projectId || "missing"}". Use the numeric DIR project ID from the PWC-100 registration.`,
      "project-id",
    );

  const payroll = kid(root, "payrollInfo");
  if (!payroll) {
    add("Payroll", "The <payrollInfo> section is missing.", "structure");
    return report();
  }
  const np = text(kid(payroll, "statementOfNP"));
  if (np !== "true" && np !== "false")
    add("Payroll", `Statement of non-performance is "${np || "missing"}". It must be true or false, in lower case.`, "non-performance");
  const weekEnding = text(kid(payroll, "forWeekEnding"));
  const weekOk = isDate(weekEnding) && weekEnding >= "2010-01-07";
  if (!weekOk) add("Payroll", `Week ending "${weekEnding || "missing"}" isn't a real date in YYYY-MM-DD form.`, "dates");
  for (const sys of ["payrollNum", "amendmentNum"]) {
    if (text(kid(payroll, sys))) add("Payroll", `<${sys}> must be left empty; DIR assigns it.`, "system-fields");
  }

  const employees = kids(kid(payroll, "employees"), "employee");
  if (np === "false" && employees.length === 0)
    add("Payroll", "No employees are listed. For a week with no work, set statementOfNP to true instead.", "non-performance");
  if (employees.length > 500)
    add("Payroll", `${employees.length} employees; DIR takes at most 500 per file. Split it into two files.`, "too-many");
  if (np === "true") return report(employees.length, weekEnding);

  const ssns = new Map<string, number>();
  employees.forEach((emp, i) => {
    const last = text(kid(emp, "lastName"));
    const who = `Employee ${i + 1}${last ? ` (${last})` : ""}`;

    const order = kids(emp)
      .map((c) => c.localName)
      .filter((n) => EMPLOYEE_ORDER.includes(n));
    const expected = EMPLOYEE_ORDER.filter((n) => order.includes(n));
    if (order.join() !== expected.join()) add(who, `Fields are out of order. DIR expects: ${EMPLOYEE_ORDER.join(", ")}.`, "order");

    for (const [name, max] of [
      ["firstName", 56],
      ["lastName", 56],
    ] as const) {
      const v = text(kid(emp, name));
      if (!v) add(who, `${name === "firstName" ? "First" : "Last"} name is missing.`, "names");
      else if (v.length > max) add(who, `${name} is ${v.length} characters; the limit is ${max}.`, "lengths");
    }
    if (text(kid(emp, "middleName")).length > 56) add(who, "Middle name is over 56 characters.", "lengths");

    const addr = kid(emp, "address");
    const street = text(kid(addr, "street"));
    const city = text(kid(addr, "city"));
    if (!street || street.length > 100) add(who, street ? "Street is over 100 characters." : "Street address is missing.", "address");
    if (!city || city.length > 250) add(who, city ? "City is over 250 characters." : "City is missing.", "address");
    if (!/^[A-Z]{2}$/.test(text(kid(addr, "state"))))
      add(who, `State "${text(kid(addr, "state"))}" must be two capital letters, like CA.`, "address");
    if (!/^\d{5}(-\d{4})?$/.test(text(kid(addr, "zip"))))
      add(who, `ZIP "${text(kid(addr, "zip"))}" must be 12345 or 12345-6789.`, "address");

    const ssn = text(kid(emp, "ssn"));
    const itin = text(kid(emp, "itin"));
    if (!ssn && !itin) add(who, "Needs an SSN or an ITIN.", "ssn");
    for (const [label, v] of [
      ["SSN", ssn],
      ["ITIN", itin],
    ] as const) {
      if (v && !/^\d{9}$/.test(v)) add(who, `${label} must be exactly 9 digits, no dashes or spaces.`, "ssn");
    }
    if (ssn) {
      const seen = ssns.get(ssn);
      if (seen !== undefined) add(who, `Same SSN as employee ${seen + 1}. Each SSN can appear once per file.`, "ssn");
      else ssns.set(ssn, i);
    }
    if (text(kid(emp, "notes")).length > 256) add(who, "Notes are over 256 characters.", "lengths");

    const classes = kids(kid(emp, "classifications"), "classification");
    if (!classes.length) add(who, "No classification is listed. Every worker needs at least one.", "classification");
    const perDay = new Map<string, number>();
    let workerHours = 0;

    for (const cls of classes) {
      const cname = cls.getAttribute("name")?.trim() ?? "";
      const where = `${who} › ${cname || "unnamed classification"}`;
      if (!cname) add(where, 'The classification has no name="…".', "classification");
      const corder = kids(cls)
        .map((c) => c.localName)
        .filter((n) => CLASSIFICATION_ORDER.includes(n));
      if (corder.join() !== CLASSIFICATION_ORDER.filter((n) => corder.includes(n)).join())
        add(where, `Fields are out of order. DIR expects: ${CLASSIFICATION_ORDER.join(", ")}.`, "order");
      if (!text(kid(cls, "craft"))) add(where, "Craft is missing.", "classification");

      const level = text(kid(cls, "employeeLevel"));
      const appLevel = text(kid(cls, "apprenticeLevel"));
      if (level !== "journeyman" && level !== "apprentice")
        add(where, `Employee level is "${level}". It must be journeyman or apprentice, in lower case.`, "apprentice");
      if (level === "apprentice" && !/^([1-9]|10)$/.test(appLevel))
        add(where, "Apprentices need an apprentice level from 1 to 10.", "apprentice");
      if (level === "journeyman" && appLevel) add(where, "Leave apprentice level empty for a journeyman.", "apprentice");

      const days = kids(kid(cls, "hrsWorkedEachDay"), "day");
      if (days.length !== 7) add(where, `Has ${days.length} days; DIR needs exactly 7, one per day of the week.`, "days");
      const sums = { straightTime: 0, overtime: 0, doubletime: 0 };
      days.forEach((day, d) => {
        const dwhere = `${where} › day ${d + 1}`;
        if (day.getAttribute("id") !== String(d + 1))
          add(dwhere, `Day id is "${day.getAttribute("id")}"; days must be numbered 1 to 7 in order.`, "days");
        const date = text(kid(day, "date"));
        if (weekOk && date !== addDays(weekEnding, d - 6))
          add(dwhere, `Date is "${date}"; it should be ${addDays(weekEnding, d - 6)} (day 7 is the week-ending date).`, "dates");
        let dayTotal = 0;
        for (const k of ["straightTime", "overtime", "doubletime"] as const) {
          const n = amount(text(kid(day, k)), 100);
          if (n === null) add(dwhere, `${k} is "${text(kid(day, k))}". Use a number under 100 with up to 2 decimals, or 0.0.`, "hours");
          else {
            sums[k] += n;
            dayTotal += n;
          }
        }
        if (date) perDay.set(date, (perDay.get(date) ?? 0) + dayTotal);
      });

      const fp = kid(cls, "fringePaid");
      const toEmp = text(kid(fp, "paidToEmployee"));
      const toPlan = text(kid(fp, "paidToBenefitPlan"));
      if (![toEmp, toPlan].every((v) => v === "true" || v === "false"))
        add(where, "Fringe paid flags must be true or false, in lower case.", "fringe");
      else if (toEmp === "false" && toPlan === "false")
        add(where, "Both fringe flags are false. At least one must be true, even when no fringe is owed.", "fringe");

      const fringe = kid(cls, "fringe");
      for (const f of FRINGES) {
        if (amount(text(kid(fringe, f)), 1e8) === null)
          add(where, `Fringe "${f}" is missing or not a number. Enter 0.0 if it doesn't apply.`, "fringe");
      }

      const tot = kid(cls, "totHrs");
      for (const [k, t] of [
        ["straightTime", "totHrsStraightTime"],
        ["overtime", "totHrsOvertime"],
        ["doubletime", "totHrsDoubletime"],
      ] as const) {
        const n = amount(text(kid(tot, t)), 1e4);
        if (n === null) add(where, `${t} is missing or not a number.`, "hours");
        else if (Math.abs(n - sums[k]) > 0.005)
          add(where, `${t} is ${n} but the daily ${k} hours add up to ${sums[k].toFixed(2)}.`, "totals");
        workerHours += n ?? 0;
      }

      const rates = kid(cls, "hrlyPayRate");
      for (const r of RATES) {
        if (amount(text(kid(rates, r)), 1e4) === null) add(where, `${r} is missing or not a number under 10,000.`, "rates");
      }
      if (sums.straightTime > 0 && Number(text(kid(rates, "hrlyPayRateStraightTime"))) <= 0)
        add(where, "Straight-time hours are listed with a straight-time rate of 0.", "rates");
    }

    for (const [date, h] of perDay) {
      if (h > 24) add(who, `${h} hours on ${date} across all classifications; one day can't exceed 24.`, "hours");
    }
    if (classes.length && workerHours <= 0)
      add(who, "Zero hours for the week. Remove the worker, or file a statement of non-performance if nobody worked.", "hours");

    const pay = kid(emp, "payments");
    if (amount(text(kid(pay, "travelSubs")), 1e8) === null) add(who, "travelSubs is missing. Enter 0.0 if none.", "deductions");

    const ded = kid(emp, "deductions");
    let dedSum = 0;
    for (const d of DEDUCTIONS) {
      const n = amount(text(kid(ded, d)), 1e8);
      if (n === null) add(who, `Deduction "${d}" is missing or not a number. Enter 0.0 if none.`, "deductions");
      else dedSum += n;
    }
    const total = amount(text(kid(ded, "totalDeductions")), 1e8);
    if (total === null) add(who, "totalDeductions is missing or not a number.", "deductions");
    else if (Math.abs(total - dedSum) > 0.005)
      add(
        who,
        `totalDeductions is ${total.toFixed(2)} but the deductions add up to ${dedSum.toFixed(2)}. Travel and fringe don't count.`,
        "deductions",
      );

    const earn = kid(emp, "earnings");
    for (const e of EARNINGS) {
      if (amount(text(kid(earn, e)), 1e8) === null) add(who, `${e} is missing or not a number.`, "earnings");
    }
    const check = text(kid(earn, "checkNum"));
    if (!check) add(who, "Check number is missing. Use CASH for cash payments.", "earnings");
    else if (check.length > 20) add(who, "Check number is over 20 characters.", "lengths");
  });

  return report(employees.length, weekEnding);
}
