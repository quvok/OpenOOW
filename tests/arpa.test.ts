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
    tracks = updateArpaTracks(tracks, [{ ...target, yNm: 2 - 5 / 3600 * 5 }], 5);
    expect(tracks.T1.status).toBe("tracking");
    expect(tracks.T1.estimatedCourseDeg).toBeCloseTo(180);
    expect(tracks.T1.estimatedSpeedKn).toBeCloseTo(5);
  });

  it("smooths a sequence of measurements with a least-squares estimate", () => {
    let tracks = { T1: acquireArpaTarget({ ...target, yNm: 10 }, 0) };
    tracks = updateArpaTracks(tracks, [{ ...target, yNm: 10 - 5 / 3600 * 5 + 0.0001 }], 5);
    tracks = updateArpaTracks(tracks, [{ ...target, yNm: 10 - 5 / 3600 * 10 - 0.0001 }], 10);
    expect(tracks.T1.estimatedSpeedKn).toBeCloseTo(5, 1);
  });

  it("calculates CPA/TCPA from estimated velocity and own-ship velocity", () => {
    let tracks = { T1: acquireArpaTarget(target, 0) };
    tracks = updateArpaTracks(tracks, [{ ...target, yNm: 2 - 5 / 3600 * 5 }], 5);
    const solution = calculateArpaSolution(tracks.T1, { xNm: 0, yNm: 2 - 5 / 3600 * 5 }, { ...own, yNm: 10 * 5 / 3600 });
    expect(solution.tcpaMin).toBeCloseTo(8 - 5 / 60);
    expect(solution.dcpaNm).toBeCloseTo(0);
  });

  it("marks a contact lost after the timeout when measurements disappear", () => {
    let tracks = { T1: acquireArpaTarget(target, 0) };
    tracks = updateArpaTracks(tracks, [], 16);
    expect(tracks.T1.status).toBe("lost");
  });

  it("does not append a measurement before the sampling interval", () => {
    const tracks = { T1: acquireArpaTarget(target, 0) };
    const next = updateArpaTracks(tracks, [target], 4.9);
    expect(next).toBe(tracks);
  });

  it("rejects invalid timing configuration", () => {
    const tracks = { T1: acquireArpaTarget(target, 0) };
    expect(() => updateArpaTracks(tracks, [target], 5, 0)).toThrow(RangeError);
  });
});
