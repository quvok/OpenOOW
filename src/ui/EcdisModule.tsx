import { useMemo, useState, type MouseEvent } from "react";
import { Anchor, Map, RotateCcw, Trash2 } from "lucide-react";
import type { ShipDynamicsState } from "../core/shipDynamics";
import type { VesselState } from "../core/navigation";
import {
  assessRoute, bearingDeg, buildRouteLegs, calculateCrossTrackError, chartedDepthAt,
  distanceNm, formatCoordinate, toGeographicPosition, TRAINING_CHART_AREAS,
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
  const [origin, setOrigin] = useState<GeoOrigin>({ latitudeDeg: 0, longitudeDeg: 0 });
  const [draftM, setDraftM] = useState(7.5);
  const [ukcM, setUkcM] = useState(1.5);
  const [xtdNm, setXtdNm] = useState(0.5);
  const [showDepths, setShowDepths] = useState(true);
  const [showHazards, setShowHazards] = useState(true);
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(null);
  const [routeEdit, setRouteEdit] = useState(true);
  const [chartScale, setChartScale] = useState(1);
  const [statusMessage, setStatusMessage] = useState("Нажмите на карту, чтобы добавить первую маршрутную точку.");
  const ownPosition = { eastNm: ship.eastNm, northNm: ship.northNm };
  const requiredDepthM = draftM + ukcM;
  const crossTrack = useMemo(() => calculateCrossTrackError(route, ownPosition), [route, ship.eastNm, ship.northNm]);
  const routeAssessment = useMemo(() => assessRoute(route, TRAINING_CHART_AREAS, TRAINING_CHART_HAZARDS, requiredDepthM), [route, requiredDepthM]);
  const legs = useMemo(() => buildRouteLegs(route), [route]);
  const ownDepth = chartedDepthAt(ownPosition, TRAINING_CHART_AREAS);
  const selectedWaypoint = route.find((point) => point.id === selectedWaypointId) ?? null;
  const nextWaypoint = crossTrack ? route[crossTrack.segmentIndex + 1] : route[0] ?? null;
  const distanceToNext = nextWaypoint ? distanceNm(ownPosition, nextWaypoint) : null;
  const bearingToNext = nextWaypoint ? bearingDeg(ownPosition, nextWaypoint) : null;
  const remainingDistance = crossTrack ? Math.max(0, routeAssessment.totalDistanceNm - crossTrack.alongTrackNm) : routeAssessment.totalDistanceNm;
  const etaMinutes = ship.speedKn > 0.1 ? remainingDistance / ship.speedKn * 60 : null;
  const geoOwn = toGeographicPosition(ownPosition, origin);
  const mapTransform = "translate(" + (CENTER_X - ship.eastNm * SCALE * chartScale) + " " + (CENTER_Y + ship.northNm * SCALE * chartScale) + ") scale(" + chartScale + ") translate(" + -CENTER_X + " " + -CENTER_Y + ")";

  const addWaypoint = (event: MouseEvent<SVGSVGElement>) => {
    if (!routeEdit) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) * WIDTH / rect.width;
    const py = (event.clientY - rect.top) * HEIGHT / rect.height;
    const eastNm = ship.eastNm + (px - CENTER_X) / (SCALE * chartScale);
    const northNm = ship.northNm + (CENTER_Y - py) / (SCALE * chartScale);
    setRoute((current) => [...current, makeWaypoint(current.length + 1, Number(eastNm.toFixed(3)), Number(northNm.toFixed(3)))]);
    setStatusMessage("Маршрутная точка добавлена. Продолжайте прокладку или отключите режим редактирования.");
  };

  const removeLastWaypoint = () => {
    setRoute((current) => current.slice(0, -1));
    setStatusMessage("Последняя маршрутная точка удалена.");
  };

  const clearRoute = () => {
    setRoute([]);
    setSelectedWaypointId(null);
    setStatusMessage("Маршрут очищен.");
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
        <div className="ecdis-map-meta"><span>DISPLAY: OWN SHIP FOLLOW · NORTH UP</span><span>DEPTH UNITS: METRES</span><span>SCALE 1:{Math.round(50000 / chartScale).toLocaleString("ru-RU")}</span></div>
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
            {TRAINING_CHART_AREAS.filter((area) => area.kind === "land").map((area) => <g key={area.id}><polygon points={polygonPoints(area.polygon)} className="ecdis-land"/><polygon points={polygonPoints(area.polygon)} fill="url(#ecdis-land-pattern)"/></g>)}
            {showDepths && TRAINING_CHART_AREAS.filter((area) => area.kind === "shallow").map((area) => <g key={area.id}><polygon points={polygonPoints(area.polygon)} className="ecdis-shallow"/><text x={toScreen(area.polygon[0].eastNm, area.polygon[0].northNm).x+8} y={toScreen(area.polygon[0].eastNm, area.polygon[0].northNm).y-6} className="ecdis-depth-label">{area.depthM?.toFixed(1)} m · {area.name}</text></g>)}
            {showHazards && TRAINING_CHART_HAZARDS.map((hazard) => { const point = toScreen(hazard.position.eastNm, hazard.position.northNm); return <g key={hazard.id}><circle cx={point.x} cy={point.y} r={hazard.radiusNm*SCALE} className="ecdis-hazard-zone"/><path d={`M ${point.x-8} ${point.y-8} L ${point.x+8} ${point.y+8} M ${point.x+8} ${point.y-8} L ${point.x-8} ${point.y+8}`} className="ecdis-hazard-mark"/><text x={point.x+12} y={point.y-10} className="ecdis-hazard-label">{hazard.name}</text></g>; })}
            {route.length > 1 && <polyline points={polygonPoints(route)} className="ecdis-route-halo"/>}
            {route.length > 1 && <polyline points={polygonPoints(route)} className="ecdis-route-line"/>}
            {crossTrack && <circle cx={toScreen(crossTrack.nearestPoint.eastNm,crossTrack.nearestPoint.northNm).x} cy={toScreen(crossTrack.nearestPoint.eastNm,crossTrack.nearestPoint.northNm).y} r={xtdNm*SCALE} className="ecdis-xtd-limit"/>}
            {crossTrack && <line x1={toScreen(ownPosition.eastNm,ownPosition.northNm).x} y1={toScreen(ownPosition.eastNm,ownPosition.northNm).y} x2={toScreen(crossTrack.nearestPoint.eastNm,crossTrack.nearestPoint.northNm).x} y2={toScreen(crossTrack.nearestPoint.eastNm,crossTrack.nearestPoint.northNm).y} className="ecdis-xte-line"/>}
            {route.map((point,index) => { const p=toScreen(point.eastNm,point.northNm); return <g key={point.id} className="ecdis-waypoint" onClick={(event)=>{event.stopPropagation();setSelectedWaypointId(point.id);}}><circle cx={p.x} cy={p.y} r="9"/><text x={p.x+12} y={p.y-10}>{index+1}</text></g>; })}
            {targets.map((target) => { const p=toScreen(target.xNm,target.yNm); return <g key={target.id} className="ecdis-target"><path d={`M ${p.x} ${p.y-8} L ${p.x+7} ${p.y+7} L ${p.x-7} ${p.y+7} Z`}/><text x={p.x+11} y={p.y+4}>{target.id}</text></g>; })}
            {(() => { const p=toScreen(ownPosition.eastNm,ownPosition.northNm); return <g className="ecdis-own-ship" transform={`translate(${p.x} ${p.y}) rotate(${ship.headingDeg})`}><path d="M0 -15 L8 11 L0 7 L-8 11 Z"/><circle r="19"/></g>; })()}
          </g>
          <path d="M 945 75 L 945 28 M 935 42 L 945 28 L 955 42" className="ecdis-north-arrow"/>
          <text x="945" y="92" textAnchor="middle" className="ecdis-north-label">N</text>
          <rect x="10" y="10" width="190" height="42" className="ecdis-map-readout-bg"/>
          <text x="20" y="27" className="ecdis-map-readout">OWN SHIP · {ship.headingDeg.toFixed(0)}°T</text>
          <text x="20" y="42" className="ecdis-map-readout">{ship.speedKn.toFixed(1)} kn · {formatCoordinate(geoOwn.latitudeDeg,true)}</text>
          <rect x="10" y={HEIGHT-37} width="225" height="27" className="ecdis-map-readout-bg"/>
          <text x="20" y={HEIGHT-19} className="ecdis-map-readout">{formatCoordinate(geoOwn.longitudeDeg,false)} · LOCAL DATUM</text>
        </svg>
        <div className="ecdis-map-legend"><span><i className="ecdis-legend-own"/>Своё судно</span><span><i className="ecdis-legend-target"/>Цель</span><span><i className="ecdis-legend-route"/>Маршрут</span><span><i className="ecdis-legend-danger"/>Опасность</span><span><i className="ecdis-legend-shallow"/>Малая глубина</span></div>
        <div className="ecdis-map-actions">
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
            <div><small>BEARING TO WP</small><b>{bearingToNext === null ? "—" : bearingToNext.toFixed(1)+"° T"}</b></div>
            <div><small>DISTANCE TO WP</small><b>{distanceToNext === null ? "—" : distanceToNext.toFixed(2)+" NM"}</b></div>
            <div><small>ROUTE LENGTH</small><b>{routeAssessment.totalDistanceNm.toFixed(2)} NM</b></div>
            <div><small>ETA AT CURRENT SOG</small><b>{etaMinutes === null ? "—" : Math.round(etaMinutes)+" min"}</b></div>
          </div>
          <label className="ecdis-setting"><span>Допуск XTD, NM</span><input type="number" min="0.05" max="5" step="0.05" value={xtdNm} onChange={(event)=>setXtdNm(Math.max(0.05,Math.min(5,Number(event.target.value)||0.05)))}/></label>
          <label className="ecdis-setting"><span>Осадка судна, м</span><input type="number" min="0.5" max="30" step="0.1" value={draftM} onChange={(event)=>setDraftM(Math.max(0.5,Math.min(30,Number(event.target.value)||0.5)))}/></label>
          <label className="ecdis-setting"><span>Запас под килем, м</span><input type="number" min="0" max="20" step="0.1" value={ukcM} onChange={(event)=>setUkcM(Math.max(0,Math.min(20,Number(event.target.value)||0)))}/></label>
        </section>
        <section className="ecdis-data-block">
          <div className="ecdis-block-heading"><span>ROUTE PLAN</span><b>ПЛАНИРОВАНИЕ</b></div>
          <div className="ecdis-route-actions"><button type="button" className="ecdis-tool" onClick={removeLastWaypoint} disabled={!route.length}><Trash2 size={13}/> УДАЛИТЬ ПОСЛЕДНЮЮ</button><button type="button" className="ecdis-tool" onClick={clearRoute} disabled={!route.length}><RotateCcw size={13}/> ОЧИСТИТЬ</button></div>
          <div className="ecdis-waypoint-list">{route.length ? route.map((point,index)=>{const geo=toGeographicPosition(point,origin);return <button type="button" key={point.id} className={selectedWaypointId===point.id?"ecdis-waypoint-row selected":"ecdis-waypoint-row"} onClick={()=>setSelectedWaypointId(point.id)}><b>{index+1}. {point.name}</b><span>{point.eastNm.toFixed(2)} E / {point.northNm.toFixed(2)} N NM</span><small>{formatCoordinate(geo.latitudeDeg,true)} · {formatCoordinate(geo.longitudeDeg,false)}</small></button>;}) : <p>Маршрут пока не задан. Включите прокладку и добавьте точки на карте.</p>}</div>
          {selectedWaypoint && <div className="ecdis-selected-waypoint"><b>{selectedWaypoint.name}</b><span>{selectedWaypoint.eastNm.toFixed(3)} E / {selectedWaypoint.northNm.toFixed(3)} N NM</span></div>}
        </section>
        <section className="ecdis-data-block">
          <div className="ecdis-block-heading"><span>SAFETY CHECK</span><b>ПРОВЕРКА БЕЗОПАСНОСТИ</b></div>
          <div className={routeAssessment.safe ? "ecdis-safety-box safe" : "ecdis-safety-box danger"}>
            <b>{route.length<2?"НЕДОСТАТОЧНО ДАННЫХ":routeAssessment.safe?"ОПАСНОСТИ НЕ ОБНАРУЖЕНЫ":"ОБНАРУЖЕНЫ ОПАСНОСТИ"}</b>
            <span>Требуемая глубина: {requiredDepthM.toFixed(1)} м · минимум на маршруте: {routeAssessment.minimumChartedDepthM === null ? "нет данных" : routeAssessment.minimumChartedDepthM.toFixed(1) + " м"}</span>
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
