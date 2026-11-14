export interface FixedStepResult<T> {
  state: T;
  accumulatorSeconds: number;
  stepsExecuted: number;
}

/**
 * Advances a deterministic simulation using whole fixed-size steps.
 * Real frame time is accumulated; the model never receives a variable dt.
 * Any unprocessed time remains in the accumulator instead of being discarded.
 */
export function advanceFixedSteps<T>(
  state: T,
  elapsedSeconds: number,
  accumulatorSeconds: number,
  stepSeconds: number,
  step: (current: T, dtSeconds: number) => T,
  maxSteps = 1000,
): FixedStepResult<T> {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    throw new RangeError("elapsedSeconds must be finite and non-negative.");
  }
  if (!Number.isFinite(accumulatorSeconds) || accumulatorSeconds < 0) {
    throw new RangeError("accumulatorSeconds must be finite and non-negative.");
  }
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
    throw new RangeError("stepSeconds must be finite and greater than zero.");
  }
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new RangeError("maxSteps must be a positive integer.");
  }

  let nextState = state;
  let remaining = accumulatorSeconds + elapsedSeconds;
  let stepsExecuted = 0;

  while (remaining + 1e-12 >= stepSeconds && stepsExecuted < maxSteps) {
    nextState = step(nextState, stepSeconds);
    remaining -= stepSeconds;
    if (remaining < 0 && remaining > -1e-10) remaining = 0;
    stepsExecuted += 1;
  }

  return {
    state: nextState,
    accumulatorSeconds: remaining,
    stepsExecuted,
  };
}
