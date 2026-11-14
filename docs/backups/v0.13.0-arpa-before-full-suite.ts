import type { VesselState } from "./navigation";
import type { RadarMeasurement } from "./radarMeasurements";
import { velocityFromCourse } from "./navigation";

export interface ArpaMeasurement {
  xNm: number;
  yNm: number;
  timeSeconds: number;
}

export type ArpaTrackStatus = "acquiring" | "tracking" | "lost";

export interface ArpaTrack {
  targetId: string;
  status: ArpaTrackStatus;
  measurements: ArpaMeasurement[];
  lastMeasurementSeconds: number;
  targetVelocityEastKn: number | null;
  targetVelocityNorthKn: number | null;
  estimatedCourseDeg: number | null;
  estimatedSpeedKn: number | null;
  measurementsUsed: number;
}

export type ArpaTrackSet = Record<string, ArpaTrack>;

const MAX_MEASUREMENTS = 8;

/** Three missed 2.5-second sweeps in the standard radar configuration. */
export const DEFAULT_ARPA_LOST_AFTER_SECONDS = 7.5;

export interface ArpaAlertConfig {
  minimumDcpaNm: number;
  maximumTcpaMinutes: number;
}

export const DEFAULT_ARPA_ALERT_CONFIG: ArpaAlertConfig = {
  minimumDcpaNm: 0.5,
  maximumTcpaMinutes: 15,
};

function validateTime(timeSeconds: number) {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
    throw new RangeError("ARPA time must be finite and non-negative.");
  }
}

function validateAlertConfig(config: ArpaAlertConfig) {
  if (!Number.isFinite(config.minimumDcpaNm) || config.minimumDcpaNm < 0 ||
      !Number.isFinite(config.maximumTcpaMinutes) || config.maximumTcpaMinutes <= 0) {
    throw new RangeError("ARPA alert thresholds must be finite and non-negative (TCPA must be positive).");
  }
}

/** Starts manual acquisition from the contact's current measured position. */
export function acquireArpaTarget(target: Pick<RadarMeasurement, "id" | "xNm" | "yNm">, timeSeconds: number): ArpaTrack {
  validateTime(timeSeconds);
  return {
    targetId: target.id,
    status: "acquiring",
    measurements: [{ xNm: target.xNm, yNm: target.yNm, timeSeconds }],
    lastMeasurementSeconds: timeSeconds,
    targetVelocityEastKn: null,
    targetVelocityNorthKn: null,
    estimatedCourseDeg: null,
    estimatedSpeedKn: null,
    measurementsUsed: 1,
  };
}

/** Least-squares velocity estimate from absolute position measurements. */
function estimateVelocity(samples: readonly ArpaMeasurement[]) {
  if (samples.length < 2) return null;
  const origin = samples[0].timeSeconds;
  const meanT = samples.reduce((sum, sample) => sum + sample.timeSeconds - origin, 0) / samples.length;
  const meanX = samples.reduce((sum, sample) => sum + sample.xNm, 0) / samples.length;
  const meanY = samples.reduce((sum, sample) => sum + sample.yNm, 0) / samples.length;
  let denominator = 0;
  let numeratorX = 0;
  let numeratorY = 0;
  for (const sample of samples) {
    const dt = sample.timeSeconds - origin - meanT;
    denominator += dt * dt;
    numeratorX += dt * (sample.xNm - meanX);
    numeratorY += dt * (sample.yNm - meanY);
  }
  if (denominator < 1e-12) return null;
  return {
    eastKn: (numeratorX / denominator) * 3600,
    northKn: (numeratorY / denominator) * 3600,
  };
}

/**
 * Updates tracks only from completed radar-sweep measurements.
 * Lost is declared after the configured number of missed sweeps. If a lost
 * contact reappears under the same sensor ID, its old history is discarded
 * and acquisition restarts from the new measured position.
 */
export function updateArpaTracks(
  tracks: ArpaTrackSet,
  scanMeasurements: readonly Pick<RadarMeasurement, "id" | "xNm" | "yNm">[],
  timeSeconds: number,
  lostAfterSeconds = DEFAULT_ARPA_LOST_AFTER_SECONDS,
): ArpaTrackSet {
  validateTime(timeSeconds);
  if (!Number.isFinite(lostAfterSeconds) || lostAfterSeconds <= 0) {
    throw new RangeError("ARPA lost timeout must be positive.");
  }

  let nextTracks = tracks;
  for (const [id, track] of Object.entries(tracks)) {
    const target = scanMeasurements.find((item) => item.id === id);
    if (!target) {
      if (track.status !== "lost" && timeSeconds - track.lastMeasurementSeconds >= lostAfterSeconds - 1e-9) {
        if (nextTracks === tracks) nextTracks = { ...tracks };
        nextTracks[id] = { ...track, status: "lost" };
      }
      continue;
    }

    if (track.status === "lost") {
      if (nextTracks === tracks) nextTracks = { ...tracks };
      nextTracks[id] = acquireArpaTarget({ id, xNm: target.xNm, yNm: target.yNm }, timeSeconds);
      continue;
    }
    if (timeSeconds <= track.lastMeasurementSeconds + 1e-9) continue;

    const nextMeasurements = [...track.measurements, {
      xNm: target.xNm,
      yNm: target.yNm,
      timeSeconds,
    }].slice(-MAX_MEASUREMENTS);
    const velocity = estimateVelocity(nextMeasurements);
    const speedKn = velocity ? Math.hypot(velocity.eastKn, velocity.northKn) : null;
    const courseDeg = velocity && speedKn !== null && speedKn > 1e-8
      ? (Math.atan2(velocity.eastKn, velocity.northKn) * 180 / Math.PI + 360) % 360
      : velocity ? track.estimatedCourseDeg : null;

    if (nextTracks === tracks) nextTracks = { ...tracks };
    nextTracks[id] = {
      ...track,
      status: velocity ? "tracking" : "acquiring",
      measurements: nextMeasurements,
      lastMeasurementSeconds: timeSeconds,
      targetVelocityEastKn: velocity?.eastKn ?? null,
      targetVelocityNorthKn: velocity?.northKn ?? null,
      estimatedCourseDeg: courseDeg,
      estimatedSpeedKn: speedKn,
      measurementsUsed: nextMeasurements.length,
    };
  }
  return nextTracks;
}

export interface ArpaSolution {
  rangeNm: number;
  bearingDeg: number;
  tcpaMin: number | null;
  dcpaNm: number | null;
}

/** CPA/TCPA from the latest contact position, estimated target velocity and own-ship motion. */
export function calculateArpaSolution(
  track: ArpaTrack,
  target: Pick<VesselState, "xNm" | "yNm">,
  own: Pick<VesselState, "xNm" | "yNm" | "courseDeg" | "speedKn">,
): ArpaSolution {
  const east = target.xNm - own.xNm;
  const north = target.yNm - own.yNm;
  const rangeNm = Math.hypot(east, north);
  const bearingDeg = (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
  if (track.status !== "tracking" || track.targetVelocityEastKn === null || track.targetVelocityNorthKn === null || rangeNm < 1e-9) {
    return { rangeNm, bearingDeg, tcpaMin: null, dcpaNm: null };
  }
  const ownVelocity = velocityFromCourse(own.courseDeg, own.speedKn);
  const relativeEastKn = track.targetVelocityEastKn - ownVelocity.eastKn;
  const relativeNorthKn = track.targetVelocityNorthKn - ownVelocity.northKn;
  const velocitySquared = relativeEastKn ** 2 + relativeNorthKn ** 2;
  if (velocitySquared < 1e-12) return { rangeNm, bearingDeg, tcpaMin: null, dcpaNm: null };
  const timeHours = -(east * relativeEastKn + north * relativeNorthKn) / velocitySquared;
  const cpaEast = east + relativeEastKn * timeHours;
  const cpaNorth = north + relativeNorthKn * timeHours;
  return {
    rangeNm,
    bearingDeg,
    tcpaMin: timeHours * 60,
    dcpaNm: Math.hypot(cpaEast, cpaNorth),
  };
}

/** Training alert only; thresholds are configurable and are not COLREG limits. */
export function isArpaCloseApproachAlert(
  track: ArpaTrack,
  solution: ArpaSolution,
  config: ArpaAlertConfig = DEFAULT_ARPA_ALERT_CONFIG,
): boolean {
  validateAlertConfig(config);
  return track.status === "tracking" &&
    solution.tcpaMin !== null && solution.dcpaNm !== null &&
    solution.tcpaMin >= 0 &&
    solution.tcpaMin <= config.maximumTcpaMinutes &&
    solution.dcpaNm < config.minimumDcpaNm;
}
