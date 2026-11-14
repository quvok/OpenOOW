import type { VesselState } from "./navigation";

export interface RadarTrackSample {
  /** Target position relative to own ship at the sample time, in NM. */
  xNm: number;
  yNm: number;
  timeSeconds: number;
}

export type RadarTrackHistory = Record<string, RadarTrackSample[]>;

/** Creates an initial relative track point for every currently visible contact. */
export function createRadarTrackHistory(
  targets: readonly VesselState[],
  timeSeconds = 0,
  ownPosition: { xNm: number; yNm: number } = { xNm: 0, yNm: 0 },
): RadarTrackHistory {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
    throw new RangeError("Track time must be finite and non-negative.");
  }
  return Object.fromEntries(targets.map((target) => [target.id, [{
    xNm: target.xNm - ownPosition.xNm,
    yNm: target.yNm - ownPosition.yNm,
    timeSeconds,
  }]]));
}

/** Adds one relative-position sample per interval and bounds memory by retaining the newest samples. */
export function recordRadarTracks(
  history: RadarTrackHistory,
  targets: readonly VesselState[],
  timeSeconds: number,
  sampleIntervalSeconds = 5,
  maxSamples = 120,
  ownPosition: { xNm: number; yNm: number } = { xNm: 0, yNm: 0 },
): RadarTrackHistory {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0 ||
      !Number.isFinite(sampleIntervalSeconds) || sampleIntervalSeconds <= 0 ||
      !Number.isInteger(maxSamples) || maxSamples < 2) {
    throw new RangeError("Track time/interval must be positive finite values and maxSamples must be an integer >= 2.");
  }

  let nextHistory = history;
  for (const target of targets) {
    const previous = history[target.id] ?? [];
    const last = previous[previous.length - 1];
    if (last && timeSeconds - last.timeSeconds < sampleIntervalSeconds - 1e-9) continue;
    if (nextHistory === history) nextHistory = { ...history };
    const sample = {
      xNm: target.xNm - ownPosition.xNm,
      yNm: target.yNm - ownPosition.yNm,
      timeSeconds,
    };
    nextHistory[target.id] = [...previous, sample].slice(-maxSamples);
  }
  return nextHistory;
}
