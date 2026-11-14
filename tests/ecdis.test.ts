import { describe, expect, it } from "vitest";
import {
  assessRoute, bearingDeg, buildRouteLegs, calculateActiveLegNavigation, calculateCrossTrackError, calculateWheelOverDistanceNm, classifyDepth, resolveActiveLegIndex,
  chartedDepthAt, distanceNm, formatCoordinate, fromGeographicPosition, importGeoJsonChart, pointInPolygon, toGeographicPosition,
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


  it("preserves polygon holes and excludes them from depth coverage", () => {
    const polygon = (ring: Array<[number, number]>) => ring.map(([east, north]) => geo(east, north));
    const imported = importGeoJsonChart({
      type: "FeatureCollection",
      features: [{
        type: "Feature", id: "depth-with-hole",
        properties: { layer: "DEPARE", DRVAL1: 18 },
        geometry: { type: "Polygon", coordinates: [
          polygon([[-2, -2], [2, -2], [2, 2], [-2, 2], [-2, -2]]),
          polygon([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [-0.5, -0.5]]),
        ] },
      }],
    }, origin);
    expect(imported.areas[0].holes).toHaveLength(1);
    expect(chartedDepthAt({ eastNm: 1, northNm: 1 }, imported.areas)).toBe(18);
    expect(chartedDepthAt({ eastNm: 0, northNm: 0 }, imported.areas)).toBeNull();
    const routeAcrossHole = assessRoute([
      { id: "a", name: "A", eastNm: -1, northNm: 0 },
      { id: "b", name: "B", eastNm: 1, northNm: 0 },
    ], imported.areas, [], 10, 0.02);
    expect(routeAcrossHole.safe).toBe(false);
    expect(routeAcrossHole.unchartedIntersections.length).toBeGreaterThan(0);
  });

  it("preserves holes in MultiPolygon parts independently", () => {
    const polygon = (ring: Array<[number, number]>) => ring.map(([east, north]) => geo(east, north));
    const imported = importGeoJsonChart({
      type: "FeatureCollection",
      features: [{
        type: "Feature", id: "multi",
        properties: { layer: "LNDARE" },
        geometry: { type: "MultiPolygon", coordinates: [
          [
            polygon([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]),
            polygon([[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]]),
          ],
          [polygon([[3, 0], [5, 0], [5, 2], [3, 2], [3, 0]])],
        ] },
      }],
    }, origin);
    expect(imported.areas).toHaveLength(2);
    expect(imported.areas[0].holes).toHaveLength(1);
    expect(imported.areas[1].holes).toBeUndefined();
    expect(chartedDepthAt({ eastNm: 1, northNm: 1 }, imported.areas)).toBeNull();
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

describe("ECDIS geographic route exchange", () => {
  it("round-trips local positions through geographic coordinates", () => {
    const origin = { latitudeDeg: 43.1, longitudeDeg: 131.9 };
    const local = { eastNm: 4.25, northNm: -2.75 };
    const geographic = toGeographicPosition(local, origin);
    const restored = fromGeographicPosition(geographic, origin);
    expect(restored.eastNm).toBeCloseTo(local.eastNm, 5);
    expect(restored.northNm).toBeCloseTo(local.northNm, 5);
  });
});


describe("ECDIS GeoJSON chart ingestion", () => {
  const origin = { latitudeDeg: 43, longitudeDeg: 132 };
  const geo = (east: number, north: number) => {
    const latitude = origin.latitudeDeg + north / 60;
    const longitude = origin.longitudeDeg + east / (60 * Math.cos(origin.latitudeDeg * Math.PI / 180));
    return [longitude, latitude];
  };

  it("imports charted depth areas, land, contours, soundings and hazards", () => {
    const document = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", id: "dep-1", properties: { layer: "DEPARE", DRVAL1: 24, OBJNAM: "Deep water" },
          geometry: { type: "Polygon", coordinates: [[geo(-1,-1), geo(1,-1), geo(1,1), geo(-1,1), geo(-1,-1)]] } },
        { type: "Feature", id: "land-1", properties: { layer: "LNDARE", name: "Island" },
          geometry: { type: "Polygon", coordinates: [[geo(2,2), geo(3,2), geo(3,3), geo(2,3), geo(2,2)]] } },
        { type: "Feature", id: "contour-1", properties: { layer: "DEPCNT", VALDCO: 10 },
          geometry: { type: "LineString", coordinates: [geo(-2,0), geo(2,0)] } },
        { type: "Feature", id: "sounding-1", properties: { layer: "SOUNDG", VALSOU: 8.4 },
          geometry: { type: "Point", coordinates: geo(0.2,0.2) } },
        { type: "Feature", id: "sounding-3d", properties: { layer: "SOUNDG" },
          geometry: { type: "Point", coordinates: [...geo(0.3,0.3), 12.6] } },
        { type: "Feature", id: "rock-1", properties: { layer: "UWTROC", name: "Rock" },
          geometry: { type: "Point", coordinates: geo(0.5,0.5) } },
      ],
    };
    const chart = importGeoJsonChart(document, origin, "test chart");
    expect(chart.featureCount).toBe(6);
    expect(chart.areas.map((area) => area.kind)).toEqual(["charted", "land"]);
    expect(chart.areas[0].depthM).toBe(24);
    expect(chart.contours[0].depthM).toBe(10);
    expect(chart.soundings[0].depthM).toBe(8.4);
    expect(chart.soundings[1].depthM).toBe(12.6);
    expect(chart.hazards[0].name).toBe("Rock");
    expect(chart.soundings[0].position.eastNm).toBeCloseTo(0.2, 4);
  });

  it("rejects non-FeatureCollection input and unsupported empty charts", () => {
    expect(() => importGeoJsonChart({ type: "Feature", geometry: null }, origin)).toThrow("FeatureCollection");
    expect(() => importGeoJsonChart({ type: "FeatureCollection", features: [] }, origin)).toThrow("поддерживаемые объекты");
  });
});
