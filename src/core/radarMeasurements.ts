import type { VesselState } from "./navigation";

export interface RadarMeasurement {
  id: string;
  xNm: number;
  yNm: number;
  rangeNm: number;
  bearingDeg: number;
  timeSeconds: number;
  scanNumber: number;
}

export interface RadarMeasurementConfig {
  scanIntervalSeconds: number;
  maximumRangeNm: number;
  rangeErrorNm: number;
  bearingErrorDeg: number;
  dropoutEveryScans: number;
}

export interface RadarScanClock {
  lastScanSeconds: number;
  scanNumber: number;
}

export const DEFAULT_RADAR_CONFIG: RadarMeasurementConfig = {
  scanIntervalSeconds: 2.5,
  maximumRangeNm: 12,
  rangeErrorNm: 0.01,
  bearingErrorDeg: 0.2,
  dropoutEveryScans: 17,
};

function validateConfig(config: RadarMeasurementConfig) {
  if (!Number.isFinite(config.scanIntervalSeconds) || config.scanIntervalSeconds <= 0 ||
      !Number.isFinite(config.maximumRangeNm) || config.maximumRangeNm <= 0 ||
      !Number.isFinite(config.rangeErrorNm) || config.rangeErrorNm < 0 ||
      !Number.isFinite(config.bearingErrorDeg) || config.bearingErrorDeg < 0 ||
      !Number.isInteger(config.dropoutEveryScans) || config.dropoutEveryScans < 0) {
    throw new RangeError("Invalid radar measurement configuration.");
  }
}

function stableIdHash(id: string) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Creates one deterministic radar sweep. Position errors are applied in polar
 * coordinates and converted back to absolute East/North NM coordinates.
 * This is a teaching model, not a validated radar propagation model.
 */
export function measureRadarContacts(
  own: Pick<VesselState, "xNm" | "yNm">,
  targets: readonly Pick<VesselState, "id" | "xNm" | "yNm">[],
  timeSeconds: number,
  scanNumber: number,
  config: RadarMeasurementConfig = DEFAULT_RADAR_CONFIG,
): RadarMeasurement[] {
  validateConfig(config);
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0 ||
      !Number.isInteger(scanNumber) || scanNumber < 0) {
    throw new RangeError("Radar scan time and number must be non-negative.");
  }

  const measurements: RadarMeasurement[] = [];
  for (const target of targets) {
    const east = target.xNm - own.xNm;
    const north = target.yNm - own.yNm;
    const trueRange = Math.hypot(east, north);
    if (trueRange > config.maximumRangeNm || trueRange < 1e-9) continue;

    const hash = stableIdHash(target.id);
    if (config.dropoutEveryScans > 0 &&
        (scanNumber + hash % config.dropoutEveryScans) % config.dropoutEveryScans === 0) {
      continue;
    }

    const phase = (hash % 997) * 0.013 + scanNumber * 0.71;
    const rangeError = config.rangeErrorNm * Math.sin(phase);
    const bearingError = config.bearingErrorDeg * Math.cos(phase * 0.83);
    const measuredRange = Math.max(0, trueRange + rangeError);
    const trueBearing = (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
    const measuredBearing = (trueBearing + bearingError + 360) % 360;
    const radians = measuredBearing * Math.PI / 180;

    measurements.push({
      id: target.id,
      xNm: own.xNm + Math.sin(radians) * measuredRange,
      yNm: own.yNm + Math.cos(radians) * measuredRange,
      rangeNm: measuredRange,
      bearingDeg: measuredBearing,
      timeSeconds,
      scanNumber,
    });
  }
  return measurements;
}

/** True when the next radar sweep is due on the simulation clock. */
export function isRadarScanDue(
  timeSeconds: number,
  clock: RadarScanClock,
  config: RadarMeasurementConfig = DEFAULT_RADAR_CONFIG,
) {
  validateConfig(config);
  if (!Number.isFinite(timeSeconds) || timeSeconds < clock.lastScanSeconds) {
    throw new RangeError("Radar scan time must be finite and monotonic.");
  }
  return timeSeconds - clock.lastScanSeconds >= config.scanIntervalSeconds - 1e-9;
}
