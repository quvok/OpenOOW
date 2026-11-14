import { describe, expect, it } from "vitest";
import type { VesselState } from "../src/core/navigation";
import { DEFAULT_RADAR_CONFIG, isRadarScanDue, measureRadarContacts, type RadarMeasurementConfig } from "../src/core/radarMeasurements";

const own: VesselState = { id: "OWN", xNm: 0, yNm: 0, courseDeg: 0, speedKn: 0 };
const target: VesselState = { id: "T1", xNm: 0, yNm: 2, courseDeg: 180, speedKn: 5 };

describe("radar measurement model", () => {
  it("measures range and true bearing in a documented East/North frame", () => {
    const config = { ...DEFAULT_RADAR_CONFIG, rangeErrorNm: 0, bearingErrorDeg: 0, dropoutEveryScans: 0 };
    const [measurement] = measureRadarContacts(own, [target], 2.5, 1, config);
    expect(measurement.rangeNm).toBeCloseTo(2);
    expect(measurement.bearingDeg).toBeCloseTo(0);
    expect(measurement.xNm).toBeCloseTo(0);
    expect(measurement.yNm).toBeCloseTo(2);
  });

  it("applies bounded deterministic range and bearing errors", () => {
    const config: RadarMeasurementConfig = { ...DEFAULT_RADAR_CONFIG, dropoutEveryScans: 0 };
    const eastTarget = { ...target, xNm: 2, yNm: 0 };
    const first = measureRadarContacts(own, [eastTarget], 2.5, 4, config)[0];
    const repeated = measureRadarContacts(own, [eastTarget], 2.5, 4, config)[0];
    expect(repeated).toEqual(first);
    expect(Math.abs(first.rangeNm - 2)).toBeLessThanOrEqual(config.rangeErrorNm);
    expect(Math.abs(first.bearingDeg - 90)).toBeLessThanOrEqual(config.bearingErrorDeg);
  });

  it("omits contacts outside the configured radar range", () => {
    const config = { ...DEFAULT_RADAR_CONFIG, maximumRangeNm: 1, dropoutEveryScans: 0 };
    expect(measureRadarContacts(own, [target], 2.5, 1, config)).toHaveLength(0);
  });

  it("produces deterministic periodic scan dropouts", () => {
    const config = { ...DEFAULT_RADAR_CONFIG, rangeErrorNm: 0, bearingErrorDeg: 0, dropoutEveryScans: 5 };
    const missed = Array.from({ length: 20 }, (_, scan) =>
      measureRadarContacts(own, [target], scan * 2.5, scan, config).length === 0);
    expect(missed.filter(Boolean).length).toBe(4);
    expect(missed).toEqual(Array.from({ length: 20 }, (_, scan) =>
      measureRadarContacts(own, [target], scan * 2.5, scan, config).length === 0));
  });

  it("uses a fixed scan interval and rejects time reversal", () => {
    expect(isRadarScanDue(2.49, { lastScanSeconds: 0, scanNumber: 0 })).toBe(false);
    expect(isRadarScanDue(2.5, { lastScanSeconds: 0, scanNumber: 0 })).toBe(true);
    expect(() => isRadarScanDue(-1, { lastScanSeconds: 0, scanNumber: 0 })).toThrow(RangeError);
  });
});
