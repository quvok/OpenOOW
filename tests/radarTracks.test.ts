import { describe, expect, it } from "vitest";
import { createRadarTrackHistory, createRadarMeasurementTrackHistory, recordRadarMeasurementTracks, recordRadarTracks } from "../src/core/radarTracks";
import type { RadarMeasurement } from "../src/core/radarMeasurements";
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

  it("stores each sample relative to own ship at that exact time", () => {
    const initial = createRadarTrackHistory([target], 0, { xNm: 0.5, yNm: 1 });
    expect(initial.T1[0]).toMatchObject({ xNm: 0.5, yNm: 1 });
    const movedTarget = { ...target, xNm: 1.5, yNm: 2.5 };
    const next = recordRadarTracks(initial, [movedTarget], 5, 5, 120, { xNm: 1, yNm: 2 });
    expect(next.T1[1]).toMatchObject({ xNm: 0.5, yNm: 0.5 });
  });

  it("rejects invalid sampling settings", () => {
    const history = createRadarTrackHistory([target]);
    expect(() => recordRadarTracks(history, [target], 5, 0)).toThrow(RangeError);
    expect(() => recordRadarTracks(history, [target], 5, 5, 1)).toThrow(RangeError);
  });
});

describe("measured radar echo history", () => {
  const echo: RadarMeasurement = {
    id: "T1", xNm: 1.02, yNm: 2.01, rangeNm: 2.25,
    bearingDeg: 27, timeSeconds: 2.5, scanNumber: 1,
  };

  it("starts from measured coordinates relative to own ship", () => {
    const history = createRadarMeasurementTrackHistory([echo], { xNm: 0.5, yNm: 1 });
    expect(history.T1).toHaveLength(1);
    expect(history.T1[0].xNm).toBeCloseTo(0.52);
    expect(history.T1[0].yNm).toBeCloseTo(1.01);
    expect(history.T1[0].timeSeconds).toBe(2.5);
  });

  it("records only echoes present in a radar sweep", () => {
    const initial = createRadarMeasurementTrackHistory([echo], { xNm: 0, yNm: 0 });
    const second: RadarMeasurement = { ...echo, xNm: 1.1, timeSeconds: 5, scanNumber: 2 };
    const next = recordRadarMeasurementTracks(initial, [second], 240, { xNm: 0.1, yNm: 0 });
    expect(next.T1).toHaveLength(2);
    expect(next.T1[1]).toEqual({ xNm: 1, yNm: 2.01, timeSeconds: 5 });
    expect(next).not.toHaveProperty("T2");
  });

  it("does not fabricate a sample for a missing echo or duplicate scan", () => {
    const initial = createRadarMeasurementTrackHistory([echo], { xNm: 0, yNm: 0 });
    expect(recordRadarMeasurementTracks(initial, [], 240)).toBe(initial);
    expect(recordRadarMeasurementTracks(initial, [echo], 240)).toBe(initial);
  });

  it("bounds measured history to the newest samples", () => {
    let history = createRadarMeasurementTrackHistory([echo], { xNm: 0, yNm: 0 });
    for (let scan = 2; scan <= 7; scan += 1) {
      history = recordRadarMeasurementTracks(history, [{
        ...echo, timeSeconds: scan * 2.5, scanNumber: scan, xNm: scan,
      }], 4);
    }
    expect(history.T1).toHaveLength(4);
    expect(history.T1[0].timeSeconds).toBe(10);
    expect(history.T1[3].timeSeconds).toBe(17.5);
  });

  it("rejects invalid history bounds", () => {
    expect(() => recordRadarMeasurementTracks({}, [echo], 1)).toThrow(RangeError);
  });
});
