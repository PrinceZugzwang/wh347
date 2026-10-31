import { type ColumnMapping, FIELD_LABELS, FIELDS, type Field, REQUIRED_FIELDS } from "../core";

interface Props {
  headers: string[];
  mapping: ColumnMapping;
  onChange: (mapping: ColumnMapping) => void;
}

const REQUIRED = new Set<Field>([...REQUIRED_FIELDS, "workerName"]);

export function MappingTable({ headers, mapping, onChange }: Props) {
  const assign = (field: Field, value: string) => {
    const next = { ...mapping };
    if (value === "") delete next[field];
    else next[field] = Number(value);
    onChange(next);
  };

  return (
    <table class="mapping">
      <thead>
        <tr>
          <th>Goes on the payroll as</th>
          <th>Column in your file</th>
        </tr>
      </thead>
      <tbody>
        {FIELDS.map((field) => (
          <tr key={field} class={mapping[field] === undefined ? "unmapped" : ""}>
            <td>
              {FIELD_LABELS[field]}
              {REQUIRED.has(field) && <abbr title="required"> *</abbr>}
            </td>
            <td>
              <select
                value={mapping[field] === undefined ? "" : String(mapping[field])}
                onChange={(e) => assign(field, e.currentTarget.value)}
              >
                <option value="">Not in file</option>
                {headers.map((h, i) => (
                  <option value={String(i)} key={i}>
                    {h || `Column ${i + 1}`}
                  </option>
                ))}
              </select>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
