import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import { Anchor, Map, RotateCcw, Trash2 } from "lucide-react";
import type { ShipDynamicsState } from "../core/shipDynamics";
import type { VesselState } from "../core/navigation";
import {
  assessRoute, bearingDeg, buildRouteLegs, calculateActiveLegNavigation, calculateWheelOverDistanceNm, chartedDepthAt,
  formatCoordinate, fromGeographicPosition, resolveActiveLegIndex, toGeographicPosition, TRAINING_CHART_AREAS,
  TRAINING_CHART_HAZARDS, type GeoOrigin, type RouteWaypoint,
} from "../core/ecdis";

interface Props {
  ship: ShipDynamicsState;
  targets: VesselState[];
}

const WIDTH = 1000;
const HEIGHT = 720;
const SCALE = 42;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;

function toScreen(eastNm: number, northNm: number) {
  return { x: CENTER_X + eastNm * SCALE, y: CENTER_Y - northNm * SCALE };
}

function polygonPoints(points: Array<{ eastNm: number; northNm: number }>) {
  return points.map((point) => {
    const screen = toScreen(point.eastNm, point.northNm);
    return screen.x + "," + screen.y;
  }).join(" ");
}

function makeWaypoint(index: number, eastNm: number, northNm: number): RouteWaypoint {
  return { id: "WP-" + String(index).padStart(2, "0"), name: "WP " + String(index).padStart(2, "0"), eastNm, northNm };
}

export default function EcdisModule({ ship, targets }: Props) {
  const [route, setRoute] = useState<RouteWaypoint[]>([]);
  const [routeStart, setRouteStart] = useState<{ eastNm: number; northNm: number } | null>(null);
  const [origin, setOrigin] = useState<GeoOrigin>({ latitudeDeg: 0, longitudeDeg: 0 });
  const [draftM, setDraftM] = useState(7.5);
  const [ukcM, setUkcM] = useState(1.5);
  const [xtdNm, setXtdNm] = useState(0.5);
  const [showDepths, setShowDepths] = useState(true);
  const [showHazards, setShowHazards] = useState(true);
  const [headUp, setHeadUp] = useState(false);
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(null);
  const [routeEdit, setRouteEdit] = useState(true);
  const [chartScale, setChartScale] = useState(1);
  const [activeLegIndex, setActiveLegIndex] = useState(0);
  const [arrivalRadiusNm, setArrivalRadiusNm] = useState(0.05);
  const [safetyDepthM, setSafetyDepthM] = useState(8);
  const [safetyContourM, setSafetyContourM] = useState(10);
  const [shallowContourM, setShallowContourM] = useState(20);
  const [plannedRotDegPerMin, setPlannedRotDegPerMin] = useState(20);
  const routeFileInput = useRef<HTMLInputElement>(null);

  const [statusMessage, setStatusMessage] = useState("Нажмите на карту, чтобы добавить первую маршрутную точку.");
  const ownPosition = { eastNm: ship.eastNm, northNm: ship.northNm };
  const requiredDepthM = draftM + ukcM;
  const monitoringRoute = useMemo(() => routeStart ? [{ id: "OWN-START", name: "OWN SHIP", ...routeStart }, ...route] : route, [route, routeStart]);
  useEffect(() => {
    setActiveLegIndex((current) => resolveActiveLegIndex(monitoringRoute, ownPosition, current, arrivalRadiusNm));
  }, [monitoringRoute, ship.eastNm, ship.northNm, arrivalRadiusNm]);
  useEffect(() => { setActiveLegIndex(0); }, [route.length, routeStart]);
  const activeNavigation = useMemo(() => calculateActiveLegNavigation(monitoringRoute, ownPosition, activeLegIndex), [monitoringRoute, activeLegIndex, ship.eastNm, ship.northNm]);
  const crossTrack = useMemo(() => {
    if (!activeNavigation) return null;
    const fraction = activeNavigation.alongTrackNm / Math.max(activeNavigation.legLengthNm, 1e-9);
    const nearestPoint = {
      eastNm: activeNavigation.from.eastNm + (activeNavigation.to.eastNm - activeNavigation.from.eastNm) * fraction,
      northNm: activeNavigation.from.northNm + (activeNavigation.to.northNm - activeNavigation.from.northNm) * fraction,
    };
    return { distanceNm: Math.abs(activeNavigation.crossTrackNm), signedDistanceNm: activeNavigation.crossTrackNm,
      segmentIndex: activeNavigation.activeLegIndex, alongTrackNm: activeNavigation.alongTrackNm, nearestPoint,
      bearingDeg: bearingDeg(activeNavigation.from, activeNavigation.to) };
  }, [activeNavigation]);
  const routeAssessment = useMemo(() => assessRoute(route, TRAINING_CHART_AREAS, TRAINING_CHART_HAZARDS, Math.max(requiredDepthM, safetyDepthM)), [route, requiredDepthM, safetyDepthM]);
  const legs = useMemo(() => buildRouteLegs(route), [route]);
  const ownDepth = chartedDepthAt(ownPosition, TRAINING_CHART_AREAS);
  const selectedWaypoint = route.find((point) => point.id === selectedWaypointId) ?? null;
  const distanceToNext = activeNavigation?.distanceToWaypointNm ?? null;
  const bearingToNext = activeNavigation?.bearingToWaypointDeg ?? null;
  const remainingDistance = activeNavigation?.remainingRouteNm ?? routeAssessment.totalDistanceNm;
  const etaMinutes = ship.speedKn > 0.1 ? remainingDistance / ship.speedKn * 60 : null;
  const geoOwn = toGeographicPosition(ownPosition, origin);
  const mapTransform = "translate(" + (CENTER_X - ship.eastNm * SCALE * chartScale) + " " + (CENTER_Y + ship.northNm * SCALE * chartScale) + ") scale(" + chartScale + ") translate(" + -CENTER_X + " " + -CENTER_Y + ")" + (headUp ? " rotate(" + -ship.headingDeg + " " + CENTER_X + " " + CENTER_Y + ")" : "");

  const addWaypoint = (event: MouseEvent<SVGSVGElement>) => {
    if (!routeEdit) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) * WIDTH / rect.width;
    const py = (event.clientY - rect.top) * HEIGHT / rect.height;
    const eastNm = ship.eastNm + (px - CENTER_X) / (SCALE * chartScale);
    const northNm = ship.northNm + (CENTER_Y - py) / (SCALE * chartScale);
    setRouteStart((current) => current ?? ownPosition);
    setRoute((current) => [...current, makeWaypoint(current.length + 1, Number(eastNm.toFixed(3)), Number(northNm.toFixed(3)))]);
    setActiveLegIndex(0);
    setStatusMessage("Маршрутная точка добавлена. Продолжайте прокладку или отключите режим редактирования.");
  };

  const removeLastWaypoint = () => {
    if (route.length <= 1) setRouteStart(null);
    setRoute((current) => current.slice(0, -1));
    setStatusMessage("Последняя маршрутная точка удалена.");
  };

  const clearRoute = () => {
    setRoute([]);
    setRouteStart(null);
    setActiveLegIndex(0);
    setSelectedWaypointId(null);
    setStatusMessage("Маршрут очищен.");
  };

  const updateWaypoint = (id: string, field: "eastNm" | "northNm", value: string) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    setRoute((current) => current.map((point) => point.id === id ? { ...point, [field]: Number(number.toFixed(3)) } : point));
  };

  const moveWaypoint = (id: string, offset: number) => {
    setRoute((current) => {
      const index = current.findIndex((point) => point.id === id);
      const destination = index + offset;
      if (index < 0 || destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next.map((point, i) => ({ ...point, id: "WP-" + String(i + 1).padStart(2, "0"), name: "WP " + String(i + 1).padStart(2, "0") }));
    });
  };

  const exportRouteGpx = () => {
    const points = route.map((point) => {
      const geo = toGeographicPosition(point, origin);
      const safeName = point.name.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("\'", "&apos;");
      return `    <rtept lat="${geo.latitudeDeg.toFixed(7)}" lon="${geo.longitudeDeg.toFixed(7)}"><name>${safeName}</name></rtept>`;
    }).join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="OpenOOW" xmlns="http://www.topografix.com/GPX/1/1"><rte><name>OpenOOW route</name>
${points}
</rte></gpx>`;
    const url = URL.createObjectURL(new Blob([xml], { type: "application/gpx+xml;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "openoow-route.gpx";
    anchor.click();
    URL.revokeObjectURL(url);
    setStatusMessage("Маршрут экспортирован в GPX.");
  };

  const importRouteGpx = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const xml = new DOMParser().parseFromString(await file.text(), "application/xml");
      if (xml.querySelector("parsererror")) throw new Error("Некорректный XML");
      const routePoints = Array.from(xml.getElementsByTagNameNS("*", "rtept"));
      const points = routePoints.length ? routePoints : Array.from(xml.getElementsByTagNameNS("*", "wpt"));
      if (!points.length) throw new Error("В GPX нет маршрутных точек");
      const imported = points.map((point, index) => {
        const lat = Number(point.getAttribute("lat"));
        const lon = Number(point.getAttribute("lon"));
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
          throw new Error("Некорректные координаты GPX");
        }
        const local = fromGeographicPosition({ latitudeDeg: lat, longitudeDeg: lon }, origin);
        return { ...makeWaypoint(index + 1, Number(local.eastNm.toFixed(3)), Number(local.northNm.toFixed(3))),
          name: point.getElementsByTagNameNS("*", "name")[0]?.textContent?.trim() || "WP " + String(index + 1).padStart(2, "0") };
      });
      setRouteStart(ownPosition);
      setRoute(imported);
      setActiveLegIndex(0);
      setSelectedWaypointId(null);
      setStatusMessage(`Импортировано маршрутных точек: ${imported.length}.`);
    } catch (error) {
      setStatusMessage("Ошибка импорта GPX: " + (error instanceof Error ? error.message : "неизвестная ошибка"));
    } finally {
      event.target.value = "";
    }
  };

  const updateOrigin = (field: keyof GeoOrigin, value: string) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    setOrigin((current) => ({ ...current, [field]: Math.max(field === "latitudeDeg" ? -89.9 : -180, Math.min(field === "latitudeDeg" ? 89.9 : 180, number)) }));
  };

  return <section className="ecdis-workspace">
    <div className="ecdis-toolbar">
      <div className="ecdis-chart-title"><Map size={17}/><div><b>ECDIS · ЭЛЕКТРОННАЯ КАРТА</b><small>TRAINING CHART · NORTH UP · LOCAL TANGENT PLANE</small></div></div>
      <div className="ecdis-toolbar-actions">
        <span className={routeAssessment.safe ? "ecdis-status safe" : route.length >= 2 ? "ecdis-status danger" : "ecdis-status idle"}>{route.length < 2 ? "ROUTE NOT PLANNED" : routeAssessment.safe ? "ROUTE CHECK OK" : "ROUTE HAZARD"}</span>
        <button type="button" className={routeEdit ? "ecdis-tool active" : "ecdis-tool"} onClick={() => setRouteEdit((value) => !value)}>{routeEdit ? "ЗАВЕРШИТЬ ПРОКЛАДКУ" : "РЕДАКТИРОВАТЬ МАРШРУТ"}</button>
      </div>
    </div>
    <div className="ecdis-layout">
      <section className="ecdis-chart-panel">
        <div className="ecdis-map-meta"><span>DISPLAY: OWN SHIP FOLLOW · {headUp ? "HEAD UP" : "NORTH UP"}</span><span>DEPTH UNITS: METRES</span><span>SCALE 1:{Math.round(50000 / chartScale).toLocaleString("ru-RU")}</span></div>
        <svg className="ecdis-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Учебная электронная навигационная карта" onClick={addWaypoint}>
          <defs>
            <pattern id="ecdis-grid" width={SCALE} height={SCALE} patternUnits="userSpaceOnUse">
              <path d={`M ${SCALE} 0 L 0 0 0 ${SCALE}`} fill="none" stroke="#31505a" strokeWidth="1"/>
            </pattern>
            <pattern id="ecdis-land-pattern" width="12" height="12" patternUnits="userSpaceOnUse">
              <path d="M0 12 L12 0" stroke="#6d7354" strokeWidth="1" opacity=".35"/>
            </pattern>
          </defs>
          <rect width={WIDTH} height={HEIGHT} fill="#071a22"/>
          <g transform={mapTransform}>
            <rect x="-10000" y="-10000" width="20000" height="20000" fill="url(#ecdis-grid)"/>
            {Array.from({ length: 25 }, (_, index) => index - 12).map((east) => <text key={"e"+east} x={CENTER_X + east * SCALE + 3} y="16" className="ecdis-grid-label">{east} E</text>)}
            {Array.from({ length: 18 }, (_, index) => index - 9).map((north) => <text key={"n"+north} x="4" y={CENTER_Y - north * SCALE - 3} className="ecdis-grid-label">{north} N</text>)}
            {TRAINING_CHART_AREAS.filter((area) => area.kind === "charted").map((area) => <g key={area.id}><polygon points={polygonPoints(area.polygon)} className="ecdis-charted-water"/><text x={toScreen(0,0).x+10} y={toScreen(0,0).y-12} className="ecdis-depth-label">{area.depthM?.toFixed(1)} m · CHARTED</text></g>)}
            {TRAINING_CHART_AREAS.filter((area) => area.kind === "land").map((area) => <g key={area.id}><polygon points={polygonPoints(area.polygon)} className="ecdis-land"/><polygon points={polygonPoints(area.polygon)} fill="url(#ecdis-land-pattern)"/></g>)}
            {showDepths && TRAINING_CHART_AREAS.filter((area) => area.kind === "shallow").map((area) => <g key={area.id}><polygon points={polygonPoints(area.polygon)} className={area.depthM !== undefined && area.depthM < safetyDepthM ? "ecdis-shallow ecdis-depth-danger" : area.depthM !== undefined && area.depthM < safetyContourM ? "ecdis-shallow ecdis-depth-safety" : "ecdis-shallow"}/><text x={toScreen(area.polygon[0].eastNm, area.polygon[0].northNm).x+8} y={toScreen(area.polygon[0].eastNm, area.polygon[0].northNm).y-6} className="ecdis-depth-label">{area.depthM?.toFixed(1)} m · {area.name}</text></g>)}
            {showHazards && TRAINING_CHART_HAZARDS.map((hazard) => { const point = toScreen(hazard.position.eastNm, hazard.position.northNm); return <g key={hazard.id}><circle cx={point.x} cy={point.y} r={hazard.radiusNm*SCALE} className="ecdis-hazard-zone"/><path d={`M ${point.x-8} ${point.y-8} L ${point.x+8} ${point.y+8} M ${point.x+8} ${point.y-8} L ${point.x-8} ${point.y+8}`} className="ecdis-hazard-mark"/><text x={point.x+12} y={point.y-10} className="ecdis-hazard-label">{hazard.name}</text></g>; })}
            {route.length > 1 && <polyline points={polygonPoints(route)} className="ecdis-route-halo"/>}
            {route.length > 1 && <polyline points={polygonPoints(route)} className="ecdis-route-line"/>}
            {activeNavigation && <line x1={toScreen(activeNavigation.from.eastNm,activeNavigation.from.northNm).x} y1={toScreen(activeNavigation.from.eastNm,activeNavigation.from.northNm).y} x2={toScreen(activeNavigation.to.eastNm,activeNavigation.to.northNm).x} y2={toScreen(activeNavigation.to.eastNm,activeNavigation.to.northNm).y} className="ecdis-active-leg"/>}
            {route.length > 2 && route.slice(1,-1).map((point,index) => {
              const incoming=bearingDeg(route[index],point);
              const outgoing=bearingDeg(point,route[index+2]);
              const delta=((outgoing-incoming+540)%360)-180;
              const distance=calculateWheelOverDistanceNm(ship.speedKn,plannedRotDegPerMin,delta);
              if (distance===null || distance<=0) return null;
              const wol={eastNm:point.eastNm-Math.sin(incoming*Math.PI/180)*distance,northNm:point.northNm-Math.cos(incoming*Math.PI/180)*distance};
              const p=toScreen(wol.eastNm,wol.northNm);
              return <g key={"wol-"+point.id} className="ecdis-wheel-over"><circle cx={p.x} cy={p.y} r="7"/><text x={p.x+9} y={p.y-7}>WOL</text></g>;
            })}
            {crossTrack && <circle cx={toScreen(crossTrack.nearestPoint.eastNm,crossTrack.nearestPoint.northNm).x} cy={toScreen(crossTrack.nearestPoint.eastNm,crossTrack.nearestPoint.northNm).y} r={xtdNm*SCALE} className="ecdis-xtd-limit"/>}
            {crossTrack && <line x1={toScreen(ownPosition.eastNm,ownPosition.northNm).x} y1={toScreen(ownPosition.eastNm,ownPosition.northNm).y} x2={toScreen(crossTrack.nearestPoint.eastNm,crossTrack.nearestPoint.northNm).x} y2={toScreen(crossTrack.nearestPoint.eastNm,crossTrack.nearestPoint.northNm).y} className="ecdis-xte-line"/>}
            {route.map((point,index) => { const p=toScreen(point.eastNm,point.northNm); return <g key={point.id} className="ecdis-waypoint" onClick={(event)=>{event.stopPropagation();setSelectedWaypointId(point.id);}}><circle cx={p.x} cy={p.y} r="9"/><text x={p.x+12} y={p.y-10}>{index+1}</text></g>; })}
            {targets.map((target) => { const p=toScreen(target.xNm,target.yNm); return <g key={target.id} className="ecdis-target"><path d={`M ${p.x} ${p.y-8} L ${p.x+7} ${p.y+7} L ${p.x-7} ${p.y+7} Z`}/><text x={p.x+11} y={p.y+4}>{target.id}</text></g>; })}
            {(() => { const p=toScreen(ownPosition.eastNm,ownPosition.northNm); return <g className="ecdis-own-ship" transform={`translate(${p.x} ${p.y}) rotate(${ship.headingDeg})`}><path d="M0 -15 L8 11 L0 7 L-8 11 Z"/><circle r="19"/></g>; })()}
          </g>
          <g transform={headUp ? `rotate(${ship.headingDeg} 945 50)` : undefined}><path d="M 945 75 L 945 28 M 935 42 L 945 28 L 955 42" className="ecdis-north-arrow"/><text x="945" y="92" textAnchor="middle" className="ecdis-north-label">N</text></g>
          <rect x="10" y="10" width="190" height="42" className="ecdis-map-readout-bg"/>
          <text x="20" y="27" className="ecdis-map-readout">OWN SHIP · {ship.headingDeg.toFixed(0)}°T</text>
          <text x="20" y="42" className="ecdis-map-readout">{ship.speedKn.toFixed(1)} kn · {formatCoordinate(geoOwn.latitudeDeg,true)}</text>
          <rect x="10" y={HEIGHT-37} width="225" height="27" className="ecdis-map-readout-bg"/>
          <text x="20" y={HEIGHT-19} className="ecdis-map-readout">{formatCoordinate(geoOwn.longitudeDeg,false)} · LOCAL DATUM</text>
        </svg>
        <div className="ecdis-map-legend"><span><i className="ecdis-legend-own"/>Своё судно</span><span><i className="ecdis-legend-target"/>Цель</span><span><i className="ecdis-legend-route"/>Маршрут</span><span><i className="ecdis-legend-danger"/>Опасность</span><span><i className="ecdis-legend-shallow"/>Малая глубина</span></div>
        <div className="ecdis-map-actions">
          <button type="button" className="ecdis-tool" onClick={() => setHeadUp((value)=>!value)}>{headUp ? "HEAD UP" : "NORTH UP"}</button>
          <button type="button" className="ecdis-tool" onClick={() => setChartScale((value)=>Math.min(1.6,Number((value+0.1).toFixed(1))))}>УВЕЛИЧИТЬ</button>
          <button type="button" className="ecdis-tool" onClick={() => setChartScale((value)=>Math.max(0.7,Number((value-0.1).toFixed(1))))}>УМЕНЬШИТЬ</button>
          <button type="button" className={showDepths ? "ecdis-tool active" : "ecdis-tool"} onClick={() => setShowDepths((value)=>!value)}>ГЛУБИНЫ</button>
          <button type="button" className={showHazards ? "ecdis-tool active" : "ecdis-tool"} onClick={() => setShowHazards((value)=>!value)}>ОПАСНОСТИ</button>
        </div>
      </section>
      <aside className="ecdis-side-panel">
        <section className="ecdis-data-block">
          <div className="ecdis-block-heading"><span>OWN SHIP DATA</span><b>ПАРАМЕТРЫ</b></div>
          <div className="ecdis-readout-grid">
            <div><small>ПОЗИЦИЯ E</small><b>{ship.eastNm.toFixed(3)} NM</b></div><div><small>ПОЗИЦИЯ N</small><b>{ship.northNm.toFixed(3)} NM</b></div>
            <div><small>КУРС</small><b>{ship.headingDeg.toFixed(1)}° T</b></div><div><small>СКОРОСТЬ</small><b>{ship.speedKn.toFixed(1)} kn</b></div>
            <div><small>ГЛУБИНА КАРТЫ</small><b>{ownDepth === null ? "НЕТ ДАННЫХ" : ownDepth.toFixed(1) + " m"}</b></div><div><small>ТРЕБУЕМАЯ</small><b>{requiredDepthM.toFixed(1)} m</b></div>
          </div>
        </section>
        <section className="ecdis-data-block">
          <div className="ecdis-block-heading"><span>ROUTE MONITORING</span><b>КОНТРОЛЬ МАРШРУТА</b></div>
          <div className="ecdis-readout-grid">
            <div><small>XTE</small><b className={crossTrack && crossTrack.distanceNm>xtdNm ? "ecdis-alarm-text" : ""}>{crossTrack ? crossTrack.distanceNm.toFixed(3)+" NM" : "—"}</b></div>
            <div><small>XTD LIMIT</small><b>{xtdNm.toFixed(2)} NM</b></div>
            <div><small>ACTIVE LEG</small><b>{activeNavigation ? `${activeNavigation.from.name} → ${activeNavigation.to.name}` : "—"}</b></div>
            <div><small>ACTIVE LEG</small><b>{activeNavigation ? `${activeNavigation.from.name} → ${activeNavigation.to.name}` : "—"}</b></div>
            <div><small>BEARING TO WP</small><b>{bearingToNext === null ? "—" : bearingToNext.toFixed(1)+"° T"}</b></div>
            <div><small>DISTANCE TO WP</small><b>{distanceToNext === null ? "—" : distanceToNext.toFixed(2)+" NM"}</b></div>
            <div><small>ROUTE LENGTH</small><b>{routeAssessment.totalDistanceNm.toFixed(2)} NM</b></div>
            <div><small>ETA AT CURRENT SOG</small><b>{etaMinutes === null ? "—" : Math.round(etaMinutes)+" min"}</b></div>
            <div><small>ARRIVAL RADIUS</small><b>{arrivalRadiusNm.toFixed(2)} NM</b></div>
          </div>
          <label className="ecdis-setting"><span>Радиус прибытия WP, NM</span><input type="number" min="0.01" max="0.5" step="0.01" value={arrivalRadiusNm} onChange={(event)=>setArrivalRadiusNm(Math.max(0.01,Math.min(0.5,Number(event.target.value)||0.05)))}/></label>
          <label className="ecdis-setting"><span>Допуск XTD, NM</span><input type="number" min="0.05" max="5" step="0.05" value={xtdNm} onChange={(event)=>setXtdNm(Math.max(0.05,Math.min(5,Number(event.target.value)||0.05)))}/></label>
          <label className="ecdis-setting"><span>Радиус прибытия WP, NM</span><input type="number" min="0.01" max="0.5" step="0.01" value={arrivalRadiusNm} onChange={(event)=>setArrivalRadiusNm(Math.max(0.01,Math.min(0.5,Number(event.target.value)||0.05)))}/></label>
          <label className="ecdis-setting"><span>Осадка судна, м</span><input type="number" min="0.5" max="30" step="0.1" value={draftM} onChange={(event)=>setDraftM(Math.max(0.5,Math.min(30,Number(event.target.value)||0.5)))}/></label>
          <label className="ecdis-setting"><span>Запас под килем, м</span><input type="number" min="0" max="20" step="0.1" value={ukcM} onChange={(event)=>setUkcM(Math.max(0,Math.min(20,Number(event.target.value)||0)))}/></label>
          <label className="ecdis-setting"><span>Safety depth, м</span><input type="number" min="0" max="100" step="0.5" value={safetyDepthM} onChange={(event)=>setSafetyDepthM(Math.max(0,Math.min(100,Number(event.target.value)||0)))}/></label>
          <label className="ecdis-setting"><span>Safety contour, м</span><input type="number" min="0" max="100" step="0.5" value={safetyContourM} onChange={(event)=>setSafetyContourM(Math.max(safetyDepthM,Math.min(100,Number(event.target.value)||safetyDepthM)))}/></label>
          <label className="ecdis-setting"><span>Shallow contour, м</span><input type="number" min="0" max="200" step="0.5" value={shallowContourM} onChange={(event)=>setShallowContourM(Math.max(safetyContourM,Math.min(200,Number(event.target.value)||safetyContourM)))}/></label>
          <label className="ecdis-setting"><span>Плановый ROT, °/мин</span><input type="number" min="1" max="60" step="1" value={plannedRotDegPerMin} onChange={(event)=>setPlannedRotDegPerMin(Math.max(1,Math.min(60,Number(event.target.value)||1)))}/></label>
          <label className="ecdis-setting"><span>Safety depth, м</span><input type="number" min="0" max="100" step="0.5" value={safetyDepthM} onChange={(event)=>setSafetyDepthM(Math.max(0,Math.min(100,Number(event.target.value)||0)))}/></label>
          <label className="ecdis-setting"><span>Safety contour, м</span><input type="number" min="0" max="100" step="0.5" value={safetyContourM} onChange={(event)=>setSafetyContourM(Math.max(safetyDepthM,Math.min(100,Number(event.target.value)||safetyDepthM)))}/></label>
          <label className="ecdis-setting"><span>Shallow contour, м</span><input type="number" min="0" max="200" step="0.5" value={shallowContourM} onChange={(event)=>setShallowContourM(Math.max(safetyContourM,Math.min(200,Number(event.target.value)||safetyContourM)))}/></label>
          <label className="ecdis-setting"><span>Плановый ROT, °/мин</span><input type="number" min="1" max="60" step="1" value={plannedRotDegPerMin} onChange={(event)=>setPlannedRotDegPerMin(Math.max(1,Math.min(60,Number(event.target.value)||1)))}/></label>
        </section>
        <section className="ecdis-data-block">
          <div className="ecdis-block-heading"><span>ROUTE PLAN</span><b>ПЛАНИРОВАНИЕ</b></div>
          <div className="ecdis-route-actions"><button type="button" className="ecdis-tool" onClick={() => routeFileInput.current?.click()}>ИМПОРТ GPX</button><input ref={routeFileInput} type="file" accept=".gpx,.xml,application/gpx+xml,application/xml,text/xml" hidden onChange={importRouteGpx}/><button type="button" className="ecdis-tool" onClick={exportRouteGpx} disabled={!route.length}>ЭКСПОРТ GPX</button><button type="button" className="ecdis-tool" onClick={removeLastWaypoint} disabled={!route.length}><Trash2 size={13}/> УДАЛИТЬ ПОСЛЕДНЮЮ</button><button type="button" className="ecdis-tool" onClick={clearRoute} disabled={!route.length}><RotateCcw size={13}/> ОЧИСТИТЬ</button></div>
          <div className="ecdis-waypoint-list">{route.length ? route.map((point,index)=>{const geo=toGeographicPosition(point,origin);return <button type="button" key={point.id} className={selectedWaypointId===point.id?"ecdis-waypoint-row selected":"ecdis-waypoint-row"} onClick={()=>setSelectedWaypointId(point.id)}><b>{index+1}. {point.name}</b><span>{point.eastNm.toFixed(2)} E / {point.northNm.toFixed(2)} N NM</span><small>{formatCoordinate(geo.latitudeDeg,true)} · {formatCoordinate(geo.longitudeDeg,false)}</small></button>;}) : <p>Маршрут пока не задан. Включите прокладку и добавьте точки на карте.</p>}</div>
          {selectedWaypoint && <div className="ecdis-selected-waypoint"><b>{selectedWaypoint.name}</b>
            <label className="ecdis-setting"><span>E, NM</span><input type="number" step="0.001" value={selectedWaypoint.eastNm} onChange={(event)=>updateWaypoint(selectedWaypoint.id,"eastNm",event.target.value)}/></label>
            <label className="ecdis-setting"><span>N, NM</span><input type="number" step="0.001" value={selectedWaypoint.northNm} onChange={(event)=>updateWaypoint(selectedWaypoint.id,"northNm",event.target.value)}/></label>
            <div className="ecdis-route-actions"><button type="button" className="ecdis-tool" onClick={()=>moveWaypoint(selectedWaypoint.id,-1)}>ВЫШЕ</button><button type="button" className="ecdis-tool" onClick={()=>moveWaypoint(selectedWaypoint.id,1)}>НИЖЕ</button><button type="button" className="ecdis-tool" onClick={()=>{if(route.length<=1)setRouteStart(null);setRoute((current)=>current.filter((point)=>point.id!==selectedWaypoint.id).map((point,index)=>({...point,id:"WP-"+String(index+1).padStart(2,"0"),name:"WP "+String(index+1).padStart(2,"0")})));}}>УДАЛИТЬ WP</button></div>
          </div>}
          {route.length > 2 && <div className="ecdis-selected-waypoint"><b>WHEEL-OVER ESTIMATE</b><span>ROT {plannedRotDegPerMin.toFixed(0)}°/min · SOG {ship.speedKn.toFixed(1)} kn</span>{route.slice(1, -1).map((point, index) => {
            const incoming = bearingDeg(route[index], point);
            const outgoing = bearingDeg(point, route[index + 2]);
            const delta = ((outgoing - incoming + 540) % 360) - 180;
            const wheelOver = calculateWheelOverDistanceNm(ship.speedKn, plannedRotDegPerMin, delta);
            return <small key={point.id}>{point.name}: {wheelOver === null ? "—" : wheelOver.toFixed(3) + " NM before WP"} · ΔC {Math.abs(delta).toFixed(0)}°</small>;
          })}</div>}
          {route.length > 2 && <div className="ecdis-selected-waypoint"><b>WHEEL-OVER ESTIMATE</b><span>ROT {plannedRotDegPerMin.toFixed(0)}°/min · based on current SOG {ship.speedKn.toFixed(1)} kn</span>{route.slice(1, -1).map((point, index) => {
            const incoming = bearingDeg(route[index], point);
            const outgoing = bearingDeg(point, route[index + 2]);
            const delta = ((outgoing - incoming + 540) % 360) - 180;
            const wheelOver = calculateWheelOverDistanceNm(ship.speedKn, plannedRotDegPerMin, delta);
            return <small key={point.id}>{point.name}: {wheelOver === null ? "—" : wheelOver.toFixed(3) + " NM before WP"} · ΔC {Math.abs(delta).toFixed(0)}°</small>;
          })}</div>}
        </section>
        <section className="ecdis-data-block">
          <div className="ecdis-block-heading"><span>SAFETY CHECK</span><b>ПРОВЕРКА БЕЗОПАСНОСТИ</b></div>
          <div className={routeAssessment.safe && requiredDepthM >= safetyDepthM ? "ecdis-safety-box safe" : "ecdis-safety-box danger"}>
            <b>{route.length<2?"НЕДОСТАТОЧНО ДАННЫХ":routeAssessment.safe?"ОПАСНОСТИ НЕ ОБНАРУЖЕНЫ":"ОБНАРУЖЕНЫ ОПАСНОСТИ"}</b>
            <span>Требуемая глубина: {requiredDepthM.toFixed(1)} м · Safety depth: {safetyDepthM.toFixed(1)} м · контуры {safetyContourM.toFixed(1)}/{shallowContourM.toFixed(1)} м · минимум на маршруте: {routeAssessment.minimumChartedDepthM === null ? "нет данных" : routeAssessment.minimumChartedDepthM.toFixed(1) + " м"}</span>
            {requiredDepthM < safetyDepthM && <small>Safety depth выше расчётной требуемой глубины: проверьте настройки.</small>}
            {requiredDepthM < safetyDepthM && <small>Safety depth выше расчётной требуемой глубины: проверьте настройки.</small>}
            {routeAssessment.warnings.length ? routeAssessment.warnings.map((warning,index)=><small key={index}>{warning}</small>) : <small>Проверка выполнена по имеющимся данным учебной карты.</small>}
          </div>
        </section>
        <section className="ecdis-data-block">
          <div className="ecdis-block-heading"><span>CHART REFERENCE</span><b>КООРДИНАТНАЯ ОСНОВА</b></div>
          <label className="ecdis-setting"><span>Широта начала, °</span><input type="number" min="-89.9" max="89.9" step="0.0001" value={origin.latitudeDeg} onChange={(event)=>updateOrigin("latitudeDeg",event.target.value)}/></label>
          <label className="ecdis-setting"><span>Долгота начала, °</span><input type="number" min="-180" max="180" step="0.0001" value={origin.longitudeDeg} onChange={(event)=>updateOrigin("longitudeDeg",event.target.value)}/></label>
          <p className="ecdis-disclaimer">Данные карты синтетические и предназначены только для обучения. Некартографированные участки помечаются как неизвестные и не считаются безопасными. Это не официальная ENC, не S-57/S-101 и не пригодно для реального судовождения. Географические координаты вычисляются относительно заданной точки начала в локальной плоской системе.</p>
        </section>
      </aside>
    </div>
    <div className="ecdis-statusbar"><span><Anchor size={13}/> ECDIS TRAINING MODE</span><span>{route.length} WAYPOINTS · {legs.length} LEGS</span><span>{targets.length} RADAR TARGETS OVERLAID</span><span>{statusMessage}</span></div>
  </section>;
}
