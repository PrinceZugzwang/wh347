import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module shared with the build script
import { countySlug, parseWageDetermination } from "../scripts/wd-parse.mjs";

const SAMPLE = `"General Decision Number: MN20260053 07/30/2026


State: Minnesota

Construction Types: Building

Counties: Minnesota Counties of
Hennepin

Please refer to Minnesota Rules 5200.1100, 5200.1101, and 5200.1102
for definitions of labor classifications on this wage determination.

Modification Number     Publication Date
          0                01/02/2026
          1                05/18/2026
          2                07/30/2026


 SAMN2025-001 12/22/2025
                                                     Rates                  Fringes
ARTICULATED HAULER..................................$ 48.52                  31.00
ELECTRICIAN.........................................$ 63.59                  35.79
LABORER: LANDSCAPING (GARDENER, SOD LAYER AND
NURSERY OPERATOR)...................................$ 31.66                  22.78
POWER EQUIPMENT OPERATOR: COMMERCIAL GROUP 8 :
ELEVATOR OPERATOR; GREASER; MECHANICAL SPACE HEATER
(TEMPORARY HEAT NO BOILER LICENSE REQUIRED) ........$ 41.28                  29.40
----------------------------------------------------------------
 ELEC0292-001 06/01/2025
ELECTRICIAN (LOW VOLTAGE)...........................$ 1,050.00             18%+4.50

WELDERS - Receive rate prescribed for craft performing
operation to which welding is incidental.
================================================================
Note: Executive Order (EO) 13706 applies to contracts ... $ 13.30 per hour.
"`;

describe("wage determination parsing", () => {
  const wd = parseWageDetermination(SAMPLE);

  it("reads the number, date and modifications", () => {
    expect(wd.number).toBe("MN20260053");
    expect(wd.date).toBe("07/30/2026");
    expect(wd.mods).toEqual([
      { number: 0, date: "01/02/2026" },
      { number: 1, date: "05/18/2026" },
      { number: 2, date: "07/30/2026" },
    ]);
  });

  it("joins classification names that wrap over several lines", () => {
    const names = wd.rates.map((r: { classification: string }) => r.classification);
    expect(names).toContain("LABORER: LANDSCAPING (GARDENER, SOD LAYER AND NURSERY OPERATOR)");
    expect(names).toContain(
      "POWER EQUIPMENT OPERATOR: COMMERCIAL GROUP 8 : ELEVATOR OPERATOR; GREASER; MECHANICAL SPACE HEATER (TEMPORARY HEAT NO BOILER LICENSE REQUIRED)",
    );
  });

  it("keeps rates, fringe as published, and where the rate came from", () => {
    expect(wd.rates[1]).toEqual({ classification: "ELECTRICIAN", base: "63.59", fringe: "35.79", source: "SAMN2025-001 12/22/2025" });
    const low = wd.rates.find((r: { classification: string }) => r.classification === "ELECTRICIAN (LOW VOLTAGE)");
    expect(low).toEqual({
      classification: "ELECTRICIAN (LOW VOLTAGE)",
      base: "1050.00",
      fringe: "18%+4.50",
      source: "ELEC0292-001 06/01/2025",
    });
  });

  it("ignores footnotes, even ones with dollar amounts", () => {
    expect(wd.rates).toHaveLength(5);
  });

  it("makes county addresses", () => {
    expect(countySlug("Hennepin", "MN")).toBe("hennepin-county");
    expect(countySlug("St. Louis", "MN")).toBe("st-louis-county");
    expect(countySlug("Orleans", "LA")).toBe("orleans-parish");
  });
});
