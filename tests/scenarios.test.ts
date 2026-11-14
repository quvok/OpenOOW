import { describe, expect, it } from "vitest";
import { ENCOUNTER_SCENARIOS, getScenarioTargetCpa } from "../src/core/scenarios";

describe("encounter scenarios", () => {
  it("provides the five initial COLREG training situations", () => {
    expect(ENCOUNTER_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      "head-on",
      "crossing-give-way",
      "overtaking",
      "restricted-visibility",
      "multiple-targets"
    ]);
  });

  it("defines a positive collision-risk TCPA for the head-on exercise", () => {
    const scenario = ENCOUNTER_SCENARIOS.find((item) => item.id === "head-on")!;
    const [result] = getScenarioTargetCpa(scenario);
    expect(result.cpa).not.toBeNull();
    expect(result.cpa!.tcpaMin).toBeGreaterThan(0);
    expect(result.cpa!.dcpaNm).toBeLessThan(0.1);
  });

  it("sets the crossing target on own ship's starboard side with a near-zero CPA", () => {
    const scenario = ENCOUNTER_SCENARIOS.find((item) => item.id === "crossing-give-way")!;
    const [result] = getScenarioTargetCpa(scenario);
    expect(result.cpa).not.toBeNull();
    expect(result.cpa!.bearingDeg).toBeGreaterThan(0);
    expect(result.cpa!.bearingDeg).toBeLessThan(90);
    expect(result.cpa!.dcpaNm).toBeLessThan(0.1);
  });

  it("contains two independently evaluated targets in the multi-target exercise", () => {
    const scenario = ENCOUNTER_SCENARIOS.find((item) => item.id === "multiple-targets")!;
    const results = getScenarioTargetCpa(scenario);
    expect(results).toHaveLength(2);
    expect(results.every((item) => item.cpa !== null)).toBe(true);
    expect(results[0].cpa!.dcpaNm).toBeLessThan(results[1].cpa!.dcpaNm);
  });

  it("keeps restricted-visibility conditions explicit", () => {
    const scenario = ENCOUNTER_SCENARIOS.find((item) => item.id === "restricted-visibility")!;
    expect(scenario.visibilityNm).toBe(1.5);
    expect(scenario.ruleReference).toContain("19");
  });
});
