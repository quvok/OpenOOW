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

function validateTime(timeSeconds: number) {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
    throw new RangeError("ARPA time must be finite and non-negative.");
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
 * Updates acquired tracks only from completed radar-sweep measurements.
 * Scenario truth course/speed are never read by the tracker.
 */
export function updateArpaTracks(
  tracks: ArpaTrackSet,
  measurements: readonly Pick<RadarMeasurement, "id" | "xNm" | "yNm">[],
  timeSeconds: number,
  lostAfterSeconds = 10,
): ArpaTrackSet {
  validateTime(timeSeconds);
  if (!Number.isFinite(lostAfterSeconds) || lostAfterSeconds <= 0) {
    throw new RangeError("ARPA lost timeout must be positive.");
  }

  let nextTracks = tracks;
  for (const [id, track] of Object.entries(tracks)) {
    if (track.status === "lost") continue;
    const target = measurements.find((item) => item.id === id);
    if (!target) {
      if (timeSeconds - track.lastMeasurementSeconds > lostAfterSeconds) {
        if (nextTracks === tracks) nextTracks = { ...tracks };
        nextTracks[id] = { ...track, status: "lost" };
      }
      continue;
    }
    if (timeSeconds <= track.lastMeasurementSeconds + 1e-9) continue;

    const measurements = [...track.measurements, {
      xNm: target.xNm,
      yNm: target.yNm,
      timeSeconds,
    }].slice(-MAX_MEASUREMENTS);
    const velocity = estimateVelocity(measurements);
    const speedKn = velocity ? Math.hypot(velocity.eastKn, velocity.northKn) : null;
    const courseDeg = velocity && speedKn !== null && speedKn > 1e-8
      ? (Math.atan2(velocity.eastKn, velocity.northKn) * 180 / Math.PI + 360) % 360
      : velocity ? track.estimatedCourseDeg : null;

    if (nextTracks === tracks) nextTracks = { ...tracks };
    nextTracks[id] = {
      ...track,
      status: velocity ? "tracking" : "acquiring",
      measurements,
      lastMeasurementSeconds: timeSeconds,
      targetVelocityEastKn: velocity?.eastKn ?? null,
      targetVelocityNorthKn: velocity?.northKn ?? null,
      estimatedCourseDeg: courseDeg,
      estimatedSpeedKn: speedKn,
      measurementsUsed: measurements.length,
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
  if (track.targetVelocityEastKn === null || track.targetVelocityNorthKn === null || rangeNm < 1e-9) {
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
