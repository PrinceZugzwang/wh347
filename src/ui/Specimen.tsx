/** A fixed excerpt of a finished report, so visitors see the output before they upload anything. */
export function Specimen() {
  return (
    <figure class="specimen" aria-label="Excerpt of a finished certified payroll">
      <div class="sheet">
        <div class="sheet-title">
          <span>Certified Payroll, Davis-Bacon and Related Acts</span>
          <span>Payroll no. 7</span>
        </div>
        <dl class="sheet-head">
          <div>
            <dt>Subcontractor</dt>
            <dd>Bayline Electric Inc.</dd>
          </div>
          <div>
            <dt>Project</dt>
            <dd>Pinole Valley HS Modernization</dd>
          </div>
          <div>
            <dt>Week ending</dt>
            <dd>10/24/2026</dd>
          </div>
        </dl>
        <table>
          <thead>
            <tr>
              <th class="l">Worker</th>
              <th />
              <th>M</th>
              <th>Tu</th>
              <th>W</th>
              <th>Th</th>
              <th>F</th>
              <th>Total</th>
              <th>Rate</th>
              <th>Gross</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td rowSpan={2} class="l">
                Ramirez, Daniel
                <small>xxx-xx-7731 · Electrician</small>
              </td>
              <td class="so">S</td>
              <td>9</td>
              <td>9</td>
              <td>9</td>
              <td>9</td>
              <td>4</td>
              <td>40</td>
              <td>48.10</td>
              <td rowSpan={2}>2,354.50</td>
            </tr>
            <tr class="o">
              <td class="so">O</td>
              <td />
              <td />
              <td />
              <td />
              <td>5</td>
              <td>5</td>
              <td>72.15</td>
            </tr>
            <tr>
              <td rowSpan={2} class="l">
                Okafor, Grace
                <small>xxx-xx-2286 · Apprentice, 3rd period</small>
              </td>
              <td class="so">S</td>
              <td>8</td>
              <td>8</td>
              <td>8</td>
              <td>8</td>
              <td />
              <td>32</td>
              <td>26.46</td>
              <td rowSpan={2}>846.72</td>
            </tr>
            <tr class="o">
              <td class="so">O</td>
              <td />
              <td />
              <td />
              <td />
              <td />
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <figcaption>From a 14-row timecard export. Five hours past 40 moved to overtime automatically.</figcaption>
    </figure>
  );
}
