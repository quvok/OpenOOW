import { describe, expect, it } from "vitest";
import { INITIAL_SHIP_STATE, stepShip } from "../src/core/shipDynamics";

describe("simple ship dynamics", () => {
  it("accelerates when throttle is applied", () => {
    const start = { ...INITIAL_SHIP_STATE, throttlePercent: 80 };
    const after = stepShip(start, 1);
    expect(after.speedKn).toBeGreaterThan(start.speedKn);
    expect(after.speedKn).toBeLessThanOrEqual(15);
  });

  it("does not instantly change heading when rudder is applied", () => {
    const start = {
      ...INITIAL_SHIP_STATE,
      speedKn: 10,
      rudderDeg: 35,
    };
    const after = stepShip(start, 0.1);
    expect(after.headingDeg).toBeGreaterThan(0);
    expect(after.headingDeg).toBeLessThan(1);
  });

  it("slows down with the throttle at zero", () => {
    const start = { ...INITIAL_SHIP_STATE, speedKn: 8, throttlePercent: 0 };
    const after = stepShip(start, 1);
    expect(after.speedKn).toBeLessThan(start.speedKn);
    expect(after.speedKn).toBeGreaterThanOrEqual(0);
  });

  it("rejects an invalid time step", () => {
    expect(() => stepShip(INITIAL_SHIP_STATE, 0)).toThrow(RangeError);
  });
});
