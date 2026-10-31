import type { ProjectHeader } from "../core";

interface Props {
  header: ProjectHeader;
  onChange: (header: ProjectHeader) => void;
}

const TEXT_FIELDS: { key: keyof ProjectHeader; label: string; wide?: boolean; hint?: string }[] = [
  { key: "contractorName", label: "Contractor or subcontractor", wide: true },
  { key: "contractorAddress", label: "Business address", wide: true },
  { key: "projectName", label: "Project name" },
  { key: "projectLocation", label: "Project location" },
  { key: "projectNumber", label: "Project or contract no." },
  { key: "wageDeterminationNumber", label: "Wage determination no.", hint: "e.g. CA20260001" },
  { key: "payrollNumber", label: "Payroll no.", hint: "Starts at 1 and counts up each week" },
];

export function HeaderForm({ header, onChange }: Props) {
  const set = <K extends keyof ProjectHeader>(key: K, value: ProjectHeader[K]) => onChange({ ...header, [key]: value });

  return (
    <div class="grid">
      <fieldset class="field wide role">
        <legend>You are the</legend>
        <label>
          <input type="radio" name="role" checked={header.role === "prime"} onChange={() => set("role", "prime")} /> Prime contractor
        </label>
        <label>
          <input type="radio" name="role" checked={header.role === "subcontractor"} onChange={() => set("role", "subcontractor")} />{" "}
          Subcontractor
        </label>
      </fieldset>
      {TEXT_FIELDS.map(({ key, label, wide, hint }) => (
        <label class={`field${wide ? " wide" : ""}`} key={key}>
          <span>{label}</span>
          <input type="text" value={String(header[key])} placeholder={hint} onInput={(e) => set(key, e.currentTarget.value as never)} />
        </label>
      ))}
      <label class="field">
        <span>Week ending</span>
        <input type="date" value={header.weekEnding} onInput={(e) => set("weekEnding", e.currentTarget.value)} />
      </label>
      <label class="field check">
        <input type="checkbox" checked={header.isFinal} onChange={(e) => set("isFinal", e.currentTarget.checked)} />
        <span>Final payroll for this project</span>
      </label>
    </div>
  );
}
