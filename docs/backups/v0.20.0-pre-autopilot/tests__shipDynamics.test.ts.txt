import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHIP_PARAMETERS,
  INITIAL_SHIP_STATE,
  stepShip,
} from "../src/core/shipDynamics";

describe("simple ship dynamics", () => {
  it("accelerates gradually when throttle is applied", () => {
    const start = { ...INITIAL_SHIP_STATE, throttlePercent: 80 };
    const after = stepShip(start, 1);
    expect(after.speedKn).toBeGreaterThan(start.speedKn);
    expect(after.speedKn).toBeLessThanOrEqual(DEFAULT_SHIP_PARAMETERS.maxAccelerationKnPerSec);
  });

  it("slows down with the throttle at zero", () => {
    const start = { ...INITIAL_SHIP_STATE, speedKn: 8, throttlePercent: 0 };
    const after = stepShip(start, 1);
    expect(after.speedKn).toBeLessThan(start.speedKn);
    expect(after.speedKn).toBeGreaterThanOrEqual(0);
  });

  it("limits the physical rudder movement rate", () => {
    const start = { ...INITIAL_SHIP_STATE, speedKn: 8, rudderDeg: 35 };
    const after = stepShip(start, 0.1);
    expect(after.actualRudderDeg).toBeCloseTo(0.23, 6);
    expect(after.headingDeg).toBeCloseTo(0, 4);
  });

  it("turns to starboard with positive rudder once the rudder has moved", () => {
    let state = {
      ...INITIAL_SHIP_STATE,
      speedKn: 8,
      rudderDeg: 35,
      actualRudderDeg: 35,
    };
    for (let i = 0; i < 20; i += 1) state = stepShip(state, 0.1);
    expect(state.headingDeg).toBeGreaterThan(0);
    expect(state.yawRateDegPerSec).toBeGreaterThan(0);
  });

  it("has less steering authority at low speed", () => {
    const slow = stepShip({
      ...INITIAL_SHIP_STATE,
      speedKn: 2,
      rudderDeg: 35,
      actualRudderDeg: 35,
    }, 0.1);
    const fast = stepShip({
      ...INITIAL_SHIP_STATE,
      speedKn: 8,
      rudderDeg: 35,
      actualRudderDeg: 35,
    }, 0.1);
    expect(fast.yawRateDegPerSec).toBeGreaterThan(slow.yawRateDegPerSec);
  });

  it("normalizes heading when crossing north", () => {
    const start = {
      ...INITIAL_SHIP_STATE,
      headingDeg: 359.9,
      speedKn: 8,
      rudderDeg: 35,
      actualRudderDeg: 35,
      yawRateDegPerSec: 0.35,
    };
    const after = stepShip(start, 1);
    expect(after.headingDeg).toBeGreaterThanOrEqual(0);
    expect(after.headingDeg).toBeLessThan(360);
  });

  it("rejects invalid time steps and physical parameters", () => {
    expect(() => stepShip(INITIAL_SHIP_STATE, 0)).toThrow(RangeError);
    expect(() =>
      stepShip(INITIAL_SHIP_STATE, 0.1, {
        ...DEFAULT_SHIP_PARAMETERS,
        referenceSpeedKn: 0,
      }),
    ).toThrow(RangeError);
  });
});
