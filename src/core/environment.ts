import { normalize360 } from "./units";

/**
 * Environmental inputs for the training model.
 * Wind direction is the direction FROM which wind blows.
 * Current direction is the direction TOWARD which current flows.
 * Wave height is significant wave height (metres); visibility is meteorological visibility (NM).
 */
export interface EnvironmentState {
  windSpeedKn: number;
  windFromDeg: number;
  currentSpeedKn: number;
  currentSetDeg: number;
  significantWaveHeightM: number;
  visibilityNm: number;
}

export interface EnvironmentModelParameters {
  /** Maximum wind-induced leeway at reference wind speed and beam wind. */
  leewayAtReferenceWindDeg: number;
  referenceWindSpeedKn: number;
  /** Fraction of significant wave height used as a conservative speed-loss proxy. */
  waveSpeedLossPerMetre: number;
}

export const CALM_ENVIRONMENT: EnvironmentState = {
  windSpeedKn: 0,
  windFromDeg: 0,
  currentSpeedKn: 0,
  currentSetDeg: 0,
  significantWaveHeightM: 0,
  visibilityNm: 12,
};

export const DEFAULT_ENVIRONMENT_PARAMETERS: EnvironmentModelParameters = {
  leewayAtReferenceWindDeg: 3,
  referenceWindSpeedKn: 20,
  waveSpeedLossPerMetre: 0.015,
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function validateEnvironment(environment: EnvironmentState): void {
  const nonNegative = [
    environment.windSpeedKn,
    environment.currentSpeedKn,
    environment.significantWaveHeightM,
    environment.visibilityNm,
  ];
  if (nonNegative.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError("Environmental speeds, wave height and visibility must be finite and non-negative.");
  }
  if (!Number.isFinite(environment.windFromDeg) || !Number.isFinite(environment.currentSetDeg)) {
    throw new RangeError("Wind and current directions must be finite.");
  }
}

/**
 * Returns environmental velocity over ground in knots and wind leeway.
 * This is an explicitly simplified training approximation, not a validated
 * windage/seakeeping model. It does not model hull-specific wind coefficients,
 * wave spectrum, shallow-water effects or current shear.
 */
export function calculateEnvironmentalMotion(
  headingDeg: number,
  speedThroughWaterKn: number,
  environment: EnvironmentState = CALM_ENVIRONMENT,
  parameters: EnvironmentModelParameters = DEFAULT_ENVIRONMENT_PARAMETERS,
) {
  validateEnvironment(environment);
  if (!Number.isFinite(headingDeg) || !Number.isFinite(speedThroughWaterKn) || speedThroughWaterKn < 0) {
    throw new RangeError("Heading must be finite and speed through water must be finite and non-negative.");
  }
  if (
    !Number.isFinite(parameters.leewayAtReferenceWindDeg) ||
    parameters.leewayAtReferenceWindDeg < 0 ||
    !Number.isFinite(parameters.referenceWindSpeedKn) ||
    parameters.referenceWindSpeedKn <= 0 ||
    !Number.isFinite(parameters.waveSpeedLossPerMetre) ||
    parameters.waveSpeedLossPerMetre < 0
  ) {
    throw new RangeError("Invalid environment model parameters.");
  }

  const relativeWindFrom = ((environment.windFromDeg - headingDeg + 540) % 360) - 180;
  const windFactor = Math.min(environment.windSpeedKn / parameters.referenceWindSpeedKn, 2);
  const leewayDeg = clamp(
    -parameters.leewayAtReferenceWindDeg * windFactor * Math.sin(relativeWindFrom * Math.PI / 180),
    -12,
    12,
  );
  const waveSpeedFactor = clamp(
    1 - environment.significantWaveHeightM * parameters.waveSpeedLossPerMetre,
    0.7,
    1,
  );
  const speedThroughWater = speedThroughWaterKn * waveSpeedFactor;
  const groundTrackDeg = normalize360(headingDeg + leewayDeg);
  const currentRad = environment.currentSetDeg * Math.PI / 180;
  const trackRad = groundTrackDeg * Math.PI / 180;
  return {
    leewayDeg,
    speedThroughWaterKn: speedThroughWater,
    groundSpeedKn: Math.hypot(
      speedThroughWater * Math.sin(trackRad) + environment.currentSpeedKn * Math.sin(currentRad),
      speedThroughWater * Math.cos(trackRad) + environment.currentSpeedKn * Math.cos(currentRad),
    ),
    eastVelocityKn: speedThroughWater * Math.sin(trackRad) + environment.currentSpeedKn * Math.sin(currentRad),
    northVelocityKn: speedThroughWater * Math.cos(trackRad) + environment.currentSpeedKn * Math.cos(currentRad),
    groundTrackDeg: normalize360(Math.atan2(
      speedThroughWater * Math.sin(trackRad) + environment.currentSpeedKn * Math.sin(currentRad),
      speedThroughWater * Math.cos(trackRad) + environment.currentSpeedKn * Math.cos(currentRad),
    ) * 180 / Math.PI),
  };
}
