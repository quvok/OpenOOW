import { describe, expect, it } from "vitest";
import {
  assessRoute, bearingDeg, buildRouteLegs, calculateActiveLegNavigation, calculateCrossTrackError, calculateWheelOverDistanceNm, classifyDepth, resolveActiveLegIndex,
  chartedDepthAt, distanceNm, formatCoordinate, pointInPolygon, toGeographicPosition,
  type RouteWaypoint,
} from "../src/core/ecdis";

const route: RouteWaypoint[] = [
  { id: "A", name: "A", eastNm: 0, northNm: 0 },
  { id: "B", name: "B", eastNm: 0, northNm: 2 },
  { id: "C", name: "C", eastNm: 2, northNm: 2 },
];

describe("ECDIS navigation calculations", () => {
  it("calculates local nautical-mile distance and true bearing", () => {
    expect(distanceNm(route[0], route[1])).toBe(2);
    expect(bearingDeg(route[0], route[1])).toBe(0);
    expect(bearingDeg(route[1], route[2])).toBe(90);
  });

  it("builds route legs and total distance", () => {
    expect(buildRouteLegs(route)).toHaveLength(2);
    expect(buildRouteLegs(route)[1].distanceNm).toBe(2);
    expect(assessRoute(route, [], [], 10).totalDistanceNm).toBe(4);
  });

  it("calculates cross-track distance and nearest leg", () => {
    const result = calculateCrossTrackError(route, { eastNm: 0.5, northNm: 1 });
    expect(result?.segmentIndex).toBe(0);
    expect(result?.distanceNm).toBeCloseTo(0.5);
    expect(result?.signedDistanceNm).toBeCloseTo(-0.5);
  });

  it("returns null when route has fewer than two points", () => {
    expect(calculateCrossTrackError([route[0]], route[0])).toBeNull();
  });

  it("detects points inside chart polygons", () => {
    const polygon = [{ eastNm: 0, northNm: 0 }, { eastNm: 2, northNm: 0 }, { eastNm: 2, northNm: 2 }, { eastNm: 0, northNm: 2 }];
    expect(pointInPolygon({ eastNm: 1, northNm: 1 }, polygon)).toBe(true);
    expect(pointInPolygon({ eastNm: 3, northNm: 1 }, polygon)).toBe(false);
  });

  it("reads the shallowest charted depth under a position", () => {
    const areas = [{ id: "s", name: "shoal", kind: "shallow" as const, depthM: 5, polygon: [
      { eastNm: 0, northNm: 0 }, { eastNm: 2, northNm: 0 }, { eastNm: 2, northNm: 2 }, { eastNm: 0, northNm: 2 },
    ] }];
    expect(chartedDepthAt({ eastNm: 1, northNm: 1 }, areas)).toBe(5);
    expect(chartedDepthAt({ eastNm: 3, northNm: 1 }, areas)).toBeNull();
  });

  it("detects shallow water and isolated dangers along the planned route", () => {
    const areas = [{ id: "s", name: "shoal", kind: "shallow" as const, depthM: 6, polygon: [
      { eastNm: 1, northNm: -1 }, { eastNm: 2, northNm: -1 }, { eastNm: 2, northNm: 1 }, { eastNm: 1, northNm: 1 },
    ] }];
    const hazards = [{ id: "h", name: "wreck", position: { eastNm: 3, northNm: 0 }, radiusNm: 0.3 }];
    const result = assessRoute([
      { id: "a", name: "A", eastNm: 0, northNm: 0 },
      { id: "b", name: "B", eastNm: 4, northNm: 0 },
    ], areas, hazards, 8);
    expect(result.shallowWaterIntersections).toContain("shoal");
    expect(result.hazardIntersections).toContain("wreck");
    expect(result.safe).toBe(false);
  });

  it("accepts a clear route only when chart depth coverage exists", () => {
    const route = [
      { id: "a", name: "A", eastNm: 0, northNm: -2 },
      { id: "b", name: "B", eastNm: 2, northNm: -2 },
    ];
    const uncovered = assessRoute(route, [], [], 10);
    expect(uncovered.safe).toBe(false);
    expect(uncovered.unchartedIntersections.length).toBeGreaterThan(0);
    const charted = [{ id: "c", name: "charted water", kind: "charted" as const, depthM: 40, polygon: [
      { eastNm: -1, northNm: -3 }, { eastNm: 3, northNm: -3 },
      { eastNm: 3, northNm: -1 }, { eastNm: -1, northNm: -1 },
    ] }];
    const result = assessRoute(route, charted, [], 10);
    expect(result.safe).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.minimumChartedDepthM).toBe(40);
  });

  it("detects land intersections", () => {
    const land = [{ id: "l", name: "land", kind: "land" as const, polygon: [
      { eastNm: 1, northNm: -1 }, { eastNm: 2, northNm: -1 }, { eastNm: 2, northNm: 1 }, { eastNm: 1, northNm: 1 },
    ] }];
    expect(assessRoute([
      { id: "a", name: "A", eastNm: 0, northNm: 0 },
      { id: "b", name: "B", eastNm: 3, northNm: 0 },
    ], land, [], 8).landIntersections).toContain("land");
  });

  it("converts local east/north offsets to geographic coordinates", () => {
    const position = toGeographicPosition({ eastNm: 1, northNm: 1 }, { latitudeDeg: 0, longitudeDeg: 0 });
    expect(position.latitudeDeg).toBeCloseTo(1 / 60);
    expect(position.longitudeDeg).toBeCloseTo(1 / 60);
  });

  it("formats latitude and longitude with hemispheres", () => {
    expect(formatCoordinate(-43.1, true)).toContain("S");
    expect(formatCoordinate(131.9, false)).toContain("E");
  });
});


describe("ECDIS active route monitoring", () => {
  it("calculates XTE and DTW against the selected active leg, not the nearest route leg", () => {
    const result = calculateActiveLegNavigation(route, { eastNm: 0.5, northNm: 1 }, 0);
    expect(result?.distanceToWaypointNm).toBeCloseTo(Math.sqrt(1.25));
    expect(result?.crossTrackNm).toBeCloseTo(0.5);
    expect(result?.bearingToWaypointDeg).toBeCloseTo(333.4349, 3);
  });

  it("advances the active leg when the waypoint is reached or passed", () => {
    expect(resolveActiveLegIndex(route, { eastNm: 0, northNm: 2.01 }, 0)).toBe(1);
    expect(resolveActiveLegIndex(route, { eastNm: 0, northNm: 1 }, 0)).toBe(0);
  });

  it("calculates wheel-over distance from speed, ROT and course alteration", () => {
    expect(calculateWheelOverDistanceNm(12, 20, 90)).toBeCloseTo(0.57296, 4);
    expect(calculateWheelOverDistanceNm(0, 20, 90)).toBeNull();
  });

  it("classifies chart depths against configurable safety contours", () => {
    const settings = { safetyDepthM: 8, safetyContourM: 10, shallowContourM: 20 };
    expect(classifyDepth(null, settings)).toBe("unknown");
    expect(classifyDepth(6, settings)).toBe("unsafe");
    expect(classifyDepth(9, settings)).toBe("safety");
    expect(classifyDepth(15, settings)).toBe("shallow");
    expect(classifyDepth(30, settings)).toBe("deep");
  });
});
