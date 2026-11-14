import { describe, expect, it } from "vitest";
import type { VesselState } from "../src/core/navigation";
import {
  acquireArpaTarget,
  calculateArpaSolution,
  calculateTrialManoeuvre,
  updateArpaTracks,
  isArpaCloseApproachAlert,
  DEFAULT_ARPA_ALERT_CONFIG,
  DEFAULT_ARPA_LOST_AFTER_SECONDS,
  DEFAULT_ARPA_ASSOCIATION_GATE_NM,
  type ArpaTrackSet,
} from "../src/core/arpa";

const target: VesselState = { id: "T1", xNm: 0, yNm: 2, courseDeg: 180, speedKn: 5 };
const own: VesselState = { id: "OWN", xNm: 0, yNm: 0, courseDeg: 0, speedKn: 10 };

describe("ARPA acquisition and tracking", () => {
  it("starts in acquiring state with one measured position", () => {
    const track = acquireArpaTarget(target, 0);
    expect(track.status).toBe("acquiring");
    expect(track.measurements).toHaveLength(1);
    expect(track.estimatedSpeedKn).toBeNull();
    expect(track.associatedRadarId).toBe("T1");
  });

  it("estimates a target from successive measured positions, not declared course/speed", () => {
    let tracks: ArpaTrackSet = { T1: acquireArpaTarget(target, 0) };
    tracks = updateArpaTracks(tracks, [{ id: "T1", xNm: 0, yNm: 2 - 5 / 3600 * 2.5 }], 2.5);
    expect(tracks.T1.status).toBe("tracking");
    expect(tracks.T1.estimatedCourseDeg).toBeCloseTo(180);
    expect(tracks.T1.estimatedSpeedKn).toBeCloseTo(5);
  });

  it("smooths measured positions with a least-squares estimate", () => {
    let tracks: ArpaTrackSet = { T1: acquireArpaTarget({ ...target, yNm: 10 }, 0) };
    tracks = updateArpaTracks(tracks, [{ id: "T1", xNm: 0, yNm: 10 - 5 / 3600 * 2.5 + 0.00001 }], 2.5);
    tracks = updateArpaTracks(tracks, [{ id: "T1", xNm: 0, yNm: 10 - 5 / 3600 * 5 - 0.00001 }], 5);
    expect(tracks.T1.estimatedSpeedKn).toBeCloseTo(5, 1);
  });

  it("calculates CPA/TCPA from estimated target and own-ship velocities", () => {
    let tracks: ArpaTrackSet = { T1: acquireArpaTarget(target, 0) };
    tracks = updateArpaTracks(tracks, [{ id: "T1", xNm: 0, yNm: 2 - 5 / 3600 * 2.5 }], 2.5);
    const solution = calculateArpaSolution(tracks.T1, { xNm: 0, yNm: 2 - 5 / 3600 * 2.5 }, { ...own, yNm: 10 * 2.5 / 3600 });
    expect(solution.tcpaMin).toBeCloseTo(8 - 2.5 / 60);
    expect(solution.dcpaNm).toBeCloseTo(0);
  });

  it("declares Lost only after three missed radar sweeps", () => {
    let tracks: ArpaTrackSet = { T1: acquireArpaTarget(target, 0) };
    expect(DEFAULT_ARPA_LOST_AFTER_SECONDS).toBe(7.5);
    tracks = updateArpaTracks(tracks, [], 2.5);
    expect(tracks.T1.status).toBe("acquiring");
    tracks = updateArpaTracks(tracks, [], 5);
    expect(tracks.T1.status).toBe("acquiring");
    tracks = updateArpaTracks(tracks, [], 7.5);
    expect(tracks.T1.status).toBe("lost");
  });

  it("reacquires a lost echo without retaining stale velocity history", () => {
    let tracks: ArpaTrackSet = { T1: acquireArpaTarget(target, 0) };
    tracks = updateArpaTracks(tracks, [], 7.5);
    tracks = updateArpaTracks(tracks, [{ id: "T1", xNm: 0.2, yNm: 1.4 }], 10);
    expect(tracks.T1.status).toBe("acquiring");
    expect(tracks.T1.measurements).toHaveLength(1);
    expect(tracks.T1.measurements[0]).toMatchObject({ xNm: 0.2, yNm: 1.4, timeSeconds: 10 });
    expect(tracks.T1.estimatedSpeedKn).toBeNull();
  });

  it("detects Target Swap while preserving the logical track identities", () => {
    let tracks: ArpaTrackSet = {
      A: acquireArpaTarget({ id: "A", xNm: 0, yNm: 0 }, 0),
      B: acquireArpaTarget({ id: "B", xNm: 1, yNm: 0 }, 0),
    };
    tracks = updateArpaTracks(tracks, [
      { id: "A", xNm: 5 / 3600 * 2.5, yNm: 0 },
      { id: "B", xNm: 1 + 5 / 3600 * 2.5, yNm: 0 },
    ], 2.5);
    expect(tracks.A.status).toBe("tracking");
    expect(tracks.B.status).toBe("tracking");

    tracks = updateArpaTracks(tracks, [
      { id: "A", xNm: 5 / 3600 * 5 + 1, yNm: 0 },
      { id: "B", xNm: 5 / 3600 * 5, yNm: 0 },
    ], 5);
    expect(tracks.A.associatedRadarId).toBe("B");
    expect(tracks.B.associatedRadarId).toBe("A");
    expect(tracks.A.swapDetected).toBe(true);
    expect(tracks.B.swapDetected).toBe(true);
    expect(tracks.A.swapCount).toBe(1);
    expect(tracks.B.swapCount).toBe(1);
    expect(tracks.A.lastSwapSeconds).toBe(5);

    tracks = updateArpaTracks(tracks, [
      { id: "A", xNm: 1 + 5 / 3600 * 7.5, yNm: 0 },
      { id: "B", xNm: 5 / 3600 * 7.5, yNm: 0 },
    ], 7.5);
    expect(tracks.A.associatedRadarId).toBe("B");
    expect(tracks.B.associatedRadarId).toBe("A");
    expect(tracks.A.swapDetected).toBe(false);
    expect(tracks.A.swapCount).toBe(1);
  });

  it("chooses the globally best one-to-one association instead of a greedy local match", () => {
    const tracks: ArpaTrackSet = {
      A: acquireArpaTarget({ id: "A", xNm: 0, yNm: 0 }, 0),
      B: acquireArpaTarget({ id: "B", xNm: 2.5, yNm: 0 }, 0),
    };
    const next = updateArpaTracks(tracks, [
      { id: "E1", xNm: 0.5, yNm: 0 },
      { id: "E2", xNm: -0.7, yNm: 0 },
    ], 2.5, DEFAULT_ARPA_LOST_AFTER_SECONDS, 2.1);
    expect(next.A.associatedRadarId).toBe("E2");
    expect(next.B.associatedRadarId).toBe("E1");
    expect(next.A.lastMeasurementSeconds).toBe(2.5);
    expect(next.B.lastMeasurementSeconds).toBe(2.5);
  });

  it("does not associate echoes outside the prediction gate", () => {
    const tracks = { T1: acquireArpaTarget(target, 0) };
    const next = updateArpaTracks(tracks, [{ id: "T1", xNm: 1, yNm: 1 }], 2.5);
    expect(next.T1.status).toBe("acquiring");
    expect(next.T1.measurements).toHaveLength(1);
    expect(DEFAULT_ARPA_ASSOCIATION_GATE_NM).toBeGreaterThan(0);
  });


  it("assigns each radar echo to at most one active ARPA track", () => {
    const tracks: ArpaTrackSet = {
      A: acquireArpaTarget({ id: "A", xNm: 0, yNm: 0 }, 0),
      B: acquireArpaTarget({ id: "B", xNm: 0.01, yNm: 0 }, 0),
    };
    const next = updateArpaTracks(tracks, [{ id: "ECHO", xNm: 0.005, yNm: 0 }], 2.5);
    const updated = Object.values(next).filter((track) => track.lastMeasurementSeconds === 2.5);
    expect(updated).toHaveLength(1);
    expect(updated[0].associatedRadarId).toBe("ECHO");
  });

  it("keeps a bounded rolling history of eight measurements", () => {
    let tracks: ArpaTrackSet = { T1: acquireArpaTarget({ id: "T1", xNm: 0, yNm: 0 }, 0) };
    for (let scan = 1; scan <= 12; scan += 1) {
      tracks = updateArpaTracks(tracks, [{ id: "T1", xNm: scan * 0.001, yNm: 0 }], scan * 2.5);
    }
    expect(tracks.T1.measurements).toHaveLength(8);
    expect(tracks.T1.measurements[0].timeSeconds).toBe(12.5);
    expect(tracks.T1.measurements[7].timeSeconds).toBe(30);
  });

  it("calculates Trial Manoeuvre without changing the original own-ship solution", () => {
    let tracks: ArpaTrackSet = { T1: acquireArpaTarget(target, 0) };
    tracks = updateArpaTracks(tracks, [{ id: "T1", xNm: 0, yNm: 2 - 5 / 3600 * 2.5 }], 2.5);
    const measured = { xNm: 0, yNm: 2 - 5 / 3600 * 2.5 };
    const baseline = calculateArpaSolution(tracks.T1, measured, own);
    const trial = calculateTrialManoeuvre(tracks.T1, measured, own, { courseDeg: 90, speedKn: 10 });
    expect(trial.tcpaMin).not.toBeCloseTo(baseline.tcpaMin ?? 0);
    expect(trial.dcpaNm).not.toBeCloseTo(baseline.dcpaNm ?? 0);
    expect(calculateArpaSolution(tracks.T1, measured, own)).toEqual(baseline);
    expect(() => calculateTrialManoeuvre(tracks.T1, measured, own, { courseDeg: 360, speedKn: 10 })).toThrow(RangeError);
    expect(() => calculateTrialManoeuvre(tracks.T1, measured, own, { courseDeg: 90, speedKn: -1 })).toThrow(RangeError);
  });

  it("raises configurable close-approach alerts only for tracked targets and positive TCPA", () => {
    const track = {
      ...acquireArpaTarget(target, 0),
      status: "tracking" as const,
      targetVelocityEastKn: 0,
      targetVelocityNorthKn: -5,
    };
    const solution = { rangeNm: 1, bearingDeg: 0, tcpaMin: 8, dcpaNm: 0.2 };
    expect(isArpaCloseApproachAlert(track, solution)).toBe(true);
    expect(isArpaCloseApproachAlert(track, { ...solution, tcpaMin: -1 })).toBe(false);
    expect(isArpaCloseApproachAlert(track, { ...solution, tcpaMin: 16 })).toBe(false);
    expect(isArpaCloseApproachAlert(track, { ...solution, dcpaNm: 0.7 })).toBe(false);
    expect(isArpaCloseApproachAlert({ ...track, status: "lost" }, solution)).toBe(false);
  });

  it("validates alert settings and timing configuration", () => {
    const tracks = { T1: acquireArpaTarget(target, 0) };
    expect(() => updateArpaTracks(tracks, [], 5, 0)).toThrow(RangeError);
    expect(() => updateArpaTracks(tracks, [], 5, 7.5, 0)).toThrow(RangeError);
    expect(() => isArpaCloseApproachAlert(tracks.T1, { rangeNm: 1, bearingDeg: 0, tcpaMin: 2, dcpaNm: 0.1 }, { minimumDcpaNm: -1, maximumTcpaMinutes: 15 })).toThrow(RangeError);
    expect(DEFAULT_ARPA_ALERT_CONFIG).toEqual({ minimumDcpaNm: 0.5, maximumTcpaMinutes: 15 });
  });

  it("does not append a duplicate measurement at the same scan time", () => {
    const tracks = { T1: acquireArpaTarget(target, 0) };
    expect(updateArpaTracks(tracks, [{ id: "T1", xNm: 0, yNm: 2 }], 0)).toEqual(tracks);
  });
});
