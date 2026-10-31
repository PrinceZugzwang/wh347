import Papa from "papaparse";
import type { Payroll } from "../types";

const dollars = (cents: number) => (cents / 100).toFixed(2);
const hours = (hundredths: number) => (hundredths / 100).toFixed(2);

/** One row per worker per classification, for loading into another system or a spreadsheet. */
export function renderPayrollCsv(payroll: Payroll): string {
  const records = payroll.rows.map((r) => {
    const record: Record<string, string | number> = {
      entry: r.entryNumber,
      worker_name: r.workerName,
      worker_id_last4: r.workerId,
      status: r.status,
      apprentice_level: r.apprenticeLevel,
      classification: r.classification,
    };
    r.days.forEach((d) => {
      record[`st_${d.date}`] = hours(d.straight);
      record[`ot_${d.date}`] = hours(d.overtime);
    });
    Object.assign(record, {
      total_st_hours: hours(r.totalStraight),
      total_ot_hours: hours(r.totalOvertime),
      base_rate: dollars(r.baseRate),
      ot_rate: dollars(r.overtimeRate),
      fringe_credited_per_hour: dollars(r.fringeCreditedPerHour),
      fringe_credited_total: dollars(r.fringeCreditedTotal),
      fringe_cash_per_hour: dollars(r.fringeCashPerHour),
      fringe_cash_total: dollars(r.fringeCashTotal),
      gross_this_project: dollars(r.grossThisProject),
      gross_all_work: r.carriesWorkerTotals ? dollars(r.grossAllWork) : "",
      fica: r.carriesWorkerTotals ? dollars(r.deductions.fica) : "",
      federal: r.carriesWorkerTotals ? dollars(r.deductions.federal) : "",
      state: r.carriesWorkerTotals ? dollars(r.deductions.state) : "",
      other: r.carriesWorkerTotals ? dollars(r.deductions.other) : "",
      net_pay: r.carriesWorkerTotals ? dollars(r.netPay) : "",
    });
    return record;
  });
  return Papa.unparse(records);
}
