import { describe, expect, it } from "vitest";
import type { VesselState } from "../src/core/navigation";
import { acquireArpaTarget, calculateArpaSolution, updateArpaTracks, type ArpaTrackSet } from "../src/core/arpa";

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
    tracks = updateArpaTracks(tracks, [{ id: "T1", xNm: 0, yNm: 10 - 5 / 3600 * 2.5 + 0.0001 }], 2.5);
    tracks = updateArpaTracks(tracks, [{ id: "T1", xNm: 0, yNm: 10 - 5 / 3600 * 5 - 0.0001 }], 5);
    expect(tracks.T1.estimatedSpeedKn).toBeCloseTo(5, 1);
  });

  it("calculates CPA/TCPA from estimated velocity and own-ship velocity", () => {
    let tracks: ArpaTrackSet = { T1: acquireArpaTarget(target, 0) };
    tracks = updateArpaTracks(tracks, [{ id: "T1", xNm: 0, yNm: 2 - 5 / 3600 * 2.5 }], 2.5);
    const solution = calculateArpaSolution(tracks.T1, { xNm: 0, yNm: 2 - 5 / 3600 * 2.5 }, { ...own, yNm: 10 * 2.5 / 3600 });
    expect(solution.tcpaMin).toBeCloseTo(8 - 2.5 / 60);
    expect(solution.dcpaNm).toBeCloseTo(0);
  });

  it("marks a contact lost after the timeout when measurements disappear", () => {
    let tracks: ArpaTrackSet = { T1: acquireArpaTarget(target, 0) };
    tracks = updateArpaTracks(tracks, [], 10.1);
    expect(tracks.T1.status).toBe("lost");
  });

  it("does not append a duplicate measurement at the same scan time", () => {
    const tracks = { T1: acquireArpaTarget(target, 0) };
    const next = updateArpaTracks(tracks, [{ id: "T1", xNm: 0, yNm: 2 }], 0);
    expect(next).toBe(tracks);
  });

  it("rejects invalid timing configuration", () => {
    const tracks = { T1: acquireArpaTarget(target, 0) };
    expect(() => updateArpaTracks(tracks, [], 5, 0)).toThrow(RangeError);
  });
});
