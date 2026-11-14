export interface ShipDynamicsState {
  eastNm: number;
  northNm: number;
  headingDeg: number;
  speedKn: number;
  yawRateDegPerSec: number;
  rudderDeg: number;
  actualRudderDeg: number;
  throttlePercent: number;
  elapsedSeconds: number;
}

export interface ShipModelParameters {
  maxSpeedKn: number;
  maxAccelerationKnPerSec: number;
  maxDecelerationKnPerSec: number;
  maxRudderDeg: number;
  maxRudderRateDegPerSec: number;
  maxTurnRateDegPerSec: number;
  referenceSpeedKn: number;
  yawResponseSeconds: number;
}

export const DEFAULT_SHIP_PARAMETERS: ShipModelParameters = {
  maxSpeedKn: 15,
  maxAccelerationKnPerSec: 0.025,
  maxDecelerationKnPerSec: 0.035,
  maxRudderDeg: 35,
  maxRudderRateDegPerSec: 2.3,
  maxTurnRateDegPerSec: 0.35,
  referenceSpeedKn: 8,
  yawResponseSeconds: 8,
};

export const INITIAL_SHIP_STATE: ShipDynamicsState = {
  eastNm: 0,
  northNm: 0,
  headingDeg: 0,
  speedKn: 0,
  yawRateDegPerSec: 0,
  rudderDeg: 0,
  actualRudderDeg: 0,
  throttlePercent: 0,
  elapsedSeconds: 0,
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const normalizeHeading = (heading: number) => ((heading % 360) + 360) % 360;

function validateParameters(parameters: ShipModelParameters) {
  const positive = [
    parameters.maxSpeedKn,
    parameters.maxAccelerationKnPerSec,
    parameters.maxDecelerationKnPerSec,
    parameters.maxRudderDeg,
    parameters.maxRudderRateDegPerSec,
    parameters.maxTurnRateDegPerSec,
    parameters.referenceSpeedKn,
    parameters.yawResponseSeconds,
  ];
  if (positive.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError("All ship model parameters must be finite and greater than zero.");
  }
}

/**
 * Advances the simplified ship model by one integration step.
 * Coordinates use a local tangent plane: east/north in nautical miles.
 * Heading is true, clockwise from north; positive rudder means starboard.
 */
export function stepShip(
  state: ShipDynamicsState,
  dtSeconds: number,
  parameters: ShipModelParameters = DEFAULT_SHIP_PARAMETERS,
): ShipDynamicsState {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0 || dtSeconds > 1) {
    throw new RangeError("dtSeconds must be in the interval (0, 1].");
  }
  validateParameters(parameters);

  const throttle = clamp(state.throttlePercent, 0, 100) / 100;
  const targetSpeed = throttle * parameters.maxSpeedKn;
  const speedError = targetSpeed - state.speedKn;
  const accelerationLimit =
    speedError >= 0
      ? parameters.maxAccelerationKnPerSec
      : parameters.maxDecelerationKnPerSec;
  const acceleration = clamp(
    speedError * 0.08,
    -accelerationLimit,
    accelerationLimit,
  );
  const speedKn = clamp(
    state.speedKn + acceleration * dtSeconds,
    0,
    parameters.maxSpeedKn,
  );

  // The steering gear cannot move the rudder instantaneously.
  const rudderCommand = clamp(
    state.rudderDeg,
    -parameters.maxRudderDeg,
    parameters.maxRudderDeg,
  );
  const rudderDelta = clamp(
    rudderCommand - state.actualRudderDeg,
    -parameters.maxRudderRateDegPerSec * dtSeconds,
    parameters.maxRudderRateDegPerSec * dtSeconds,
  );
  const actualRudderDeg = clamp(
    state.actualRudderDeg + rudderDelta,
    -parameters.maxRudderDeg,
    parameters.maxRudderDeg,
  );

  // Rudder effectiveness falls rapidly at low speed. This is a deliberately
  // simple speed-squared approximation, not a validated hydrodynamic law.
  const speedRatio = speedKn / parameters.referenceSpeedKn;
  const speedFactor = Math.min(speedRatio * speedRatio, 1.5);
  const targetYawRate =
    (actualRudderDeg / parameters.maxRudderDeg) *
    parameters.maxTurnRateDegPerSec *
    speedFactor;
  const yawRateDegPerSec =
    state.yawRateDegPerSec +
    ((targetYawRate - state.yawRateDegPerSec) /
      parameters.yawResponseSeconds) *
      dtSeconds;

  // Midpoint integration reduces the positional error during a turn.
  const headingDelta = yawRateDegPerSec * dtSeconds;
  const headingMid = normalizeHeading(state.headingDeg + headingDelta / 2);
  const headingDeg = normalizeHeading(state.headingDeg + headingDelta);
  const headingRad = (headingMid * Math.PI) / 180;
  const distanceNm = (speedKn * dtSeconds) / 3600;

  return {
    ...state,
    eastNm: state.eastNm + Math.sin(headingRad) * distanceNm,
    northNm: state.northNm + Math.cos(headingRad) * distanceNm,
    headingDeg,
    speedKn,
    yawRateDegPerSec,
    actualRudderDeg,
    elapsedSeconds: state.elapsedSeconds + dtSeconds,
  };
}
