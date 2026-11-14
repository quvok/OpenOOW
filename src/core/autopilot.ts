import type { ShipDynamicsState } from "./shipDynamics";

export interface AutopilotState {
  engaged: boolean;
  selectedHeadingDeg: number;
  rudderLimitDeg: number;
  offCourseAlarmDeg: number;
}

export interface AutopilotStepResult {
  state: AutopilotState;
  rudderCommandDeg: number | null;
  headingErrorDeg: number;
  offCourseAlarm: boolean;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function normalizeCourse(degrees: number): number {
  if (!Number.isFinite(degrees)) throw new RangeError("Course must be finite.");
  return ((degrees % 360) + 360) % 360;
}

export function signedHeadingError(targetDeg: number, actualDeg: number): number {
  const target = normalizeCourse(targetDeg);
  const actual = normalizeCourse(actualDeg);
  return ((target - actual + 540) % 360) - 180;
}

export function createAutopilotState(selectedHeadingDeg = 0): AutopilotState {
  return {
    engaged: false,
    selectedHeadingDeg: normalizeCourse(selectedHeadingDeg),
    rudderLimitDeg: 25,
    offCourseAlarmDeg: 5,
  };
}

/**
 * Simplified heading-hold controller.
 * Positive rudder is starboard, matching the ship dynamics convention.
 * This is a training controller, not a certified vessel autopilot model.
 */
export function stepAutopilot(
  state: AutopilotState,
  ship: ShipDynamicsState,
  _dtSeconds: number,
): AutopilotStepResult {
  if (!Number.isFinite(_dtSeconds) || _dtSeconds <= 0 || _dtSeconds > 1) {
    throw new RangeError("dtSeconds must be in the interval (0, 1].");
  }

  const headingErrorDeg = signedHeadingError(state.selectedHeadingDeg, ship.headingDeg);
  const offCourseAlarm = state.engaged && Math.abs(headingErrorDeg) > state.offCourseAlarmDeg;

  if (!state.engaged) {
    return { state, rudderCommandDeg: null, headingErrorDeg, offCourseAlarm: false };
  }

  // At very low speed the simplified rudder model has almost no authority.
  // Do not command a large rudder angle that cannot meaningfully control heading.
  if (ship.speedKn < 0.5) {
    return { state, rudderCommandDeg: 0, headingErrorDeg, offCourseAlarm };
  }

  // Proportional heading correction with yaw-rate damping. The output is a
  // rudder demand; the steering gear rate limit remains in stepShip().
  const proportional = headingErrorDeg * 1.2;
  const damping = ship.yawRateDegPerSec * 22;
  const rudderCommandDeg = clamp(
    proportional - damping,
    -state.rudderLimitDeg,
    state.rudderLimitDeg,
  );

  return { state, rudderCommandDeg, headingErrorDeg, offCourseAlarm };
}
