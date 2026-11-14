import { describe, expect, it } from "vitest";
import { assessColregEncounter, evaluateColregManeuver } from "../src/core/colreg";
import { COLREG_RULES } from "../src/core/colregRules";
import { getSoundSignals, getVesselLightGuidance } from "../src/core/colregSignals";
import type { VesselState } from "../src/core/navigation";

const own = (courseDeg = 0, speedKn = 10, xNm = 0, yNm = 0): VesselState => ({
  id: "OWN", xNm, yNm, courseDeg, speedKn,
});
const target = (xNm: number, yNm: number, courseDeg = 180, speedKn = 10): VesselState => ({
  id: "T1", xNm, yNm, courseDeg, speedKn,
});

describe("COLREG rule reference", () => {
  it("catalogues all 41 convention rules and marks Part F as non-manoeuvring", () => {
    expect(COLREG_RULES).toHaveLength(41);
    expect(new Set(COLREG_RULES.map((rule) => rule.number)).size).toBe(41);
    expect(COLREG_RULES.find((rule) => rule.number === 41)?.operational).toBe(false);
    expect(COLREG_RULES.find((rule) => rule.number === 38)?.operational).toBe(true);
  });

  it("provides light guidance for all modeled vessel categories", () => {
    for (const kind of ["power-driven", "sailing", "fishing", "nuc", "ram", "constrained-draught", "pilot", "towing", "anchored", "aground", "seaplane", "other"] as const) {
      expect(getVesselLightGuidance(kind).lights.length).toBeGreaterThan(0);
    }
  });

  it("provides manoeuvring, restricted-visibility and distress signal references", () => {
    expect(getSoundSignals(34).some((signal) => signal.pattern === "3 коротких")).toBe(true);
    expect(getSoundSignals(35).length).toBeGreaterThan(0);
    expect(getSoundSignals(37).length).toBeGreaterThan(0);
  });
});

describe("COLREG context and encounter assessment", () => {
  it("always includes the general duties in Rules 5 to 8", () => {
    const result = assessColregEncounter(own(), target(0, 2));
    expect(result.applicableRules.map((rule) => rule.rule)).toEqual(expect.arrayContaining([5, 6, 7, 8]));
  });

  it("applies Rule 19 only when visibility is restricted and vessels are not in sight", () => {
    const notInSight = assessColregEncounter(own(), target(0, 2), {
      environment: { visibility: "restricted", vesselsInSight: false },
    });
    expect(notInSight.primaryRule).toBe(19);
    const inSight = assessColregEncounter(own(), target(0, 2), {
      environment: { visibility: "restricted", vesselsInSight: true },
    });
    expect(inSight.primaryRule).not.toBe(19);
    expect(inSight.applicableRules.some((rule) => rule.rule === 19)).toBe(false);
  });

  it("does not apply Rules 11 to 18 when vessels are not in sight in good visibility", () => {
    const result = assessColregEncounter(own(), target(0, 2), {
      environment: { visibility: "good", vesselsInSight: false },
    });
    expect(result.applicableRules.some((rule) => rule.rule >= 11 && rule.rule <= 18)).toBe(false);
  });

  it("identifies a likely head-on encounter between power-driven vessels", () => {
    const result = assessColregEncounter(own(), target(0, 2, 180, 10));
    expect(result.encounter).toBe("head-on");
    expect(result.primaryRule).toBe(14);
    expect(result.responsibility).toBe("give-way");
  });

  it("does not apply Rule 14 to a sailing vessel", () => {
    const result = assessColregEncounter(own(), target(0, 2, 180, 10), {
      targetProfile: { kind: "sailing" },
    });
    expect(result.primaryRule).toBe(18);
  });

  it("identifies a crossing target on own ship's starboard side when risk exists", () => {
    const result = assessColregEncounter(own(), target(1, 1, 270, 10));
    expect(result.encounter).toBe("crossing-starboard");
    expect(result.primaryRule).toBe(15);
    expect(result.responsibility).toBe("give-way");
    expect(result.applicableRules.some((rule) => rule.rule === 16)).toBe(true);
  });

  it("treats a crossing target on port as a stand-on candidate", () => {
    const result = assessColregEncounter(own(), target(-1, 1, 90, 10));
    expect(result.encounter).toBe("crossing-port");
    expect(result.responsibility).toBe("stand-on");
    expect(result.applicableRules.some((rule) => rule.rule === 17)).toBe(true);
  });

  it("identifies own ship overtaking a slower vessel", () => {
    const result = assessColregEncounter(own(0, 10), target(0, 2, 0, 6));
    expect(result.encounter).toBe("overtaking-own");
    expect(result.primaryRule).toBe(13);
    expect(result.responsibility).toBe("give-way");
  });

  it("identifies a target overtaking own ship", () => {
    const result = assessColregEncounter(own(0, 6), target(0, -1, 0, 10));
    expect(result.encounter).toBe("overtaking-target");
    expect(result.responsibility).toBe("stand-on");
  });

  it("uses Rule 12 for sailing vessels on different tacks", () => {
    const result = assessColregEncounter(own(), target(0, 2, 180, 8), {
      ownProfile: { kind: "sailing", tack: "port" },
      targetProfile: { kind: "sailing", tack: "starboard" },
    });
    expect(result.primaryRule).toBe(12);
    expect(result.responsibility).toBe("give-way");
  });

  it("uses Rule 12 for same-tack windward/leeward vessels", () => {
    const result = assessColregEncounter(own(), target(0, 2, 180, 8), {
      ownProfile: { kind: "sailing", tack: "starboard", windward: true },
      targetProfile: { kind: "sailing", tack: "starboard", windward: false },
    });
    expect(result.primaryRule).toBe(12);
    expect(result.responsibility).toBe("give-way");
  });


  it("applies Rule 12(c) conservatively when own ship is on port tack and target tack is unknown", () => {
    const result = assessColregEncounter(own(), target(0, 2, 180, 8), {
      ownProfile: { kind: "sailing", tack: "port" },
      targetProfile: { kind: "sailing", tack: "unknown" },
    });
    expect(result.primaryRule).toBe(12);
    expect(result.responsibility).toBe("give-way");
  });

  it("does not invent a sailing priority when tack information is unknown", () => {
    const result = assessColregEncounter(own(), target(0, 2, 180, 8), {
      ownProfile: { kind: "sailing", tack: "unknown" },
      targetProfile: { kind: "sailing", tack: "unknown" },
    });
    expect(result.primaryRule).toBe(12);
    expect(result.responsibility).toBe("undetermined");
  });

  it("applies Rule 18 hierarchy for power-driven versus fishing vessels", () => {
    const result = assessColregEncounter(own(), target(1, 1, 270, 8), {
      targetProfile: { kind: "fishing", engagedInFishing: true },
    });
    expect(result.primaryRule).toBe(18);
    expect(result.responsibility).toBe("give-way");
  });

  it("does not give a constrained-draught vessel automatic right of way", () => {
    const result = assessColregEncounter(own(), target(1, 1, 270, 8), {
      targetProfile: { kind: "constrained-draught" },
    });
    expect(result.primaryRule).toBe(18);
    expect(result.responsibility).toBe("no-specific-duty");
    expect(result.ownShipDuty).toContain("не затруднять");
  });

  it("adds Rules 9 and 10 when narrow-channel or TSS context is supplied", () => {
    const result = assessColregEncounter(own(), target(1, 1, 270, 8), {
      environment: { narrowChannel: true, trafficSeparationScheme: true, ownCrossingTrafficLane: true },
    });
    expect(result.applicableRules.some((rule) => rule.rule === 9)).toBe(true);
    expect(result.applicableRules.filter((rule) => rule.rule === 10).length).toBeGreaterThan(1);
  });

  it("exposes night and restricted-visibility light guidance", () => {
    const result = assessColregEncounter(own(), target(0, 2), {
      ownProfile: { kind: "power-driven" },
      targetProfile: { kind: "fishing" },
      environment: { daylight: false, visibility: "restricted", vesselsInSight: false },
    });
    expect(result.ownLightGuidance.rule).toBe(23);
    expect(result.targetLightGuidance.rule).toBe(26);
    expect(result.applicableRules.some((rule) => rule.rule === 20)).toBe(true);
  });

  it("rejects invalid or coincident vessel states", () => {
    expect(() => assessColregEncounter(own(), target(0, 0))).toThrow(RangeError);
    expect(() => assessColregEncounter(own(), target(1, 1, 0, -1))).toThrow(RangeError);
    expect(() => assessColregEncounter(own(), target(1, 1), { environment: { riskDcpaNm: -1 } })).toThrow(RangeError);
  });
});

describe("COLREG manoeuvre trend", () => {
  it("reports whether a changed own-ship course improves the predicted CPA", () => {
    const beforeOwn = own(0, 10);
    const afterOwn = own(20, 10);
    const beforeTarget = target(0, 2, 180, 10);
    const afterTarget = target(0, 2, 180, 10);
    const result = evaluateColregManeuver(beforeOwn, afterOwn, beforeTarget, afterTarget);
    expect(result.courseChangeDeg).toBeCloseTo(20);
    expect(result.cpaTrend).toBe("improved");
    expect(result.dcpaAfterNm).toBeGreaterThan(result.dcpaBeforeNm ?? 0);
  });
});
