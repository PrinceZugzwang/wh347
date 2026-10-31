export const FIELDS = [
  "workerName",
  "firstName",
  "lastName",
  "workerId",
  "status",
  "apprenticeLevel",
  "classification",
  "date",
  "hours",
  "overtimeHours",
  "baseRate",
  "overtimeRate",
  "fringeCredited",
  "fringeCash",
  "fica",
  "federal",
  "state",
  "other",
  "grossAllWork",
] as const;

export type Field = (typeof FIELDS)[number];

export type ColumnMapping = Partial<Record<Field, number>>;

export const FIELD_LABELS: Record<Field, string> = {
  workerName: "Worker name",
  firstName: "First name",
  lastName: "Last name",
  workerId: "Worker ID (last 4 of SSN)",
  status: "Journeyworker / apprentice",
  apprenticeLevel: "Apprentice level",
  classification: "Labor classification",
  date: "Work date",
  hours: "Hours",
  overtimeHours: "Overtime hours",
  baseRate: "Hourly rate",
  overtimeRate: "Overtime rate",
  fringeCredited: "Fringe credited to plans ($/hr)",
  fringeCash: "Fringe paid in cash ($/hr)",
  fica: "FICA (week)",
  federal: "Federal withholding (week)",
  state: "State withholding (week)",
  other: "Other deductions (week)",
  grossAllWork: "Gross, all work (week)",
};

export const REQUIRED_FIELDS: Field[] = ["workerId", "classification", "date", "hours", "baseRate"];

/**
 * Header spellings seen in QuickBooks, Sage 100/300, ADP, Gusto and Foundation
 * exports. Matching is on normalised text, so case and punctuation do not matter.
 */
const SYNONYMS: Record<Field, string[]> = {
  workerName: ["employee", "employee name", "name", "worker", "worker name", "full name", "emp name"],
  firstName: ["first name", "first", "fname", "given name"],
  lastName: ["last name", "last", "lname", "surname", "family name"],
  workerId: [
    "ssn",
    "last 4",
    "ssn last 4",
    "last four",
    "ssn4",
    "id",
    "employee id",
    "emp id",
    "employee number",
    "emp no",
    "payroll id",
    "identifying number",
  ],
  status: ["status", "journeyworker apprentice", "j ra", "apprentice", "worker type", "type"],
  apprenticeLevel: ["apprentice level", "level", "period", "apprentice period", "progression"],
  classification: ["classification", "class", "craft", "trade", "labor classification", "job class", "work classification", "occupation"],
  date: ["date", "work date", "day", "date worked", "timecard date", "shift date"],
  hours: ["hours", "hrs", "total hours", "hours worked", "regular hours", "reg hours", "reg hrs", "st hours", "straight time"],
  overtimeHours: ["overtime", "ot", "ot hours", "ot hrs", "overtime hours"],
  baseRate: ["rate", "pay rate", "hourly rate", "base rate", "wage", "reg rate", "st rate"],
  overtimeRate: ["ot rate", "overtime rate"],
  fringeCredited: ["fringe", "fringe credit", "fringe credited", "fringe benefits", "benefits per hour", "fringe rate", "fringe plan"],
  fringeCash: ["cash in lieu", "fringe cash", "cash fringe", "in lieu", "fringe paid in cash"],
  fica: ["fica", "social security medicare", "ss medicare", "oasdi medicare", "social security"],
  federal: ["federal", "fed", "fit", "federal withholding", "federal tax", "federal income tax", "fed tax"],
  state: ["state", "sit", "state withholding", "state tax", "state income tax"],
  other: ["other", "other deductions", "deductions", "misc deductions"],
  grossAllWork: ["gross all work", "total gross", "gross pay", "gross wages", "gross"],
};

export function normalise(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Proposes a column for each field. Exact synonym matches win; a header that
 * merely contains a synonym is used only if nothing matched exactly. Each
 * column is assigned at most once, longest synonym first, so "OT Rate" is not
 * taken by "rate".
 */
export function proposeMapping(headers: string[]): ColumnMapping {
  const norm = headers.map(normalise);
  const taken = new Set<number>();
  const mapping: ColumnMapping = {};

  const candidates: { field: Field; synonym: string }[] = [];
  for (const field of FIELDS) for (const synonym of SYNONYMS[field]) candidates.push({ field, synonym });
  candidates.sort((a, b) => b.synonym.length - a.synonym.length);

  for (const pass of ["exact", "contains"] as const) {
    for (const { field, synonym } of candidates) {
      if (mapping[field] !== undefined) continue;
      const index = norm.findIndex((h, i) => {
        if (taken.has(i)) return false;
        return pass === "exact" ? h === synonym : h.split(" ").length > 1 && ` ${h} `.includes(` ${synonym} `);
      });
      if (index >= 0) {
        mapping[field] = index;
        taken.add(index);
      }
    }
  }

  if (mapping.workerName !== undefined && (mapping.firstName !== undefined || mapping.lastName !== undefined)) {
    delete mapping.firstName;
    delete mapping.lastName;
  }
  return mapping;
}

export function missingRequired(mapping: ColumnMapping): Field[] {
  const missing = REQUIRED_FIELDS.filter((f) => mapping[f] === undefined);
  const hasName = mapping.workerName !== undefined || mapping.lastName !== undefined;
  return hasName ? missing : ["workerName", ...missing];
}
