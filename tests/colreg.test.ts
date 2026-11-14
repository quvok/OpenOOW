import { describe, expect, it } from "vitest";
import { assessColregEncounter } from "../src/core/colreg";
import type { VesselState } from "../src/core/navigation";

const own = (courseDeg = 0, speedKn = 10): VesselState => ({
  id: "OWN", xNm: 0, yNm: 0, courseDeg, speedKn,
});

describe("COLREG encounter assessment", () => {
  it("identifies a likely head-on encounter", () => {
    const result = assessColregEncounter(own(), {
      id: "T1", xNm: 0, yNm: 2, courseDeg: 180, speedKn: 10,
    });
    expect(result.encounter).toBe("head-on");
    expect(result.rule).toBe("14");
  });

  it("identifies a crossing target on own ship's starboard side", () => {
    const result = assessColregEncounter(own(), {
      id: "T1", xNm: 1, yNm: 1, courseDeg: 270, speedKn: 10,
    });
    expect(result.encounter).toBe("crossing-starboard");
    expect(result.rule).toBe("15");
  });

  it("does not call a port-side contact a give-way situation", () => {
    const result = assessColregEncounter(own(), {
      id: "T1", xNm: -1, yNm: 1, courseDeg: 90, speedKn: 10,
    });
    expect(result.encounter).toBe("crossing-port");
    expect(result.ownShipDuty).toContain("может быть судном");
  });

  it("identifies overtaking from the target's stern sector when closing", () => {
    const result = assessColregEncounter(own(), {
      id: "T1", xNm: 0, yNm: -1, courseDeg: 0, speedKn: 5,
    });
    expect(result.encounter).toBe("overtaking");
    expect(result.rule).toBe("13");
  });

  it("uses Rule 19 in restricted visibility rather than Rule 14", () => {
    const result = assessColregEncounter(own(), {
      id: "T1", xNm: 0, yNm: 1, courseDeg: 180, speedKn: 10,
    }, { restrictedVisibility: true });
    expect(result.encounter).toBe("restricted-visibility");
    expect(result.rule).toBe("19");
  });

  it("reports risk separately from encounter classification", () => {
    const result = assessColregEncounter(own(), {
      id: "T1", xNm: 1, yNm: 1, courseDeg: 270, speedKn: 10,
    });
    expect(result.collisionRisk).toBe("risk");
    expect(result.dcpaNm).toBeLessThan(0.5);
  });

  it("rejects invalid or coincident vessel states", () => {
    expect(() => assessColregEncounter(own(), {
      id: "T1", xNm: 0, yNm: 0, courseDeg: 180, speedKn: 1,
    })).toThrow(RangeError);
    expect(() => assessColregEncounter(own(), {
      id: "T1", xNm: 1, yNm: 1, courseDeg: 0, speedKn: -1,
    })).toThrow(RangeError);
  });
});
