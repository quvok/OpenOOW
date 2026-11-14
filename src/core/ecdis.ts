export interface LocalPosition {
  eastNm: number;
  northNm: number;
}

export interface GeoOrigin {
  latitudeDeg: number;
  longitudeDeg: number;
}

export interface GeographicPosition extends GeoOrigin {}

export interface RouteWaypoint extends LocalPosition {
  id: string;
  name: string;
}

export interface ChartArea {
  id: string;
  name: string;
  kind: "land" | "shallow" | "charted";
  depthM?: number;
  polygon: LocalPosition[];
  /** Interior rings (holes) from GeoJSON Polygon geometry. */
  holes?: LocalPosition[][];
}

export interface ChartHazard {
  id: string;
  name: string;
  position: LocalPosition;
  radiusNm: number;
}

export interface RouteLeg {
  from: RouteWaypoint;
  to: RouteWaypoint;
  distanceNm: number;
  bearingDeg: number;
}

export interface CrossTrackResult {
  distanceNm: number;
  signedDistanceNm: number;
  segmentIndex: number;
  alongTrackNm: number;
  nearestPoint: LocalPosition;
  bearingDeg: number;
}

export interface RouteAssessment {
  safe: boolean;
  totalDistanceNm: number;
  minimumChartedDepthM: number | null;
  requiredDepthM: number;
  landIntersections: string[];
  shallowWaterIntersections: string[];
  hazardIntersections: string[];
  unchartedIntersections: string[];
  warnings: string[];
}

const EARTH_RADIUS_NM = 3440.065;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export function normalizeLongitude(longitudeDeg: number): number {
  return ((longitudeDeg + 540) % 360) - 180;
}

export function toGeographicPosition(position: LocalPosition, origin: GeoOrigin): GeographicPosition {
  const latitudeDeg = origin.latitudeDeg + (position.northNm / 60);
  const cosine = Math.max(0.01, Math.cos(origin.latitudeDeg * DEG_TO_RAD));
  const longitudeDeg = normalizeLongitude(origin.longitudeDeg + position.eastNm / (60 * cosine));
  return { latitudeDeg, longitudeDeg };
}

export function formatCoordinate(value: number, latitude: boolean): string {
  const hemisphere = latitude ? (value < 0 ? "S" : "N") : (value < 0 ? "W" : "E");
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutes = (absolute - degrees) * 60;
  return String(degrees).padStart(latitude ? 2 : 3, "0") + "° " + minutes.toFixed(3).padStart(6, "0") + "' " + hemisphere;
}

export function distanceNm(a: LocalPosition, b: LocalPosition): number {
  return Math.hypot(b.eastNm - a.eastNm, b.northNm - a.northNm);
}

export function bearingDeg(a: LocalPosition, b: LocalPosition): number {
  return (Math.atan2(b.eastNm - a.eastNm, b.northNm - a.northNm) * RAD_TO_DEG + 360) % 360;
}

export function buildRouteLegs(route: RouteWaypoint[]): RouteLeg[] {
  return route.slice(1).map((to, index) => {
    const from = route[index];
    return { from, to, distanceNm: distanceNm(from, to), bearingDeg: bearingDeg(from, to) };
  });
}

export function totalRouteDistanceNm(route: RouteWaypoint[]): number {
  return buildRouteLegs(route).reduce((sum, leg) => sum + leg.distanceNm, 0);
}

export function calculateCrossTrackError(route: RouteWaypoint[], position: LocalPosition): CrossTrackResult | null {
  const legs = buildRouteLegs(route);
  if (!legs.length) return null;
  let best: CrossTrackResult | null = null;
  let travelledBefore = 0;
  for (let index = 0; index < legs.length; index += 1) {
    const leg = legs[index];
    const dx = leg.to.eastNm - leg.from.eastNm;
    const dy = leg.to.northNm - leg.from.northNm;
    const lengthSquared = dx * dx + dy * dy;
    const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
      ((position.eastNm - leg.from.eastNm) * dx + (position.northNm - leg.from.northNm) * dy) / lengthSquared));
    const nearestPoint = { eastNm: leg.from.eastNm + fraction * dx, northNm: leg.from.northNm + fraction * dy };
    const eastOffset = position.eastNm - nearestPoint.eastNm;
    const northOffset = position.northNm - nearestPoint.northNm;
    const distance = Math.hypot(eastOffset, northOffset);
    const cross = dx * (position.northNm - leg.from.northNm) - dy * (position.eastNm - leg.from.eastNm);
    const signedDistanceNm = Math.sign(cross) * distance;
    if (!best || distance < best.distanceNm) {
      best = {
        distanceNm: distance,
        signedDistanceNm,
        segmentIndex: index,
        alongTrackNm: travelledBefore + fraction * leg.distanceNm,
        nearestPoint,
        bearingDeg: leg.bearingDeg,
      };
    }
    travelledBefore += leg.distanceNm;
  }
  return best;
}

export function pointInPolygon(point: LocalPosition, polygon: LocalPosition[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects = ((a.northNm > point.northNm) !== (b.northNm > point.northNm)) &&
      (point.eastNm < (b.eastNm - a.eastNm) * (point.northNm - a.northNm) /
        ((b.northNm - a.northNm) || Number.EPSILON) + a.eastNm);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInChartArea(point: LocalPosition, area: ChartArea): boolean {
  return pointInPolygon(point, area.polygon) &&
    !(area.holes ?? []).some((ring) => pointInPolygon(point, ring));
}

export function chartedDepthAt(position: LocalPosition, areas: ChartArea[], defaultDepthM: number | null = null): number | null {
  if (areas.some((area) => area.kind === "land" && pointInChartArea(position, area))) return null;
  const containing = areas.filter((area) =>
    (area.kind === "charted" || area.kind === "shallow") && pointInChartArea(position, area));
  if (!containing.length) return defaultDepthM;
  return containing.reduce((depth, area) => Math.min(depth, area.depthM ?? defaultDepthM ?? 40), Infinity);
}

export function assessRoute(
  route: RouteWaypoint[],
  areas: ChartArea[],
  hazards: ChartHazard[],
  requiredDepthM: number,
  sampleStepNm = 0.05,
): RouteAssessment {
  const landIntersections = new Set<string>();
  const shallowWaterIntersections = new Set<string>();
  const hazardIntersections = new Set<string>();
  const unchartedIntersections = new Set<string>();
  const legs = buildRouteLegs(route);
  let minimumChartedDepthM: number | null = null;
  for (const leg of legs) {
    const samples = Math.max(1, Math.ceil(leg.distanceNm / Math.max(0.01, sampleStepNm)));
    for (let i = 0; i <= samples; i += 1) {
      const fraction = i / samples;
      const point = {
        eastNm: leg.from.eastNm + (leg.to.eastNm - leg.from.eastNm) * fraction,
        northNm: leg.from.northNm + (leg.to.northNm - leg.from.northNm) * fraction,
      };
      let isLand = false;
      let hasDepthCoverage = false;
      for (const area of areas) {
        if (!pointInChartArea(point, area)) continue;
        if (area.kind === "land") {
          landIntersections.add(area.name);
          isLand = true;
        } else {
          hasDepthCoverage = true;
          const depth = area.depthM ?? 40;
          minimumChartedDepthM = minimumChartedDepthM === null ? depth : Math.min(minimumChartedDepthM, depth);
          if (depth < requiredDepthM) shallowWaterIntersections.add(area.name);
        }
      }
      if (!isLand && !hasDepthCoverage) unchartedIntersections.add("Участок без данных о глубинах");
      for (const hazard of hazards) {
        if (distanceNm(point, hazard.position) <= hazard.radiusNm) hazardIntersections.add(hazard.name);
      }
    }
  }
  const warnings: string[] = [];
  if (route.length < 2) warnings.push("Для проверки маршрута требуется не менее двух маршрутных точек.");
  if (landIntersections.size) warnings.push("Маршрут пересекает сушу: " + [...landIntersections].join(", "));
  if (shallowWaterIntersections.size) warnings.push("Недостаточная картографическая глубина: " + [...shallowWaterIntersections].join(", "));
  if (hazardIntersections.size) warnings.push("Маршрут проходит вблизи навигационных опасностей: " + [...hazardIntersections].join(", "));
  if (unchartedIntersections.size) warnings.push("Нет данных о глубинах: маршрут проходит по некартографированному участку.");
  return {
    safe: route.length >= 2 && landIntersections.size === 0 && shallowWaterIntersections.size === 0 && hazardIntersections.size === 0 && unchartedIntersections.size === 0,
    totalDistanceNm: totalRouteDistanceNm(route),
    minimumChartedDepthM,
    requiredDepthM,
    landIntersections: [...landIntersections],
    shallowWaterIntersections: [...shallowWaterIntersections],
    hazardIntersections: [...hazardIntersections],
    unchartedIntersections: [...unchartedIntersections],
    warnings,
  };
}

export const TRAINING_CHART_AREAS: ChartArea[] = [
  { id: "charted-water", name: "Картографированная акватория (учебная)", kind: "charted", depthM: 40, polygon: [
    { eastNm: -7.1, northNm: -9 }, { eastNm: 7.1, northNm: -9 },
    { eastNm: 7.1, northNm: 9 }, { eastNm: -7.1, northNm: 9 },
  ] },
  { id: "west-land", name: "Западный берег", kind: "land", polygon: [
    { eastNm: -12, northNm: -9 }, { eastNm: -12, northNm: 9 }, { eastNm: -8.8, northNm: 9 },
    { eastNm: -7.7, northNm: 6 }, { eastNm: -8.3, northNm: 3 }, { eastNm: -7.2, northNm: 0 },
    { eastNm: -8.1, northNm: -3 }, { eastNm: -7.5, northNm: -9 },
  ] },
  { id: "east-land", name: "Восточный берег", kind: "land", polygon: [
    { eastNm: 12, northNm: -9 }, { eastNm: 12, northNm: 9 }, { eastNm: 8.8, northNm: 9 },
    { eastNm: 7.7, northNm: 6 }, { eastNm: 8.3, northNm: 3 }, { eastNm: 7.2, northNm: 0 },
    { eastNm: 8.1, northNm: -3 }, { eastNm: 7.5, northNm: -9 },
  ] },
  { id: "shoal-north", name: "Северная банка", kind: "shallow", depthM: 6.5, polygon: [
    { eastNm: -3.2, northNm: 3.0 }, { eastNm: -1.0, northNm: 3.4 },
    { eastNm: 0.2, northNm: 2.2 }, { eastNm: -1.4, northNm: 1.4 },
    { eastNm: -3.0, northNm: 1.8 },
  ] },
  { id: "shoal-south", name: "Южная отмель", kind: "shallow", depthM: 8.0, polygon: [
    { eastNm: 2.2, northNm: -3.4 }, { eastNm: 4.5, northNm: -3.0 },
    { eastNm: 4.1, northNm: -1.5 }, { eastNm: 2.0, northNm: -1.8 },
  ] },
  { id: "deep-water", name: "Глубоководный участок", kind: "shallow", depthM: 18, polygon: [
    { eastNm: -5.5, northNm: -6.5 }, { eastNm: 5.5, northNm: -6.5 },
    { eastNm: 5.5, northNm: -5.5 }, { eastNm: -5.5, northNm: -5.5 },
  ] },
];

export const TRAINING_CHART_HAZARDS: ChartHazard[] = [
  { id: "rock-north", name: "Изолированная опасность N-1", position: { eastNm: 1.4, northNm: 4.0 }, radiusNm: 0.28 },
  { id: "wreck-east", name: "Затонувший объект E-2", position: { eastNm: 5.4, northNm: 1.2 }, radiusNm: 0.35 },
  { id: "rock-south", name: "Камень S-3", position: { eastNm: -4.8, northNm: -4.0 }, radiusNm: 0.22 },
];


export interface ActiveLegNavigation {
  activeLegIndex: number;
  from: RouteWaypoint;
  to: RouteWaypoint;
  distanceToWaypointNm: number;
  bearingToWaypointDeg: number;
  crossTrackNm: number;
  alongTrackNm: number;
  legLengthNm: number;
  remainingRouteNm: number;
  passedWaypoint: boolean;
}

export function calculateActiveLegNavigation(
  route: RouteWaypoint[],
  position: LocalPosition,
  activeLegIndex: number,
): ActiveLegNavigation | null {
  const legs = buildRouteLegs(route);
  if (!legs.length) return null;
  const index = Math.max(0, Math.min(legs.length - 1, Math.floor(activeLegIndex)));
  const leg = legs[index];
  const dx = leg.to.eastNm - leg.from.eastNm;
  const dy = leg.to.northNm - leg.from.northNm;
  const lengthSquared = dx * dx + dy * dy;
  const length = Math.sqrt(lengthSquared);
  if (length < 1e-9) return null;
  const alongTrackNm = ((position.eastNm - leg.from.eastNm) * dx +
    (position.northNm - leg.from.northNm) * dy) / length;
  const cross = dx * (position.northNm - leg.from.northNm) -
    dy * (position.eastNm - leg.from.eastNm);
  const crossTrackNm = -cross / length;
  const passedWaypoint = alongTrackNm >= length;
  const distanceToWaypointNm = distanceNm(position, leg.to);
  const remainingRouteNm = distanceToWaypointNm +
    legs.slice(index + 1).reduce((sum, next) => sum + next.distanceNm, 0);
  return {
    activeLegIndex: index,
    from: leg.from,
    to: leg.to,
    distanceToWaypointNm,
    bearingToWaypointDeg: bearingDeg(position, leg.to),
    crossTrackNm,
    alongTrackNm,
    legLengthNm: length,
    remainingRouteNm,
    passedWaypoint,
  };
}

export function resolveActiveLegIndex(
  route: RouteWaypoint[],
  position: LocalPosition,
  currentIndex: number,
  arrivalRadiusNm = 0.05,
): number {
  const legs = buildRouteLegs(route);
  if (!legs.length) return 0;
  let index = Math.max(0, Math.min(legs.length - 1, Math.floor(currentIndex)));
  while (index < legs.length - 1) {
    const navigation = calculateActiveLegNavigation(route, position, index);
    if (!navigation) break;
    if (navigation.distanceToWaypointNm <= arrivalRadiusNm || navigation.passedWaypoint) index += 1;
    else break;
  }
  return index;
}

export function calculateWheelOverDistanceNm(speedKn: number, rotDegPerMin: number, courseChangeDeg: number): number | null {
  if (!Number.isFinite(speedKn) || !Number.isFinite(rotDegPerMin) ||
      !Number.isFinite(courseChangeDeg) || speedKn <= 0 || rotDegPerMin <= 0) return null;
  const boundedChange = Math.min(179, Math.abs(courseChangeDeg));
  if (boundedChange < 0.1) return 0;
  const turnRadiusNm = speedKn * 0.9549296586 / rotDegPerMin;
  return turnRadiusNm * Math.tan(boundedChange * Math.PI / 360);
}

export interface EcdisSafetySettings {
  safetyDepthM: number;
  safetyContourM: number;
  shallowContourM: number;
}

export function classifyDepth(
  depthM: number | null,
  settings: EcdisSafetySettings,
): "unknown" | "unsafe" | "safety" | "shallow" | "deep" {
  if (depthM === null || !Number.isFinite(depthM)) return "unknown";
  if (depthM < settings.safetyDepthM) return "unsafe";
  if (depthM < settings.safetyContourM) return "safety";
  if (depthM < settings.shallowContourM) return "shallow";
  return "deep";
}


export function fromGeographicPosition(position: GeoOrigin, origin: GeoOrigin): LocalPosition {
  const northNm = (position.latitudeDeg - origin.latitudeDeg) * 60;
  const originLatitudeRad = origin.latitudeDeg * DEG_TO_RAD;
  const eastNm = normalizeLongitude(position.longitudeDeg - origin.longitudeDeg) * 60 *
    Math.max(0.01, Math.cos(originLatitudeRad));
  return { eastNm, northNm };
}


export interface ChartContour {
  id: string;
  depthM: number;
  points: LocalPosition[];
}

export interface ChartSounding {
  id: string;
  depthM: number;
  position: LocalPosition;
}

export interface ImportedChartData {
  name: string;
  areas: ChartArea[];
  hazards: ChartHazard[];
  contours: ChartContour[];
  soundings: ChartSounding[];
  featureCount: number;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function numericProperty(properties: JsonRecord, names: string[]): number | null {
  for (const name of names) {
    const value = properties[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function stringProperty(properties: JsonRecord, names: string[]): string {
  for (const name of names) {
    const value = properties[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function geoJsonPosition(value: unknown, origin: GeoOrigin): LocalPosition | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const longitude = Number(value[0]);
  const latitude = Number(value[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) ||
      Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return null;
  return fromGeographicPosition({ longitudeDeg: longitude, latitudeDeg: latitude }, origin);
}

function geoJsonLine(value: unknown, origin: GeoOrigin): LocalPosition[] {
  if (!Array.isArray(value)) return [];
  return value.map((coordinate) => geoJsonPosition(coordinate, origin)).filter((point): point is LocalPosition => point !== null);
}

/**
 * Imports a GeoJSON FeatureCollection in WGS-84 coordinates.
 * S-57/S-101 ENC data must first be converted to GeoJSON by a chart tool such as GDAL/OGR;
 * this function does not parse binary ENC cells or perform S-52 portrayal.
 */
export function importGeoJsonChart(input: unknown, origin: GeoOrigin, chartName = "Imported GeoJSON"): ImportedChartData {
  const root = asRecord(input);
  if (root.type !== "FeatureCollection" || !Array.isArray(root.features)) {
    throw new Error("Ожидается GeoJSON FeatureCollection");
  }
  if (root.features.length > 100000) throw new Error("Слишком много объектов в файле карты (максимум 100 000)");
  const areas: ChartArea[] = [];
  const hazards: ChartHazard[] = [];
  const contours: ChartContour[] = [];
  const soundings: ChartSounding[] = [];
  let featureCount = 0;

  const addPolygon = (coordinates: unknown, id: string, name: string, kind: ChartArea["kind"], depthM?: number) => {
    if (!Array.isArray(coordinates) || !Array.isArray(coordinates[0])) return;
    const outer = geoJsonLine(coordinates[0], origin);
    if (outer.length < 3) return;
    const holes = coordinates.slice(1)
      .filter((ring): ring is unknown[] => Array.isArray(ring))
      .map((ring) => geoJsonLine(ring, origin))
      .filter((ring) => ring.length >= 3);
    areas.push({ id, name, kind, ...(depthM === undefined ? {} : { depthM }), polygon: outer, ...(holes.length ? { holes } : {}) });
  };

  for (let index = 0; index < root.features.length; index += 1) {
    const feature = asRecord(root.features[index]);
    if (feature.type !== "Feature") continue;
    const geometry = asRecord(feature.geometry);
    const properties = asRecord(feature.properties);
    const geometryType = geometry.type;
    const coordinates = geometry.coordinates;
    if (typeof geometryType !== "string" || coordinates === undefined || coordinates === null) continue;

    const layer = stringProperty(properties, ["layer", "LAYER", "acronym", "ACRONYM", "objl", "OBJL", "featureType", "kind", "type"]).toUpperCase();
    const name = stringProperty(properties, ["name", "NAME", "OBJNAM", "objectName", "label"]) || layer || "Chart feature " + (index + 1);
    const depth = numericProperty(properties, ["depthM", "DRVAL1", "VALSOU", "VALDCO", "DEPTH", "depth", "DRVAL2"]);
    const idValue = feature.id;
    const id = typeof idValue === "string" || typeof idValue === "number" ? String(idValue) : "chart-" + (index + 1);
    const explicitKind = stringProperty(properties, ["kind", "category"]).toLowerCase();
    const isLand = explicitKind === "land" || layer === "LNDARE" || layer === "COALNE" || layer.includes("LAND");
    const isDepthArea = explicitKind === "charted" || explicitKind === "shallow" || layer === "DEPARE" || layer.includes("DEPTH_AREA");
    const isContour = layer === "DEPCNT" || layer.includes("DEPTH_CONTOUR");
    const isSounding = layer === "SOUNDG" || layer.includes("SOUNDING");
    const isHazard = ["UWTROC", "WRECKS", "OBSTRN", "UnderwaterRock", "Wreck"].some((token) => layer.includes(token.toUpperCase()));

    if (geometryType === "Polygon") {
      if (isLand) addPolygon(coordinates, id, name, "land");
      else if (isDepthArea) {
        if (depth === null) continue;
        addPolygon(coordinates, id, name, depth < 10 ? "shallow" : "charted", depth);
      } else if (isHazard) {
        const ring = geoJsonLine(Array.isArray(coordinates) ? coordinates[0] : [], origin);
        if (ring.length) {
          const center = ring.reduce((sum, point) => ({ eastNm: sum.eastNm + point.eastNm / ring.length, northNm: sum.northNm + point.northNm / ring.length }), { eastNm: 0, northNm: 0 });
          hazards.push({ id, name, position: center, radiusNm: Math.max(0.05, ...ring.map((point) => distanceNm(point, center))) });
        }
      }
    } else if (geometryType === "MultiPolygon" && Array.isArray(coordinates)) {
      coordinates.forEach((polygon, part) => {
        if (isLand) addPolygon(polygon, id + "-" + part, name, "land");
        else if (isDepthArea && depth !== null) addPolygon(polygon, id + "-" + part, name, depth < 10 ? "shallow" : "charted", depth);
      });
    } else if (geometryType === "LineString") {
      const points = geoJsonLine(coordinates, origin);
      if (isContour && depth !== null && points.length >= 2) contours.push({ id, depthM: depth, points });
    } else if (geometryType === "MultiLineString" && isContour && depth !== null && Array.isArray(coordinates)) {
      coordinates.forEach((line, part) => {
        const points = geoJsonLine(line, origin);
        if (points.length >= 2) contours.push({ id: id + "-" + part, depthM: depth, points });
      });
    } else if (geometryType === "Point") {
      const position = geoJsonPosition(coordinates, origin);
      if (!position) continue;
      const pointDepth = Array.isArray(coordinates) && typeof coordinates[2] === "number" ? coordinates[2] : null;
      if (isSounding && (depth !== null || pointDepth !== null)) soundings.push({ id, depthM: depth ?? pointDepth ?? 0, position });
      else if (isHazard) hazards.push({ id, name, position, radiusNm: 0.08 });
    } else if (geometryType === "MultiPoint" && isSounding && Array.isArray(coordinates)) {
      coordinates.forEach((coordinate, part) => {
        const position = geoJsonPosition(coordinate, origin);
        const coordinateDepth = Array.isArray(coordinate) && typeof coordinate[2] === "number" ? coordinate[2] : null;
        const soundingDepth = depth ?? coordinateDepth;
        if (position && soundingDepth !== null) soundings.push({ id: id + "-" + part, depthM: soundingDepth, position });
      });
    }
    featureCount += 1;
  }

  if (!featureCount || (!areas.length && !hazards.length && !contours.length && !soundings.length)) {
    throw new Error("В GeoJSON не найдены поддерживаемые объекты карты");
  }
  return { name: chartName, areas, hazards, contours, soundings, featureCount };
}
