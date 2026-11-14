import { describe, expect, it } from "vitest";
import type { VesselState } from "../src/core/navigation";
import {
  acquireArpaTarget,
  calculateArpaSolution,
  updateArpaTracks,
  isArpaCloseApproachAlert,
  DEFAULT_ARPA_ALERT_CONFIG,
  DEFAULT_ARPA_LOST_AFTER_SECONDS,
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
  });

  it("estimates a southbound target from successive positions, not declared course/speed", () => {
    let tracks: ArpaTrackSet = { T1: acquireArpaTarget(target, 0) };
    tracks = updateArpaTracks(tracks, [{ id: "T1", xNm: 0, yNm: 2 - 5 / 3600 * 2.5 }], 2.5);
    expect(tracks.T1.status).toBe("tracking");
    expect(tracks.T1.estimatedCourseDeg).toBeCloseTo(180);
    expect(tracks.T1.estimatedSpeedKn).toBeCloseTo(5);
  });

  it("smooths a sequence of measurements with a least-squares estimate", () => {
    let tracks: ArpaTrackSet = { T1: acquireArpaTarget({ ...target, yNm: 10 }, 0) };
    tracks = updateArpaTracks(tracks, [{ id: "T1", xNm: 0, yNm: 10 - 5 / 3600 * 2.5 + 0.00001 }], 2.5);
    tracks = updateArpaTracks(tracks, [{ id: "T1", xNm: 0, yNm: 10 - 5 / 3600 * 5 - 0.00001 }], 5);
    expect(tracks.T1.estimatedSpeedKn).toBeCloseTo(5, 1);
  });

  it("calculates CPA/TCPA from estimated velocity and own-ship velocity", () => {
    let tracks: ArpaTrackSet = { T1: acquireArpaTarget(target, 0) };
    tracks = updateArpaTracks(tracks, [{ id: "T1", xNm: 0, yNm: 2 - 5 / 3600 * 2.5 }], 2.5);
    const solution = calculateArpaSolution(tracks.T1, { xNm: 0, yNm: 2 - 5 / 3600 * 2.5 }, { ...own, yNm: 10 * 2.5 / 3600 });
    expect(solution.tcpaMin).toBeCloseTo(8 - 2.5 / 60);
    expect(solution.dcpaNm).toBeCloseTo(0);
  });

  it("declares Lost only after three missed 2.5-second sweeps", () => {
    let tracks: ArpaTrackSet = { T1: acquireArpaTarget(target, 0) };
    expect(DEFAULT_ARPA_LOST_AFTER_SECONDS).toBe(7.5);
    tracks = updateArpaTracks(tracks, [], 2.5);
    expect(tracks.T1.status).toBe("acquiring");
    tracks = updateArpaTracks(tracks, [], 5);
    expect(tracks.T1.status).toBe("acquiring");
    tracks = updateArpaTracks(tracks, [], 7.5);
    expect(tracks.T1.status).toBe("lost");
  });

  it("restarts acquisition from a fresh position when a lost contact reappears", () => {
    let tracks: ArpaTrackSet = { T1: acquireArpaTarget(target, 0) };
    tracks = updateArpaTracks(tracks, [], 7.5);
    tracks = updateArpaTracks(tracks, [{ id: "T1", xNm: 0.2, yNm: 1.4 }], 10);
    expect(tracks.T1.status).toBe("acquiring");
    expect(tracks.T1.measurements).toEqual([{ xNm: 0.2, yNm: 1.4, timeSeconds: 10 }]);
    expect(tracks.T1.estimatedSpeedKn).toBeNull();
  });

  it("raises a configurable close-approach training alert for positive TCPA inside limits", () => {
    const track = { ...acquireArpaTarget(target, 0), status: "tracking" as const, targetVelocityEastKn: 0, targetVelocityNorthKn: -5 };
    const solution = { rangeNm: 1, bearingDeg: 0, tcpaMin: 8, dcpaNm: 0.2 };
    expect(isArpaCloseApproachAlert(track, solution)).toBe(true);
    expect(isArpaCloseApproachAlert(track, { ...solution, tcpaMin: -1 })).toBe(false);
    expect(isArpaCloseApproachAlert(track, { ...solution, tcpaMin: 16 })).toBe(false);
    expect(isArpaCloseApproachAlert(track, { ...solution, dcpaNm: 0.7 })).toBe(false);
    expect(isArpaCloseApproachAlert({ ...track, status: "lost" }, solution)).toBe(false);
  });

  it("validates alert settings and rejects invalid timing configuration", () => {
    const tracks = { T1: acquireArpaTarget(target, 0) };
    expect(() => updateArpaTracks(tracks, [], 5, 0)).toThrow(RangeError);
    expect(() => isArpaCloseApproachAlert(tracks.T1, { rangeNm: 1, bearingDeg: 0, tcpaMin: 2, dcpaNm: 0.1 }, { minimumDcpaNm: -1, maximumTcpaMinutes: 15 })).toThrow(RangeError);
    expect(DEFAULT_ARPA_ALERT_CONFIG).toEqual({ minimumDcpaNm: 0.5, maximumTcpaMinutes: 15 });
  });

  it("does not append a duplicate measurement at the same scan time", () => {
    const tracks = { T1: acquireArpaTarget(target, 0) };
    const next = updateArpaTracks(tracks, [{ id: "T1", xNm: 0, yNm: 2 }], 0);
    expect(next).toBe(tracks);
  });
});
