import { describe, expect, it } from "vitest";
import { assessColregEncounter, evaluateColregManeuver } from "../src/core/colreg";
import { COLREG_RULES } from "../src/core/colregRules";
import { getLightVisibilityMinimums, getSoundSignals, getVesselLightGuidance, getRestrictedVisibilitySignal, LIGHT_DEFINITIONS } from "../src/core/colregSignals";
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
    for (const kind of ["power-driven", "sailing", "fishing", "nuc", "ram", "constrained-draught", "pilot", "towing", "anchored", "aground", "seaplane", "wig-craft", "other"] as const) {
      expect(getVesselLightGuidance(kind).lights.length).toBeGreaterThan(0);
    }
  });


  it("selects Rule 35 signals from vessel status and making-way condition", () => {
    expect(getRestrictedVisibilitySignal({ kind: "power-driven", lengthM: 50, underway: true, makingWay: true })?.pattern).toContain("1 продолжительный");
    expect(getRestrictedVisibilitySignal({ kind: "power-driven", lengthM: 50, underway: true, makingWay: false })?.pattern).toContain("2 продолжительных");
    expect(getRestrictedVisibilitySignal({ kind: "nuc", lengthM: 50, underway: true, makingWay: false })?.pattern).toContain("2 коротких");
    expect(getRestrictedVisibilitySignal({ kind: "anchored", lengthM: 50, underway: false, makingWay: false })?.meaning).toContain("якоре");
    expect(getRestrictedVisibilitySignal({ kind: "power-driven", lengthM: 8, underway: true, makingWay: true })?.meaning).toContain("менее 12 м");
  });

  it("provides manoeuvring, restricted-visibility and distress signal references", () => {
    expect(LIGHT_DEFINITIONS.length).toBeGreaterThanOrEqual(6);
    expect(getSoundSignals(32).length).toBeGreaterThan(0);
    expect(getSoundSignals(33).length).toBeGreaterThan(0);
    expect(getSoundSignals(34).some((signal) => signal.pattern === "3 коротких")).toBe(true);
    expect(getSoundSignals(34).some((signal) => signal.pattern.includes("проблеска"))).toBe(true);
    expect(getSoundSignals(35).length).toBeGreaterThan(0);
    expect(getSoundSignals(37).length).toBeGreaterThan(0);
  });
});

describe("COLREG context and encounter assessment", () => {
  it("always includes the general duties in Rules 5 to 8", () => {
    const result = assessColregEncounter(own(), target(0, 2));
    expect(result.applicableRules.map((rule) => rule.rule)).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6, 7, 8]));
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
    expect(result.responsibility).toBe("both-act");
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


  it("gives Rule 13 precedence over Rule 12 when one sailing vessel overtakes another", () => {
    const result = assessColregEncounter(own(0, 10), target(0, 2, 0, 6), {
      ownProfile: { kind: "sailing", tack: "port" },
      targetProfile: { kind: "sailing", tack: "starboard" },
    });
    expect(result.primaryRule).toBe(13);
    expect(result.responsibility).toBe("give-way");
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
      environment: { targetWindwardOfOwn: true },
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



  it("treats a seaplane on the water as a power-driven vessel for encounter rules", () => {
    const result = assessColregEncounter(own(), target(1, 1, 270, 8), {
      ownProfile: { kind: "seaplane", seaplaneOnWater: true },
      targetProfile: { kind: "power-driven" },
    });
    expect(result.primaryRule).toBe(18);
    expect(result.responsibility).toBe("give-way");
    expect(result.ownLightGuidance.rule).toBe(31);
  });

  it("applies Rule 18(f) to a WIG in flight and power-driven rules when on the water", () => {
    const airborne = assessColregEncounter(own(), target(1, 1, 270, 8), {
      ownProfile: { kind: "wig-craft", wigOnSurface: false },
      targetProfile: { kind: "power-driven" },
    });
    expect(airborne.primaryRule).toBe(18);
    expect(airborne.responsibility).toBe("give-way");
    const onWater = assessColregEncounter(own(), target(1, 1, 270, 8), {
      ownProfile: { kind: "wig-craft", wigOnSurface: true },
      targetProfile: { kind: "power-driven" },
    });
    expect(onWater.encounter).toBe("crossing-starboard");
    expect(onWater.ownLightGuidance.rule).toBe(23);
  });


  it("overrides a sailing vessel's Rule 18 stand-on status when Rule 9 forbids impeding a channel-limited target", () => {
    const result = assessColregEncounter(own(), target(1, 1, 270, 8), {
      ownProfile: { kind: "sailing", lengthM: 25 },
      targetProfile: { kind: "power-driven", lengthM: 180 },
      environment: { narrowChannel: true, targetCanOnlyNavigateChannel: true },
    });
    expect(result.primaryRule).toBe(18);
    expect(result.responsibility).toBe("no-impede");
    expect(result.ownShipDuty).toContain("правилу 9");
  });

  it("overrides a small vessel's Rule 15 stand-on status when Rule 10 says not to impede lane traffic", () => {
    const result = assessColregEncounter(own(90, 10), target(0.5, 0.1, 180, 8), {
      ownProfile: { kind: "power-driven", lengthM: 15 },
      targetProfile: { kind: "power-driven", lengthM: 120 },
      environment: { trafficSeparationScheme: true, targetFollowingTrafficLane: true },
    });
    expect(result.primaryRule).toBe(15);
    expect(result.responsibility).toBe("no-impede");
    expect(result.ownShipDuty).toContain("правилу 10");
  });

  it("does not give a constrained-draught vessel automatic right of way", () => {
    const result = assessColregEncounter(own(), target(1, 1, 270, 8), {
      targetProfile: { kind: "constrained-draught" },
    });
    expect(result.primaryRule).toBe(18);
    expect(result.responsibility).toBe("no-specific-duty");
    expect(result.ownShipDuty).toContain("не затрудняйте");
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
      targetProfile: { kind: "fishing", engagedInFishing: true },
      environment: { daylight: false, visibility: "restricted", vesselsInSight: false },
    });
    expect(result.ownLightGuidance.rule).toBe(23);
    expect(result.targetLightGuidance.rule).toBe(26);
    expect(result.applicableRules.some((rule) => rule.rule === 20)).toBe(true);
  });


  it("keeps an overtaking obligation active until the vessels are finally past and clear", () => {
    const result = assessColregEncounter(own(), target(0, 2, 0, 10), {
      environment: { ownOvertakingNotClear: true },
    });
    expect(result.primaryRule).toBe(13);
    expect(result.responsibility).toBe("give-way");
  });

  it("uses steady bearing and decreasing range as a Rule 7 risk indication", () => {
    const result = assessColregEncounter(own(), target(1, 1, 270, 10), {
      environment: {
        bearingHistoryDeg: [45, 46, 46.2],
        rangeHistoryNm: [2.4, 2.1, 1.8],
        riskDcpaNm: 0,
      },
    });
    expect(result.bearingTrend).toBe("stable");
    expect(result.rangeTrend).toBe("decreasing");
    expect(result.rule7RiskIndication).toBe(true);
    expect(result.collisionRisk).toBe("risk");
  });

  it("does not infer a Rule 7 risk from too few radar plots", () => {
    const result = assessColregEncounter(own(), target(1, 1, 270, 10), {
      environment: { bearingHistoryDeg: [45, 45], rangeHistoryNm: [2, 1.9] },
    });
    expect(result.bearingTrend).toBe("insufficient");
    expect(result.rule7RiskIndication).toBe(false);
  });

  it("returns Rule 22 minimum light ranges by vessel length", () => {
    expect(getLightVisibilityMinimums(60).mastheadNm).toBe(6);
    expect(getLightVisibilityMinimums(20).sidelightsNm).toBe(2);
    expect(getLightVisibilityMinimums(8).sidelightsNm).toBe(1);
    expect(() => getLightVisibilityMinimums(0)).toThrow(RangeError);
  });


  it("rejects malformed radar history and vessel dimensions", () => {
    expect(() => assessColregEncounter(own(), target(1, 1), {
      environment: { bearingHistoryDeg: [45, Number.NaN, 45], rangeHistoryNm: [2, 1.9, 1.8] },
    })).toThrow(RangeError);
    expect(() => assessColregEncounter(own(), target(1, 1), {
      ownProfile: { lengthM: 0 },
    })).toThrow(RangeError);
  });

  it("uses the top-level legacy DCPA threshold", () => {
    const result = assessColregEncounter(own(), target(1, 0, 270, 10), { riskDcpaNm: 1 });
    expect(result.collisionRisk).toBe("risk");
  });


  it("applies the fishing-vessel restriction in a narrow channel independently of the target's draft", () => {
    const result = assessColregEncounter(own(), target(1, 1, 270, 8), {
      ownProfile: { kind: "fishing", engagedInFishing: true },
      environment: { narrowChannel: true, targetNavigatingChannel: true },
    });
    expect(result.applicableRules.some((rule) => rule.rule === 9 && rule.duty.includes("рыболовное судно"))).toBe(true);
  });

  it("does not invent priority between two vessels constrained by draught", () => {
    const result = assessColregEncounter(own(), target(1, 1, 270, 8), {
      ownProfile: { kind: "constrained-draught" },
      targetProfile: { kind: "constrained-draught" },
    });
    expect(result.responsibility).toBe("undetermined");
  });

  it("does not decide Rule 12 same-tack priority when windward data is contradictory", () => {
    const result = assessColregEncounter(own(), target(0, 2, 180, 8), {
      ownProfile: { kind: "sailing", tack: "starboard", windward: false },
      targetProfile: { kind: "sailing", tack: "starboard", windward: false },
    });
    expect(result.primaryRule).toBe(12);
    expect(result.responsibility).toBe("undetermined");
  });

  it("validates head-on tolerances and contradictory overtaking state", () => {
    expect(() => assessColregEncounter(own(), target(0, 2), { headOnCourseToleranceDeg: 90 })).toThrow(RangeError);
    expect(() => assessColregEncounter(own(), target(0, 2), {
      environment: { ownOvertakingNotClear: true, targetOvertakingNotClear: true },
    })).toThrow(RangeError);
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
