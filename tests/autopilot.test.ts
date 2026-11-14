import { describe, expect, it } from "vitest";
import {
  createAutopilotState,
  normalizeCourse,
  signedHeadingError,
  stepAutopilot,
} from "../src/core/autopilot";
import { INITIAL_SHIP_STATE, stepShip } from "../src/core/shipDynamics";

describe("heading autopilot", () => {
  it("normalizes heading setpoints and calculates the shortest signed error", () => {
    expect(normalizeCourse(361)).toBe(1);
    expect(signedHeadingError(2, 358)).toBe(4);
    expect(signedHeadingError(358, 2)).toBe(-4);
    expect(signedHeadingError(180, 0)).toBe(-180);
  });

  it("does not issue a rudder command in standby", () => {
    const state = createAutopilotState(90);
    const result = stepAutopilot(state, { ...INITIAL_SHIP_STATE, speedKn: 8 }, 0.1);
    expect(result.rudderCommandDeg).toBeNull();
    expect(result.offCourseAlarm).toBe(false);
  });

  it("turns to starboard for a higher commanded heading", () => {
    const state = { ...createAutopilotState(90), engaged: true };
    const result = stepAutopilot(state, { ...INITIAL_SHIP_STATE, speedKn: 8 }, 0.1);
    expect(result.rudderCommandDeg).toBeGreaterThan(0);
  });

  it("limits rudder command and triggers off-course alarm", () => {
    const state = { ...createAutopilotState(180), engaged: true, rudderLimitDeg: 12, offCourseAlarmDeg: 4 };
    const result = stepAutopilot(state, { ...INITIAL_SHIP_STATE, speedKn: 8 }, 0.1);
    expect(result.rudderCommandDeg).toBe(-12);
    expect(result.offCourseAlarm).toBe(true);
  });

  it("does not command steering at very low speed", () => {
    const state = { ...createAutopilotState(90), engaged: true };
    const result = stepAutopilot(state, { ...INITIAL_SHIP_STATE, speedKn: 0.1 }, 0.1);
    expect(result.rudderCommandDeg).toBe(0);
  });

  it("holds a commanded course in the simplified ship model", () => {
    let ship = {
      ...INITIAL_SHIP_STATE,
      headingDeg: 0,
      speedKn: 8,
      throttlePercent: (8 / 15) * 100,
    };
    const state = { ...createAutopilotState(90), engaged: true };
    for (let i = 0; i < 6000; i += 1) {
      const control = stepAutopilot(state, ship, 0.1);
      ship = stepShip({ ...ship, rudderDeg: control.rudderCommandDeg ?? ship.rudderDeg }, 0.1);
    }
    expect(Math.abs(signedHeadingError(90, ship.headingDeg))).toBeLessThan(2);
    expect(Math.abs(ship.yawRateDegPerSec)).toBeLessThan(0.08);
  });

  it("rejects invalid time steps", () => {
    expect(() => stepAutopilot(createAutopilotState(), INITIAL_SHIP_STATE, 0)).toThrow(RangeError);
  });
});
