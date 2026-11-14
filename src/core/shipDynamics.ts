export interface ShipDynamicsState {
  eastNm: number;
  northNm: number;
  headingDeg: number;
  speedKn: number;
  yawRateDegPerSec: number;
  rudderDeg: number;
  throttlePercent: number;
  elapsedSeconds: number;
}

export interface ShipModelParameters {
  maxSpeedKn: number;
  maxAccelerationKnPerSec: number;
  maxDecelerationKnPerSec: number;
  maxRudderDeg: number;
  maxTurnRateDegPerSec: number;
  yawResponseSeconds: number;
}

export const DEFAULT_SHIP_PARAMETERS: ShipModelParameters = {
  maxSpeedKn: 15,
  maxAccelerationKnPerSec: 0.025,
  maxDecelerationKnPerSec: 0.035,
  maxRudderDeg: 35,
  maxTurnRateDegPerSec: 0.35,
  yawResponseSeconds: 8,
};

export const INITIAL_SHIP_STATE: ShipDynamicsState = {
  eastNm: 0,
  northNm: 0,
  headingDeg: 0,
  speedKn: 0,
  yawRateDegPerSec: 0,
  rudderDeg: 0,
  throttlePercent: 0,
  elapsedSeconds: 0,
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function stepShip(
  state: ShipDynamicsState,
  dtSeconds: number,
  parameters: ShipModelParameters = DEFAULT_SHIP_PARAMETERS,
): ShipDynamicsState {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0 || dtSeconds > 1) {
    throw new RangeError("dtSeconds must be in the interval (0, 1].");
  }

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

  const rudder = clamp(
    state.rudderDeg,
    -parameters.maxRudderDeg,
    parameters.maxRudderDeg,
  );
  const speedFactor = Math.min(speedKn / 8, 1.4);
  const targetYawRate =
    (rudder / parameters.maxRudderDeg) *
    parameters.maxTurnRateDegPerSec *
    speedFactor;
  const yawRateDegPerSec =
    state.yawRateDegPerSec +
    ((targetYawRate - state.yawRateDegPerSec) /
      parameters.yawResponseSeconds) *
      dtSeconds;

  const headingDeg =
    (state.headingDeg + yawRateDegPerSec * dtSeconds + 360) % 360;
  const headingRad = (headingDeg * Math.PI) / 180;
  const distanceNm = (speedKn * dtSeconds) / 3600;

  return {
    ...state,
    eastNm: state.eastNm + Math.sin(headingRad) * distanceNm,
    northNm: state.northNm + Math.cos(headingRad) * distanceNm,
    headingDeg,
    speedKn,
    yawRateDegPerSec,
    elapsedSeconds: state.elapsedSeconds + dtSeconds,
  };
}
