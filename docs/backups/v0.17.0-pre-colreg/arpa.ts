import type { VesselState } from "./navigation";
import type { RadarMeasurement } from "./radarMeasurements";
import { velocityFromCourse } from "./navigation";

export interface ArpaMeasurement {
  xNm: number;
  yNm: number;
  timeSeconds: number;
  radarId?: string;
}

export type ArpaTrackStatus = "acquiring" | "tracking" | "lost";

export interface ArpaTrack {
  /** Stable identity assigned at manual acquisition; does not change on an echo swap. */
  targetId: string;
  /** Current radar echo associated with this logical ARPA track. */
  associatedRadarId: string;
  status: ArpaTrackStatus;
  measurements: ArpaMeasurement[];
  lastMeasurementSeconds: number;
  targetVelocityEastKn: number | null;
  targetVelocityNorthKn: number | null;
  estimatedCourseDeg: number | null;
  estimatedSpeedKn: number | null;
  measurementsUsed: number;
  swapDetected: boolean;
  swapCount: number;
  lastSwapSeconds: number | null;
}

export type ArpaTrackSet = Record<string, ArpaTrack>;

const MAX_MEASUREMENTS = 8;
export const DEFAULT_ARPA_LOST_AFTER_SECONDS = 7.5;
export const DEFAULT_ARPA_ASSOCIATION_GATE_NM = 0.05;

export interface ArpaAlertConfig {
  minimumDcpaNm: number;
  maximumTcpaMinutes: number;
}

export const DEFAULT_ARPA_ALERT_CONFIG: ArpaAlertConfig = {
  minimumDcpaNm: 0.5,
  maximumTcpaMinutes: 15,
};

export interface TrialManoeuvre {
  courseDeg: number;
  speedKn: number;
}

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

function validateTrial(trial: TrialManoeuvre) {
  if (!Number.isFinite(trial.courseDeg) || !Number.isFinite(trial.speedKn) ||
      trial.courseDeg < 0 || trial.courseDeg >= 360 || trial.speedKn < 0) {
    throw new RangeError("Trial course must be in [0, 360) degrees and speed must be non-negative.");
  }
}

/** Starts manual acquisition from the contact's current measured position. */
export function acquireArpaTarget(target: Pick<RadarMeasurement, "id" | "xNm" | "yNm">, timeSeconds: number): ArpaTrack {
  validateTime(timeSeconds);
  return {
    targetId: target.id,
    associatedRadarId: target.id,
    status: "acquiring",
    measurements: [{ xNm: target.xNm, yNm: target.yNm, timeSeconds, radarId: target.id }],
    lastMeasurementSeconds: timeSeconds,
    targetVelocityEastKn: null,
    targetVelocityNorthKn: null,
    estimatedCourseDeg: null,
    estimatedSpeedKn: null,
    measurementsUsed: 1,
    swapDetected: false,
    swapCount: 0,
    lastSwapSeconds: null,
  };
}

/** Least-squares velocity estimate from measured absolute positions. */
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
  return { eastKn: numeratorX / denominator * 3600, northKn: numeratorY / denominator * 3600 };
}

function predictTrackPosition(track: ArpaTrack, timeSeconds: number) {
  const last = track.measurements[track.measurements.length - 1];
  const hours = Math.max(0, timeSeconds - last.timeSeconds) / 3600;
  return {
    xNm: last.xNm + (track.targetVelocityEastKn ?? 0) * hours,
    yNm: last.yNm + (track.targetVelocityNorthKn ?? 0) * hours,
  };
}

/** Rectangular Hungarian assignment: each row receives one unique column. */
function minimumCostAssignment(costs: readonly (readonly number[])[]): number[] {
  const rowCount = costs.length;
  if (rowCount === 0) return [];
  const columnCount = costs[0].length;
  if (columnCount < rowCount || costs.some((row) => row.length !== columnCount)) {
    throw new RangeError("ARPA assignment matrix must be rectangular with at least as many columns as rows.");
  }
  const u = Array(rowCount + 1).fill(0);
  const v = Array(columnCount + 1).fill(0);
  const p = Array(columnCount + 1).fill(0);
  const way = Array(columnCount + 1).fill(0);

  for (let i = 1; i <= rowCount; i += 1) {
    p[0] = i;
    let column0 = 0;
    const minValues = Array(columnCount + 1).fill(Number.POSITIVE_INFINITY);
    const used = Array(columnCount + 1).fill(false);
    do {
      used[column0] = true;
      const row0 = p[column0];
      let delta = Number.POSITIVE_INFINITY;
      let column1 = 0;
      for (let j = 1; j <= columnCount; j += 1) {
        if (used[j]) continue;
        const current = costs[row0 - 1][j - 1] - u[row0] - v[j];
        if (current < minValues[j]) {
          minValues[j] = current;
          way[j] = column0;
        }
        if (minValues[j] < delta) {
          delta = minValues[j];
          column1 = j;
        }
      }
      for (let j = 0; j <= columnCount; j += 1) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minValues[j] -= delta;
        }
      }
      column0 = column1;
    } while (p[column0] !== 0);

    do {
      const column1 = way[column0];
      p[column0] = p[column1];
      column0 = column1;
    } while (column0 !== 0);
  }

  const assignment = Array(rowCount).fill(-1);
  for (let j = 1; j <= columnCount; j += 1) {
    if (p[j] !== 0) assignment[p[j] - 1] = j - 1;
  }
  return assignment;
}

function restartTrack(track: ArpaTrack, measurement: Pick<RadarMeasurement, "id" | "xNm" | "yNm">, timeSeconds: number): ArpaTrack {
  return {
    ...acquireArpaTarget(measurement, timeSeconds),
    targetId: track.targetId,
    swapCount: track.swapCount,
    lastSwapSeconds: track.lastSwapSeconds,
  };
}

/**
 * Associate echoes to existing logical tracks by predicted position. The
 * global minimum-cost one-to-one assignment prevents two tracks consuming
 * one echo while maximizing valid associations within the gate. A changed echo identity is surfaced as a Target Swap event.
 *
 * This is a deterministic teaching association model, not a certified ARPA
 * tracking algorithm. Measurements are consumed only on completed radar scans.
 */
export function updateArpaTracks(
  tracks: ArpaTrackSet,
  scanMeasurements: readonly Pick<RadarMeasurement, "id" | "xNm" | "yNm">[],
  timeSeconds: number,
  lostAfterSeconds = DEFAULT_ARPA_LOST_AFTER_SECONDS,
  associationGateNm = DEFAULT_ARPA_ASSOCIATION_GATE_NM,
): ArpaTrackSet {
  validateTime(timeSeconds);
  if (!Number.isFinite(lostAfterSeconds) || lostAfterSeconds <= 0 ||
      !Number.isFinite(associationGateNm) || associationGateNm <= 0) {
    throw new RangeError("ARPA lost timeout and association gate must be positive.");
  }

  const next: ArpaTrackSet = { ...tracks };
  const activeTracks = Object.values(tracks).filter((track) => track.status !== "lost");
  const unmatchedCost = (associationGateNm + 1) * (activeTracks.length + 1);
  const invalidCost = unmatchedCost * 100;
  const costMatrix = activeTracks.map((track) => {
    const predicted = predictTrackPosition(track, timeSeconds);
    const echoCosts = scanMeasurements.map((measurement) => {
      const distance = Math.hypot(measurement.xNm - predicted.xNm, measurement.yNm - predicted.yNm);
      return distance <= associationGateNm ? distance : invalidCost;
    });
    return [...echoCosts, ...Array(activeTracks.length).fill(unmatchedCost)];
  });
  const assignedColumns = minimumCostAssignment(costMatrix);
  const assignedEchoes = new Set<string>();
  const assignments = new Map<string, typeof scanMeasurements[number]>();
  activeTracks.forEach((track, index) => {
    const column = assignedColumns[index];
    if (column >= 0 && column < scanMeasurements.length && costMatrix[index][column] <= associationGateNm) {
      const measurement = scanMeasurements[column];
      assignments.set(track.targetId, measurement);
      assignedEchoes.add(measurement.id);
    }
  });

  for (const track of activeTracks) {
    const measurement = assignments.get(track.targetId);
    if (!measurement) {
      if (timeSeconds - track.lastMeasurementSeconds >= lostAfterSeconds - 1e-9) {
        next[track.targetId] = { ...track, status: "lost", swapDetected: false };
      } else if (track.swapDetected) {
        next[track.targetId] = { ...track, swapDetected: false };
      }
      continue;
    }
    if (timeSeconds <= track.lastMeasurementSeconds + 1e-9) continue;

    const swapped = measurement.id !== track.associatedRadarId;
    const samples = [...track.measurements, {
      xNm: measurement.xNm,
      yNm: measurement.yNm,
      timeSeconds,
      radarId: measurement.id,
    }].slice(-MAX_MEASUREMENTS);
    const velocity = estimateVelocity(samples);
    const speedKn = velocity ? Math.hypot(velocity.eastKn, velocity.northKn) : null;
    const courseDeg = velocity && speedKn !== null && speedKn > 1e-8
      ? (Math.atan2(velocity.eastKn, velocity.northKn) * 180 / Math.PI + 360) % 360
      : velocity ? track.estimatedCourseDeg : null;

    next[track.targetId] = {
      ...track,
      associatedRadarId: measurement.id,
      status: velocity ? "tracking" : "acquiring",
      measurements: samples,
      lastMeasurementSeconds: timeSeconds,
      targetVelocityEastKn: velocity?.eastKn ?? null,
      targetVelocityNorthKn: velocity?.northKn ?? null,
      estimatedCourseDeg: courseDeg,
      estimatedSpeedKn: speedKn,
      measurementsUsed: samples.length,
      swapDetected: swapped,
      swapCount: track.swapCount + (swapped ? 1 : 0),
      lastSwapSeconds: swapped ? timeSeconds : track.lastSwapSeconds,
    };
  }

  // A lost logical track can be reacquired only by its last associated echo ID.
  for (const track of Object.values(tracks)) {
    if (track.status !== "lost") continue;
    const measurement = scanMeasurements.find((item) => item.id === track.associatedRadarId);
    if (measurement && !assignedEchoes.has(measurement.id)) {
      next[track.targetId] = restartTrack(track, measurement, timeSeconds);
      assignedEchoes.add(measurement.id);
    }
  }
  return next;
}

export interface ArpaSolution {
  rangeNm: number;
  bearingDeg: number;
  tcpaMin: number | null;
  dcpaNm: number | null;
}

/** CPA/TCPA from measured contact position, estimated target velocity and own-ship motion. */
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
  return { rangeNm, bearingDeg, tcpaMin: timeHours * 60, dcpaNm: Math.hypot(cpaEast, cpaNorth) };
}

/** Predicts the same target against a hypothetical own-ship course and speed. */
export function calculateTrialManoeuvre(
  track: ArpaTrack,
  target: Pick<VesselState, "xNm" | "yNm">,
  own: Pick<VesselState, "xNm" | "yNm">,
  trial: TrialManoeuvre,
): ArpaSolution {
  validateTrial(trial);
  return calculateArpaSolution(track, target, { ...own, ...trial });
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
