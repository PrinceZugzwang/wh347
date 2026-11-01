/** A fixed before/after example for the top of the page: export rows in, a WH-347 line out. */
export function Specimen() {
  return (
    <figure class="specimen" aria-label="Example: five daily rows from a payroll export become one WH-347 entry">
      <div class="specimen-file">
        <p class="specimen-name">payroll_export.csv</p>
        <pre>
          {`Employee   SSN          Date   Hrs  Rate
Ramirez D  512-48-7731  10/19  9    48.10
Ramirez D  512-48-7731  10/20  9    48.10
Ramirez D  512-48-7731  10/21  9    48.10
Ramirez D  512-48-7731  10/22  9    48.10
Ramirez D  512-48-7731  10/23  9    48.10`}
        </pre>
      </div>
      <div class="specimen-out">
        <p class="specimen-name">WH-347, entry 1</p>
        <table>
          <tbody>
            <tr>
              <td rowSpan={2} class="who">
                Ramirez, D.
                <br />
                <span>xxx-xx-7731</span>
              </td>
              <td class="so">S</td>
              <td>9</td>
              <td>9</td>
              <td>9</td>
              <td>9</td>
              <td>4</td>
              <td class="tot">40</td>
              <td class="rate">48.10</td>
            </tr>
            <tr class="ot">
              <td class="so">O</td>
              <td />
              <td />
              <td />
              <td />
              <td>5</td>
              <td class="tot">5</td>
              <td class="rate">72.15</td>
            </tr>
          </tbody>
        </table>
        <p class="specimen-note">5 hours over 40 moved to overtime. Gross $2,284.75.</p>
      </div>
    </figure>
  );
}
