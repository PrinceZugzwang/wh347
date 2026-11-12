import type { ProjectHeader } from "../core";

interface Props {
  header: ProjectHeader;
  onChange: (header: ProjectHeader) => void;
  /** The typed form asks for the week first, next to the crew, so it is left out here. */
  hideWeekEnding?: boolean;
}

type TextKey =
  | "contractorName"
  | "contractorAddress"
  | "projectName"
  | "projectLocation"
  | "projectNumber"
  | "wageDeterminationNumber"
  | "payrollNumber";

const FIELDS: { key: TextKey; label: string; span?: 2; placeholder?: string }[] = [
  { key: "contractorName", label: "Your company", span: 2 },
  { key: "contractorAddress", label: "Business address", span: 2 },
  { key: "projectName", label: "Project", span: 2 },
  { key: "projectLocation", label: "Project location" },
  { key: "projectNumber", label: "Project or contract no." },
  { key: "wageDeterminationNumber", label: "Wage determination no.", span: 2, placeholder: "CA20260001" },
  { key: "payrollNumber", label: "Payroll no." },
];

/** The report header, laid out as ruled cells like the header block of the printed form. */
export function HeaderForm({ header, onChange, hideWeekEnding = false }: Props) {
  const set = <K extends keyof ProjectHeader>(key: K, value: ProjectHeader[K]) => onChange({ ...header, [key]: value });

  return (
    <div class="cells">
      {FIELDS.map(({ key, label, span, placeholder }) => (
        <label class={span || (hideWeekEnding && key === "payrollNumber") ? "cell span-2" : "cell"} key={key}>
          <span>{label}</span>
          <input type="text" value={header[key]} placeholder={placeholder} onInput={(e) => set(key, e.currentTarget.value)} />
        </label>
      ))}
      {!hideWeekEnding && (
        <label class="cell">
          <span>Week ending</span>
          <input type="date" value={header.weekEnding} onInput={(e) => set("weekEnding", e.currentTarget.value)} />
        </label>
      )}
      <div class="cell span-2 choices" role="group" aria-label="Your role on the project">
        <span>You are the</span>
        <div class="opts">
          <label>
            <input type="radio" name="role" checked={header.role === "prime"} onChange={() => set("role", "prime")} /> Prime contractor
          </label>
          <label>
            <input type="radio" name="role" checked={header.role === "subcontractor"} onChange={() => set("role", "subcontractor")} />{" "}
            Subcontractor
          </label>
          <label>
            <input type="checkbox" checked={header.isFinal} onChange={(e) => set("isFinal", e.currentTarget.checked)} /> Final payroll
          </label>
        </div>
      </div>
    </div>
  );
}
