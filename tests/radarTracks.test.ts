import { describe, expect, it } from "vitest";
import { createRadarTrackHistory, recordRadarTracks } from "../src/core/radarTracks";
import type { VesselState } from "../src/core/navigation";

const target: VesselState = { id: "T1", xNm: 1, yNm: 2, courseDeg: 90, speedKn: 5 };

describe("radar track history", () => {
  it("starts each contact with its initial position", () => {
    const history = createRadarTrackHistory([target]);
    expect(history.T1).toEqual([{ xNm: 1, yNm: 2, timeSeconds: 0 }]);
  });

  it("records a new position only after the sampling interval", () => {
    const initial = createRadarTrackHistory([target]);
    const moved = { ...target, xNm: 1.1 };
    const early = recordRadarTracks(initial, [moved], 4.9);
    expect(early).toBe(initial);
    const due = recordRadarTracks(early, [moved], 5);
    expect(due.T1).toHaveLength(2);
    expect(due.T1[1]).toEqual({ xNm: 1.1, yNm: 2, timeSeconds: 5 });
  });

  it("retains only the newest configured number of samples", () => {
    let history = createRadarTrackHistory([target]);
    for (let time = 5; time <= 30; time += 5) {
      history = recordRadarTracks(history, [{ ...target, xNm: 1 + time / 100 }], time, 5, 4);
    }
    expect(history.T1).toHaveLength(4);
    expect(history.T1[0].timeSeconds).toBe(15);
    expect(history.T1[3].timeSeconds).toBe(30);
  });

  it("keeps histories for multiple contacts independent", () => {
    const second = { ...target, id: "T2", xNm: -1 };
    const initial = createRadarTrackHistory([target, second]);
    const next = recordRadarTracks(initial, [{ ...target, xNm: 2 }], 5);
    expect(next.T1).toHaveLength(2);
    expect(next.T2).toHaveLength(1);
  });

  it("rejects invalid sampling settings", () => {
    const history = createRadarTrackHistory([target]);
    expect(() => recordRadarTracks(history, [target], 5, 0)).toThrow(RangeError);
    expect(() => recordRadarTracks(history, [target], 5, 5, 1)).toThrow(RangeError);
  });
});
