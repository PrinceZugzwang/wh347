import { dayLetter, formatHours, formatMoney, type Payroll, shortDate } from "../core";

export function PayrollPreview({ payroll }: { payroll: Payroll }) {
  return (
    <div class="ledger-wrap">
      <table class="ledger">
        <thead>
          <tr>
            <th>#</th>
            <th>Worker</th>
            <th>Class</th>
            <th />
            {payroll.weekDates.map((d) => (
              <th key={d} class="num">
                {dayLetter(d)}
                <br />
                {shortDate(d)}
              </th>
            ))}
            <th class="num">Total</th>
            <th class="num">Rate</th>
            <th class="num">Gross, project</th>
            <th class="num">Deductions</th>
            <th class="num">Net</th>
          </tr>
        </thead>
        <tbody>
          {payroll.rows.map((r, i) =>
            (["S", "O"] as const).map((line) => {
              const straight = line === "S";
              return (
                <tr key={`${i}${line}`} class={straight ? "s" : "o"}>
                  {straight ? (
                    <>
                      <td rowSpan={2} class="num">
                        {r.entryNumber}
                      </td>
                      <td rowSpan={2} class="worker">
                        <strong>{r.workerName}</strong>
                        <br />
                        <span class="muted">
                          xxx-xx-{r.workerId} · {r.status}
                          {r.apprenticeLevel ? ` ${r.apprenticeLevel}` : ""}
                        </span>
                      </td>
                      <td rowSpan={2} class="class">
                        {r.classification}
                      </td>
                    </>
                  ) : null}
                  <td class="so">{line}</td>
                  {r.days.map((d) => (
                    <td key={d.date} class="num">
                      {formatHours(straight ? d.straight : d.overtime)}
                    </td>
                  ))}
                  <td class="num">{formatHours(straight ? r.totalStraight : r.totalOvertime)}</td>
                  <td class="num">{straight ? formatMoney(r.baseRate) : r.totalOvertime > 0 ? formatMoney(r.overtimeRate) : ""}</td>
                  {straight ? (
                    <>
                      <td rowSpan={2} class="num">
                        {formatMoney(r.grossThisProject)}
                      </td>
                      <td rowSpan={2} class="num">
                        {r.carriesWorkerTotals ? formatMoney(r.deductionsTotal) : ""}
                      </td>
                      <td rowSpan={2} class="num">
                        {r.carriesWorkerTotals ? formatMoney(r.netPay) : ""}
                      </td>
                    </>
                  ) : null}
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
    </div>
  );
}
