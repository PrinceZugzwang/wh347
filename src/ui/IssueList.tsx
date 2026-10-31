import type { Issue } from "../core";

export function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return <p class="ok">No problems found.</p>;
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  return (
    <div class="issues">
      {errors.length > 0 && (
        <>
          <h3>
            {errors.length} {errors.length === 1 ? "problem" : "problems"} to fix before this payroll can be downloaded
          </h3>
          <ul class="error">
            {errors.map((i, n) => (
              <li key={n}>{i.message}</li>
            ))}
          </ul>
        </>
      )}
      {warnings.length > 0 && (
        <>
          <h3>{warnings.length} to check</h3>
          <ul class="warning">
            {warnings.map((i, n) => (
              <li key={n}>{i.message}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
