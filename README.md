# wh347

Turns a weekly timecard export into a Davis-Bacon certified payroll, laid out like
[Form WH-347](https://www.dol.gov/agencies/whd/forms/wh347). Everything runs in the
browser: the payroll file is never uploaded anywhere.

Contractors on federally funded construction have to file a certified payroll every
week. Most payroll systems export the hours and pay, but not in the WH-347 layout, so
someone ends up retyping it. This tool does the retyping and catches the mistakes that
get payrolls sent back: missing overtime, rates below the wage determination, full
Social Security numbers on the form, dates outside the workweek.

## What it does

1. Reads a CSV or .xlsx export with one row per worker per day. Columns are matched by
   name (QuickBooks, Sage, ADP and hand-made spreadsheets all use different headings),
   and you can fix the matching by hand. The matching is remembered for next week.
2. Builds the payroll: hours per day split into straight time and overtime, gross pay
   for this project and for all work, deductions and net pay.
3. Optionally checks every worker against the rates you paste from the wage
   determination on SAM.gov.
4. Produces a PDF in the WH-347 column order and a CSV of the same data.

## The Statement of Compliance

Page 2 of WH-347 has to use the Department of Labor's wording exactly, so this project
does not retype it. `public/forms/wh347.pdf` is DOL's own file, and its last page is
appended to every PDF for signing. The `fetch official form` workflow downloads it from
dol.gov on the first of each month and commits it when DOL publishes a new version. If
the file is missing, the user is asked to add the form in the browser instead.

## Assumptions worth knowing

- **Overtime.** Hours over 40 in the workweek are overtime at 1.5x the basic hourly
  rate, assigned in date order. If the export has its own overtime column, that is used
  instead, and you're warned if it leaves more than 40 straight-time hours.
- **Fringe.** Plan contributions go in 6B as an hourly credit times hours worked. Cash
  paid in lieu of fringe goes in 6C, counts toward gross pay, and is paid on overtime
  hours at the straight-time amount.
- **Weekly figures.** Deductions and "gross, all work" are usually repeated on every
  daily row. Identical repeats count once; differing values are added up with a warning.
- **Worker IDs.** Only the last four digits of an SSN are kept.
- **Apprentices.** Registered apprentices are not checked against the journeyworker
  rate, since their rate comes from the apprenticeship program.

## Not done yet

- California DIR eCPR XML upload
- LCPtracker and other portal import formats
- Fringe benefit breakdown by plan (the back of page 2)

## Development

Requires Node 20 or later.

```sh
npm install
npm run dev        # http://localhost:5173
npm run check      # typecheck, lint, tests
npm run build      # static site in dist/
```

The payroll logic is in `src/core` and has no browser dependencies. Money is held in
integer cents and hours in hundredths of an hour, so totals never pick up floating
point error. `fixtures/` has a sample export and wage determination that the tests use;
the same sample is served from `public/` for the "try the sample file" link.

## Deployment

Every push to `main` builds the site and publishes it to GitHub Pages
(`.github/workflows/deploy.yml`). The build sets `BASE_PATH=/wh347/` because Pages serves
the site from that path; on any host that serves from the root, leave it unset.

## Disclaimer

Not affiliated with the U.S. Department of Labor. The contractor signing the payroll is
responsible for it being correct.
