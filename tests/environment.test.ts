import { describe, expect, it } from "vitest";
import { CALM_ENVIRONMENT, calculateEnvironmentalMotion } from "../src/core/environment";

describe("environment model", () => {
  it("preserves the heading and speed in calm water", () => {
    const motion = calculateEnvironmentalMotion(90, 10, CALM_ENVIRONMENT);
    expect(motion.leewayDeg).toBe(0);
    expect(motion.eastVelocityKn).toBeCloseTo(10, 8);
    expect(motion.northVelocityKn).toBeCloseTo(0, 8);
    expect(motion.groundTrackDeg).toBeCloseTo(90, 8);
  });

  it("adds current set and drift to ground velocity", () => {
    const motion = calculateEnvironmentalMotion(0, 8, {
      ...CALM_ENVIRONMENT, currentSpeedKn: 2, currentSetDeg: 90,
    });
    expect(motion.eastVelocityKn).toBeCloseTo(2, 8);
    expect(motion.northVelocityKn).toBeCloseTo(8, 8);
    expect(motion.groundTrackDeg).toBeGreaterThan(0);
  });

  it("produces leeway from a beam wind using FROM convention", () => {
    const motion = calculateEnvironmentalMotion(0, 8, {
      ...CALM_ENVIRONMENT, windSpeedKn: 20, windFromDeg: 90,
    });
    expect(motion.leewayDeg).toBeGreaterThan(0);
    expect(motion.leewayDeg).toBeLessThanOrEqual(3);
  });

  it("reduces effective speed with increasing significant wave height", () => {
    const calm = calculateEnvironmentalMotion(0, 10, CALM_ENVIRONMENT);
    const rough = calculateEnvironmentalMotion(0, 10, {
      ...CALM_ENVIRONMENT, significantWaveHeightM: 4,
    });
    expect(rough.speedThroughWaterKn).toBeLessThan(calm.speedThroughWaterKn);
  });

  it("rejects invalid environment values", () => {
    expect(() => calculateEnvironmentalMotion(0, 8, {
      ...CALM_ENVIRONMENT, currentSpeedKn: -1,
    })).toThrow(RangeError);
  });
});
