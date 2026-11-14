import { describe, expect, it } from "vitest";
import { advanceFixedSteps } from "../src/core/simulationEngine";

describe("fixed-step simulation engine", () => {
  const addStep = (state: number, dt: number) => state + dt;

  it("does not advance until one complete fixed step is accumulated", () => {
    const result = advanceFixedSteps(0, 0.04, 0, 0.1, addStep);
    expect(result.state).toBe(0);
    expect(result.stepsExecuted).toBe(0);
    expect(result.accumulatorSeconds).toBeCloseTo(0.04);
  });

  it("executes multiple identical fixed steps and retains the remainder", () => {
    const result = advanceFixedSteps(0, 0.26, 0, 0.1, addStep);
    expect(result.state).toBeCloseTo(0.2);
    expect(result.stepsExecuted).toBe(2);
    expect(result.accumulatorSeconds).toBeCloseTo(0.06);
  });

  it("produces the same result for different frame-time chunking", () => {
    const whole = advanceFixedSteps(0, 1, 0, 0.1, addStep);
    let state = 0;
    let accumulator = 0;
    for (const elapsed of [0.16, 0.07, 0.31, 0.11, 0.35]) {
      const result = advanceFixedSteps(state, elapsed, accumulator, 0.1, addStep);
      state = result.state;
      accumulator = result.accumulatorSeconds;
    }
    expect(state).toBeCloseTo(whole.state);
    expect(accumulator).toBeCloseTo(whole.accumulatorSeconds);
  });

  it("keeps backlog when the per-call step budget is reached", () => {
    const result = advanceFixedSteps(0, 1, 0, 0.1, addStep, 3);
    expect(result.stepsExecuted).toBe(3);
    expect(result.state).toBeCloseTo(0.3);
    expect(result.accumulatorSeconds).toBeCloseTo(0.7);
  });

  it("rejects invalid timing parameters", () => {
    expect(() => advanceFixedSteps(0, -1, 0, 0.1, addStep)).toThrow(RangeError);
    expect(() => advanceFixedSteps(0, 1, 0, 0, addStep)).toThrow(RangeError);
    expect(() => advanceFixedSteps(0, 1, 0, 0.1, addStep, 0)).toThrow(RangeError);
  });
});
