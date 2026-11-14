import { describe, expect, it } from "vitest";
import type { VesselState } from "../src/core/navigation";
import { DEFAULT_RADAR_CONFIG, isRadarScanDue, measureRadarContacts } from "../src/core/radarMeasurements";

const own: VesselState = { id: "OWN", xNm: 0, yNm: 0, courseDeg: 0, speedKn: 0 };
const targets: VesselState[] = [
  { id: "T1", xNm: 0, yNm: 2, courseDeg: 180, speedKn: 5 },
  { id: "T2", xNm: 1.5, yNm: 0, courseDeg: 270, speedKn: 4 },
];

describe("radar measurement model", () => {
  it("uses exact range and true bearing in clean-echo mode", () => {
    const [north, east] = measureRadarContacts(own, targets, 2.5, 1);
    expect(north.rangeNm).toBe(2);
    expect(north.bearingDeg).toBe(0);
    expect(north.xNm).toBe(0);
    expect(north.yNm).toBe(2);
    expect(east.rangeNm).toBe(1.5);
    expect(east.bearingDeg).toBe(90);
  });

  it("has no artificial range error, bearing error, or deterministic dropouts by default", () => {
    expect(DEFAULT_RADAR_CONFIG.rangeErrorNm).toBe(0);
    expect(DEFAULT_RADAR_CONFIG.bearingErrorDeg).toBe(0);
    expect(DEFAULT_RADAR_CONFIG.dropoutEveryScans).toBe(0);
    for (let scan = 0; scan < 100; scan += 1) {
      expect(measureRadarContacts(own, targets, scan * 2.5, scan)).toHaveLength(2);
    }
  });

  it("still excludes contacts outside the configured radar range", () => {
    expect(measureRadarContacts(own, targets, 2.5, 1, {
      ...DEFAULT_RADAR_CONFIG,
      maximumRangeNm: 1,
    })).toHaveLength(0);
  });

  it("uses a fixed scan interval and rejects time reversal", () => {
    expect(isRadarScanDue(2.49, { lastScanSeconds: 0, scanNumber: 0 })).toBe(false);
    expect(isRadarScanDue(2.5, { lastScanSeconds: 0, scanNumber: 0 })).toBe(true);
    expect(() => isRadarScanDue(-1, { lastScanSeconds: 0, scanNumber: 0 })).toThrow(RangeError);
  });
});
