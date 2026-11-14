import { useEffect, useRef, useState } from "react";
import { Anchor, Gauge, RotateCcw, Ship, Waves, Target } from "lucide-react";
import { advanceFixedSteps } from "../core/simulationEngine";
import { advanceVessel, calculateCpa, type VesselState } from "../core/navigation";
import { motionVectorToRadar, projectRelativePosition, type RadarVectorMode } from "../core/radar";
import { createRadarMeasurementTrackHistory, recordRadarMeasurementTracks } from "../core/radarTracks";
import { acquireArpaTarget, calculateArpaSolution, calculateTrialManoeuvre, updateArpaTracks, isArpaCloseApproachAlert, DEFAULT_ARPA_ALERT_CONFIG, DEFAULT_ARPA_LOST_AFTER_SECONDS, type ArpaTrackSet } from "../core/arpa";
import { DEFAULT_RADAR_CONFIG, isRadarScanDue, measureRadarContacts, type RadarScanClock } from "../core/radarMeasurements";
import { INITIAL_SHIP_STATE, stepShip, type ShipDynamicsState } from "../core/shipDynamics";
import { ENCOUNTER_SCENARIOS, getScenarioTargetCpa, type EncounterScenario } from "../core/scenarios";

const STEP_SECONDS = 0.1;
const RADAR_RANGE_NM = 3;
const RADAR_VECTOR_MINUTES = 6;
const RADAR_CENTER = 250;
const RADAR_RADIUS_PX = 220;

function formatTime(seconds: number) {
  const total = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  return pad(Math.floor(total / 3600)) + ":" + pad(Math.floor((total % 3600) / 60)) + ":" + pad(total % 60);
}

function formatMinutes(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes)) return "—";
  const sign = minutes < 0 ? "−" : "";
  const absolute = Math.abs(minutes);
  return sign + Math.floor(absolute) + "m " + Math.round((absolute % 1) * 60) + "s";
}

function createScenarioShipState(scenario: EncounterScenario): ShipDynamicsState {
  const throttlePercent = (scenario.ownShip.speedKn / 15) * 100;
  return {
    ...INITIAL_SHIP_STATE,
    headingDeg: scenario.ownShip.courseDeg,
    speedKn: scenario.ownShip.speedKn,
    throttlePercent
  };
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><b>{value}</b></div>;
}

export default function App() {
  const [selectedScenarioId, setSelectedScenarioId] = useState(ENCOUNTER_SCENARIOS[0].id);
  const [activeScenario, setActiveScenario] = useState<EncounterScenario>(ENCOUNTER_SCENARIOS[0]);
  const [ship, setShip] = useState<ShipDynamicsState>(() => createScenarioShipState(ENCOUNTER_SCENARIOS[0]));
  const [running, setRunning] = useState(false);
  const [eblBearingDeg, setEblBearingDeg] = useState(0);
  const [vrmRangeNm, setVrmRangeNm] = useState(1.5);
  const [vectorMode, setVectorMode] = useState<RadarVectorMode>("true");
  const [vectorMinutes, setVectorMinutes] = useState(6);
  const [trialCourseDeg, setTrialCourseDeg] = useState(ENCOUNTER_SCENARIOS[0].ownShip.courseDeg);
  const [trialSpeedKn, setTrialSpeedKn] = useState(ENCOUNTER_SCENARIOS[0].ownShip.speedKn);
  const [selectedRadarTargetId, setSelectedRadarTargetId] = useState<string | null>(null);
  const [targets, setTargets] = useState<VesselState[]>(() => ENCOUNTER_SCENARIOS[0].targets.map((target) => ({ ...target })));
  const [radarMeasurements, setRadarMeasurements] = useState(() => measureRadarContacts({ xNm: 0, yNm: 0 }, ENCOUNTER_SCENARIOS[0].targets, 0, 0));
  const [tracks, setTracks] = useState(() => createRadarMeasurementTrackHistory(radarMeasurements, { xNm: 0, yNm: 0 }));
  const [arpaTracks, setArpaTracks] = useState<ArpaTrackSet>({});
  const [alertDcpaNm, setAlertDcpaNm] = useState(DEFAULT_ARPA_ALERT_CONFIG.minimumDcpaNm);
  const [alertTcpaMinutes, setAlertTcpaMinutes] = useState(DEFAULT_ARPA_ALERT_CONFIG.maximumTcpaMinutes);
  const shipRef = useRef<ShipDynamicsState>(ship);
  const targetsRef = useRef<VesselState[]>(targets);
  const tracksRef = useRef(tracks);
  const arpaTracksRef = useRef<ArpaTrackSet>({});
  const radarMeasurementsRef = useRef(radarMeasurements);
  const radarScanClockRef = useRef<RadarScanClock>({ lastScanSeconds: 0, scanNumber: 0 });
  const accumulatorRef = useRef(0);

  const updateShip = (update: (current: ShipDynamicsState) => ShipDynamicsState) => {
    const next = update(shipRef.current);
    shipRef.current = next;
    setShip(next);
  };

  useEffect(() => {
    if (!running) return;

    let frameId = 0;
    let previousTimestamp: number | null = null;

    const frame = (timestamp: number) => {
      if (previousTimestamp === null) {
        previousTimestamp = timestamp;
      } else {
        const elapsedSeconds = (timestamp - previousTimestamp) / 1000;
        previousTimestamp = timestamp;

        // Advance own ship and all traffic in one shared fixed-step clock.
        // This prevents the two sets of vessels from ever accumulating different time.
        const result = advanceFixedSteps(
          { ownShip: shipRef.current, targets: targetsRef.current, tracks: tracksRef.current, arpa: arpaTracksRef.current, radarMeasurements: radarMeasurementsRef.current, radarScan: radarScanClockRef.current },
          elapsedSeconds,
          accumulatorRef.current,
          STEP_SECONDS,
          (current, dtSeconds) => {
            const nextOwnShip = stepShip(current.ownShip, dtSeconds);
            const nextTargets = current.targets.map((target) => advanceVessel(target, dtSeconds));
            let nextMeasurements = current.radarMeasurements;
            let nextScan = current.radarScan;
            let nextTracks = current.tracks;
            let nextArpa = current.arpa;
            if (isRadarScanDue(nextOwnShip.elapsedSeconds, current.radarScan, DEFAULT_RADAR_CONFIG)) {
              const scanNumber = current.radarScan.scanNumber + 1;
              nextMeasurements = measureRadarContacts(
                { xNm: nextOwnShip.eastNm, yNm: nextOwnShip.northNm },
                nextTargets,
                nextOwnShip.elapsedSeconds,
                scanNumber,
                DEFAULT_RADAR_CONFIG,
              );
              nextScan = { lastScanSeconds: nextOwnShip.elapsedSeconds, scanNumber };
              nextTracks = recordRadarMeasurementTracks(current.tracks, nextMeasurements, 240, { xNm: nextOwnShip.eastNm, yNm: nextOwnShip.northNm });
              nextArpa = updateArpaTracks(current.arpa, nextMeasurements, nextOwnShip.elapsedSeconds, DEFAULT_ARPA_LOST_AFTER_SECONDS);
            }
            return {
              ownShip: nextOwnShip,
              targets: nextTargets,
              tracks: nextTracks,
              arpa: nextArpa,
              radarMeasurements: nextMeasurements,
              radarScan: nextScan,
            };
          },
        );

        shipRef.current = result.state.ownShip;
        targetsRef.current = result.state.targets;
        tracksRef.current = result.state.tracks;
        arpaTracksRef.current = result.state.arpa;
        radarMeasurementsRef.current = result.state.radarMeasurements;
        radarScanClockRef.current = result.state.radarScan;
        accumulatorRef.current = result.accumulatorSeconds;
        if (result.stepsExecuted > 0) {
          setShip(result.state.ownShip);
          setTargets(result.state.targets);
          setTracks(result.state.tracks);
          setArpaTracks(result.state.arpa);
          setRadarMeasurements(result.state.radarMeasurements);
        }
      }

      frameId = window.requestAnimationFrame(frame);
    };

    frameId = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(frameId);
  }, [running]);

  const loadScenario = () => {
    const scenario = ENCOUNTER_SCENARIOS.find((item) => item.id === selectedScenarioId);
    if (!scenario) return;
    setRunning(false);
    accumulatorRef.current = 0;
    const nextShip = createScenarioShipState(scenario);
    shipRef.current = nextShip;
    setShip(nextShip);
    setActiveScenario(scenario);
    setTrialCourseDeg(scenario.ownShip.courseDeg);
    setTrialSpeedKn(scenario.ownShip.speedKn);
    const nextTargets = scenario.targets.map((target) => ({ ...target }));
    targetsRef.current = nextTargets;
    setTargets(nextTargets);
    const initialMeasurements = measureRadarContacts({ xNm: nextShip.eastNm, yNm: nextShip.northNm }, nextTargets, 0, 0, DEFAULT_RADAR_CONFIG);
    radarMeasurementsRef.current = initialMeasurements;
    setRadarMeasurements(initialMeasurements);
    const nextTracks = createRadarMeasurementTrackHistory(initialMeasurements, { xNm: nextShip.eastNm, yNm: nextShip.northNm });
    tracksRef.current = nextTracks;
    setTracks(nextTracks);
    arpaTracksRef.current = {};
    setArpaTracks({});
    radarScanClockRef.current = { lastScanSeconds: 0, scanNumber: 0 };
  };

  const reset = () => {
    setRunning(false);
    accumulatorRef.current = 0;
    const resetShip = createScenarioShipState(activeScenario);
    setTrialCourseDeg(activeScenario.ownShip.courseDeg);
    setTrialSpeedKn(activeScenario.ownShip.speedKn);
    shipRef.current = resetShip;
    setShip(resetShip);
    const resetTargets = activeScenario.targets.map((target) => ({ ...target }));
    targetsRef.current = resetTargets;
    setTargets(resetTargets);
    const initialMeasurements = measureRadarContacts({ xNm: resetShip.eastNm, yNm: resetShip.northNm }, resetTargets, 0, 0, DEFAULT_RADAR_CONFIG);
    radarMeasurementsRef.current = initialMeasurements;
    setRadarMeasurements(initialMeasurements);
    const resetTracks = createRadarMeasurementTrackHistory(initialMeasurements, { xNm: resetShip.eastNm, yNm: resetShip.northNm });
    tracksRef.current = resetTracks;
    setTracks(resetTracks);
    arpaTracksRef.current = {};
    setArpaTracks({});
    radarScanClockRef.current = { lastScanSeconds: 0, scanNumber: 0 };
  };

  const acquireTarget = (targetId: string) => {
    const measurement = radarMeasurementsRef.current.find((item) => item.id === targetId);
    if (!measurement) return;
    const next = { ...arpaTracksRef.current, [targetId]: acquireArpaTarget(measurement, measurement.timeSeconds) };
    arpaTracksRef.current = next;
    setArpaTracks(next);
  };

  const releaseTarget = (targetId: string) => {
    const next = { ...arpaTracksRef.current };
    delete next[targetId];
    arpaTracksRef.current = next;
    setArpaTracks(next);
  };

  // North-up PPI: own ship remains at the display centre; contacts are plotted relative to it.
  const x = RADAR_CENTER;
  const y = RADAR_CENTER;
  const eblRadians = eblBearingDeg * Math.PI / 180;
  const eblX = x + Math.sin(eblRadians) * RADAR_RADIUS_PX;
  const eblY = y - Math.cos(eblRadians) * RADAR_RADIUS_PX;
  const vrmRadiusPx = (vrmRangeNm / RADAR_RANGE_NM) * RADAR_RADIUS_PX;
  const ownVessel: VesselState = { id: "OWN", xNm: ship.eastNm, yNm: ship.northNm, courseDeg: ship.headingDeg, speedKn: ship.speedKn };
  const targetCpa = targets.map((target) => ({ target, cpa: calculateCpa(ownVessel, target) }));
  const selectedMeasurement = radarMeasurements.find((item) => item.id === selectedRadarTargetId) ?? null;
  const selectedTrack = selectedRadarTargetId ? arpaTracks[selectedRadarTargetId] : undefined;
  const eblDifference = selectedMeasurement ? ((selectedMeasurement.bearingDeg - eblBearingDeg + 540) % 360) - 180 : null;

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><Ship size={24}/><span>OpenOOW</span></div>
      <div className="side-label">ТРЕНАЖЁР</div>
      <div className="side-link active"><Gauge size={17}/>Динамика судна</div>
      <div className="side-link"><Anchor size={17}/>Маневрирование</div>
      <div className="side-link"><Waves size={17}/>Внешняя среда</div>
      <div className="sidebar-foot">SIM CORE · 0.13.0</div>
    </aside>
    <section className="workspace">
      <header className="topbar">
        <div><div className="eyebrow">OPENOOW / УЧЕБНЫЙ РЕЖИМ</div><h1>Расхождение с судами</h1></div>
        <div className={running ? "status live" : "status"}><i/>{running ? "СИМУЛЯЦИЯ ЗАПУЩЕНА" : "ПАУЗА"}</div>
      </header>
      <section className="panel scenario-picker">
        <div className="scenario-picker-top">
          <div><span className="eyebrow">УЧЕБНЫЕ СИТУАЦИИ</span><h2>Выбор сценария</h2></div>
          <span className="unit">{ENCOUNTER_SCENARIOS.length} СЦЕНАРИЕВ</span>
        </div>
        <div className="scenario-select-row">
          <select aria-label="Выбрать сценарий" value={selectedScenarioId} onChange={(event) => setSelectedScenarioId(event.target.value)}>
            {ENCOUNTER_SCENARIOS.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.title}</option>)}
          </select>
          <button className="primary" onClick={loadScenario}>Загрузить</button>
        </div>
        <div className="scenario-description">
          <b>{activeScenario.title}</b><span>{activeScenario.category}</span>
          <p>{activeScenario.description}</p>
          <p><strong>Задача:</strong> {activeScenario.task}</p>
          <p><strong>Нормативная основа:</strong> {activeScenario.ruleReference}</p>
          <div className="scenario-facts"><span>Собственный курс: {activeScenario.ownShip.courseDeg.toFixed(0)}° T</span><span>Скорость: {activeScenario.ownShip.speedKn.toFixed(1)} kn</span><span>Видимость: {activeScenario.visibilityNm.toFixed(1)} NM</span></div>
        </div>
      </section>
      <div className="main-grid">
        <section className="panel radar-panel">
          <div className="panel-heading"><div><span className="eyebrow">СИТУАЦИОННАЯ КАРТИНА</span><h2>Положение судов</h2></div><span className="unit">NORTH UP · 3 NM · SCAN 2.5 S · VECTOR {vectorMinutes} MIN</span></div>
          <div className="vector-mode-control"><span>ВЕКТОРЫ ARPA</span><div><button type="button" className={vectorMode === "true" ? "mode-active" : "mode-button"} onClick={() => setVectorMode("true")}>Истинные</button><button type="button" className={vectorMode === "relative" ? "mode-active" : "mode-button"} onClick={() => setVectorMode("relative")}>Относительные</button></div><label className="vector-length-control">Время вектора <strong>{vectorMinutes} мин</strong><input type="range" min="1" max="30" step="1" value={vectorMinutes} onChange={(event) => setVectorMinutes(Number(event.target.value))}/></label></div>
          <svg className="radar-view" viewBox="0 0 500 500" role="img" aria-label="Схема взаимного положения судов">
            <circle cx="250" cy="250" r="235" className="radar-bg"/>
            {[58,117,176,235].map((r)=><circle key={r} cx="250" cy="250" r={r} className="radar-ring"/>)
            }
            <path d="M250 15V485 M15 250H485" className="radar-cross"/>
            <circle cx={x} cy={y} r={vrmRadiusPx} className="vrm-ring"/>
            <path d={"M" + x + " " + y + " L" + eblX + " " + eblY} className="ebl-line"/>
            <text x={x + 9} y={y - 10}>EBL {eblBearingDeg.toFixed(0)}°T</text>
            {targets.map((target) => {
              const history = tracks[target.id] ?? [];
              const trailPoints = history
                .map((sample) => projectRelativePosition({ xNm: 0, yNm: 0 }, sample, RADAR_RANGE_NM, RADAR_RADIUS_PX, RADAR_CENTER))
                .filter((sample) => Math.hypot(sample.x - RADAR_CENTER, sample.y - RADAR_CENTER) <= RADAR_RADIUS_PX);
              const trailPath = trailPoints.map((sample) => sample.x.toFixed(1) + "," + sample.y.toFixed(1)).join(" ");
              return trailPoints.length > 1 ? <polyline key={target.id} points={trailPath} className="target-trail"/> : null;
            })}
            {radarMeasurements.map((measurement) => {
              const target = targets.find((item) => item.id === measurement.id);
              if (!target) return null;
              const track = Object.values(arpaTracks).find((item) => item.associatedRadarId === measurement.id);
              const point = projectRelativePosition(ownVessel, measurement, RADAR_RANGE_NM, RADAR_RADIUS_PX, RADAR_CENTER);
              const estimatedTarget = track?.estimatedCourseDeg !== null && track?.estimatedCourseDeg !== undefined && track.estimatedSpeedKn !== null
                ? { courseDeg: track.estimatedCourseDeg, speedKn: track.estimatedSpeedKn }
                : null;
              const vector = estimatedTarget
                ? motionVectorToRadar(ownVessel, estimatedTarget, vectorMode, vectorMinutes, RADAR_RANGE_NM, RADAR_RADIUS_PX)
                : { dx: 0, dy: 0 };
              const vectorLength = Math.hypot(vector.dx, vector.dy);
              const unitX = vectorLength > 0 ? vector.dx / vectorLength : 0;
              const unitY = vectorLength > 0 ? vector.dy / vectorLength : 0;
              const baseX = vector.dx - unitX * 8;
              const baseY = vector.dy - unitY * 8;
              const wing = 4;
              const arrowHead = vectorLength > 0
                ? " M" + (baseX - unitY * wing) + " " + (baseY + unitX * wing) +
                  " L" + vector.dx + " " + vector.dy +
                  " L" + (baseX + unitY * wing) + " " + (baseY - unitX * wing)
                : "";
              return <g key={target.id} role="button" tabIndex={0} aria-label={"Выбрать радиолокационную цель " + target.id} aria-pressed={selectedRadarTargetId === target.id} className="radar-contact-hitbox" onClick={() => setSelectedRadarTargetId(target.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedRadarTargetId(target.id); } }}>
                <g transform={"translate(" + point.x + " " + point.y + ")"}>
                {estimatedTarget && <path d={"M0 0 L" + vector.dx + " " + vector.dy} className="target-vector"/>}
                {estimatedTarget && vectorLength > 0 && <path d={arrowHead} className="target-vector-head"/>}
                <circle r={selectedRadarTargetId === target.id ? 9 : 7} className={selectedRadarTargetId === target.id ? "target-echo selected" : "target-echo"}/>
                <text x="12" y="4">{target.id}</text>
                <text x="12" y="17" className="target-course-label">{estimatedTarget ? estimatedTarget.courseDeg.toFixed(0) + "°T" : "RADAR ECHO"}</text>
                </g>
              </g>;
            })}
            <g transform={"translate(" + x + " " + y + ") rotate(" + ship.headingDeg + ")"}><path d="M0 -18 L10 15 L0 9 L-10 15 Z" className="own-ship"/></g>
            <text x="260" y="28">N</text><text x="260" y="270">OWN SHIP</text>
          </svg>
          <div className="radar-legend"><span><i className="dot own-dot"/>Собственное судно</span><span><i className="dot target-dot"/>Цели</span><span><i className="dot trail-dot"/>След цели</span><span>Шкала: 3 NM</span></div>
          <div className="radar-tools">
            <div className="radar-tool"><div className="control-title"><label htmlFor="ebl-bearing">EBL · Истинный пеленг</label><strong>{eblBearingDeg.toFixed(0)}° T</strong></div><input id="ebl-bearing" type="range" min="0" max="359" step="1" value={eblBearingDeg} onChange={(event) => setEblBearingDeg(Number(event.target.value))}/><div className="range-labels"><span>000°</span><span>359°</span></div></div>
            <div className="radar-tool"><div className="control-title"><label htmlFor="vrm-range">VRM · Дистанция</label><strong>{vrmRangeNm.toFixed(1)} NM</strong></div><input id="vrm-range" type="range" min="0.1" max="3" step="0.1" value={vrmRangeNm} onChange={(event) => setVrmRangeNm(Number(event.target.value))}/><div className="range-labels"><span>0.1 NM</span><span>3.0 NM</span></div></div>
          </div>
          <div className="radar-selection-panel">
            <div className="panel-heading"><div><span className="eyebrow">MANUAL PLOTTING</span><h2>Измерение выбранной цели</h2></div><span className="unit">{selectedMeasurement ? selectedMeasurement.id : "ЦЕЛЬ НЕ ВЫБРАНА"}</span></div>
            {selectedMeasurement ? <>
              <div className="measurement-readouts">
                <Metric label="ИСТИННЫЙ ПЕЛЕНГ" value={selectedMeasurement.bearingDeg.toFixed(1) + "° T"}/>
                <Metric label="ДИСТАНЦИЯ" value={selectedMeasurement.rangeNm.toFixed(2) + " NM"}/>
                <Metric label="ОТКЛОНЕНИЕ ОТ EBL" value={(eblDifference! >= 0 ? "+" : "−") + Math.abs(eblDifference!).toFixed(1) + "°"}/>
                <Metric label="ОТКЛОНЕНИЕ ОТ VRM" value={(selectedMeasurement.rangeNm - vrmRangeNm >= 0 ? "+" : "−") + Math.abs(selectedMeasurement.rangeNm - vrmRangeNm).toFixed(2) + " NM"}/>
              </div>
              <div className="selection-actions">
                <span>{selectedTrack ? "Цель уже захвачена в ARPA" : "Цель выбрана на радиолокационной отметке"}</span>
                {selectedTrack
                  ? <button className="secondary arpa-action" onClick={() => releaseTarget(selectedMeasurement.id)}>Снять захват</button>
                  : <button className="primary arpa-action" onClick={() => acquireTarget(selectedMeasurement.id)}>Захватить ARPA</button>}
              </div>
            </> : <p className="cpa-note">Нажмите на отметку цели на PPI, чтобы получить измеренный истинный пеленг и дистанцию. Для выбора с клавиатуры используйте Tab и Enter.</p>}
          </div>
        </section>
        <div className="control-column">
          <section className="panel">
            <div className="panel-heading"><div><span className="eyebrow">МОСТИК</span><h2>Органы управления</h2></div></div>
            <div className="control-block">
              <div className="control-title"><label htmlFor="throttle">Телеграф двигателя</label><strong>{Math.round(ship.throttlePercent)}%</strong></div>
              <input id="throttle" type="range" min="0" max="100" step="1" value={ship.throttlePercent} onChange={(e)=>updateShip(s=>({...s,throttlePercent:Number(e.target.value)}))}/>
              <div className="range-labels"><span>STOP</span><span>FULL AHEAD</span></div>
            </div>
            <div className="control-block">
              <div className="control-title"><label htmlFor="rudder">Угол руля</label><strong>{ship.rudderDeg.toFixed(0)}°</strong></div>
              <input id="rudder" type="range" min="-35" max="35" step="1" value={ship.rudderDeg} onChange={(e)=>updateShip(s=>({...s,rudderDeg:Number(e.target.value)}))}/>
              <div className="range-labels"><span>35° ЛЕВО</span><span>35° ПРАВО</span></div><div className="actual-rudder">Фактический угол: {ship.actualRudderDeg.toFixed(1)}°</div>
            </div>
            <div className="action-row">
              <button className="primary" onClick={()=>setRunning(v=>!v)}>{running ? "Пауза" : "Пуск"}</button>
              <button className="secondary" onClick={reset}><RotateCcw size={15}/>Сброс</button>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading"><div><span className="eyebrow">ТЕКУЩИЕ ДАННЫЕ</span><h2>Параметры движения</h2></div></div>
            <div className="metrics-grid">
              <Metric label="СКОРОСТЬ" value={ship.speedKn.toFixed(2) + " kn"}/>
              <Metric label="КУРС" value={ship.headingDeg.toFixed(1) + "° T"}/>
              <Metric label="ROT" value={(ship.yawRateDegPerSec*60).toFixed(1) + "°/min"}/>
              <Metric label="ВРЕМЯ" value={formatTime(ship.elapsedSeconds)}/>
              <Metric label="EAST" value={ship.eastNm.toFixed(3) + " NM"}/>
              <Metric label="NORTH" value={ship.northNm.toFixed(3) + " NM"}/>
            </div>
          </section>
        </div>
      </div>
      <section className="panel cpa-panel">
        <div className="panel-heading"><div><span className="eyebrow">РАСЧЁТ В РЕАЛЬНОМ ВРЕМЕНИ</span><h2>Геометрическая оценка без захвата</h2></div><Target size={18}/></div>
        <div className="cpa-table-wrap"><table className="cpa-table"><thead><tr><th>Цель</th><th>Пеленг</th><th>Дистанция</th><th>TCPA</th><th>DCPA</th></tr></thead><tbody>
          {targetCpa.map(({target,cpa}) => <tr key={target.id}><td>{target.id}</td><td>{cpa ? cpa.bearingDeg.toFixed(1) + "°" : "—"}</td><td>{cpa ? cpa.rangeNm.toFixed(2) + " NM" : "—"}</td><td>{cpa ? formatMinutes(cpa.tcpaMin) : "—"}</td><td>{cpa ? cpa.dcpaNm.toFixed(2) + " NM" : "—"}</td></tr>)}
        </tbody></table></div>
        <p className="cpa-note">Позиции целей и собственного судна обновляются с фиксированным шагом 0,1 с. CPA/TCPA пересчитываются по текущим векторам при каждом кадре интерфейса. Это расчёт по заданным сценарным векторам. Для оценки по измерениям используйте отдельный блок ARPA ниже.</p>
      </section>
      <section className="panel cpa-panel arpa-panel">
        <div className="panel-heading"><div><span className="eyebrow">AUTOMATIC RADAR PLOTTING AID</span><h2>ARPA · Захват и сопровождение</h2></div><span className="unit">{Object.keys(arpaTracks).length} ЗАХВАЧЕНО</span></div>
        <div className="arpa-alert-settings">
          <label>Порог DCPA, NM <input type="number" min="0" max="10" step="0.1" value={alertDcpaNm} onChange={(event) => setAlertDcpaNm(Math.max(0, Math.min(10, Number(event.target.value) || 0)))}/></label>
          <label>Окно TCPA, min <input type="number" min="1" max="120" step="1" value={alertTcpaMinutes} onChange={(event) => setAlertTcpaMinutes(Math.max(1, Math.min(120, Number(event.target.value) || 1)))}/></label>
          <span>Учебные пороги, не норматив COLREG</span>
        </div>
        <div className="trial-controls">
          <div><span className="eyebrow">TRIAL MANOEUVRE · ПРОБНЫЙ МАНЁВР</span><p>Расчёт прогнозируемого CPA/TCPA при гипотетическом курсе и скорости собственного судна. Реальное управление не меняется.</p></div>
          <label>Пробный курс, °T <input type="number" min="0" max="359" step="1" value={trialCourseDeg} onChange={(event) => setTrialCourseDeg(Math.max(0, Math.min(359, Number(event.target.value) || 0)))}/></label>
          <label>Пробная скорость, kn <input type="number" min="0" max="30" step="0.5" value={trialSpeedKn} onChange={(event) => setTrialSpeedKn(Math.max(0, Math.min(30, Number(event.target.value) || 0)))}/></label>
          <button type="button" className="secondary arpa-action" onClick={() => { setTrialCourseDeg(ownVessel.courseDeg); setTrialSpeedKn(ownVessel.speedKn); }}>Текущие параметры</button>
        </div>
        <div className="cpa-table-wrap"><table className="cpa-table arpa-table"><thead><tr><th>ARPA-трек</th><th>Радарная отметка</th><th>Статус</th><th>Курс / скорость</th><th>TCPA</th><th>DCPA</th><th>Trial TCPA</th><th>Trial DCPA</th><th>Событие</th><th>Тревога</th><th>Действие</th></tr></thead><tbody>
          {Object.values(arpaTracks).map((track) => {
            const latestMeasurement = radarMeasurements.find((item) => item.id === track.associatedRadarId) ??
              (track.measurements.length ? track.measurements[track.measurements.length - 1] : null);
            const solution = latestMeasurement ? calculateArpaSolution(track, latestMeasurement, ownVessel) : null;
            const trialSolution = latestMeasurement ? calculateTrialManoeuvre(track, latestMeasurement, ownVessel, { courseDeg: trialCourseDeg, speedKn: trialSpeedKn }) : null;
            const closeApproachAlert = solution ? isArpaCloseApproachAlert(track, solution, { minimumDcpaNm: alertDcpaNm, maximumTcpaMinutes: alertTcpaMinutes }) : false;
            const statusLabel = track.status === "acquiring" ? "Захват" : track.status === "tracking" ? "Сопровождение" : "Lost";
            return <tr key={track.targetId}>
              <td>{track.targetId}</td>
              <td>{track.associatedRadarId}</td>
              <td><span className={"arpa-status " + track.status}>{statusLabel}</span></td>
              <td>{track.estimatedCourseDeg !== null && track.estimatedSpeedKn !== null ? track.estimatedCourseDeg.toFixed(1) + "°T / " + track.estimatedSpeedKn.toFixed(1) + " kn" : "Недостаточно данных"}</td>
              <td>{solution ? formatMinutes(solution.tcpaMin) : "—"}</td>
              <td>{solution?.dcpaNm !== null && solution?.dcpaNm !== undefined ? solution.dcpaNm.toFixed(2) + " NM" : "—"}</td>
              <td>{trialSolution ? formatMinutes(trialSolution.tcpaMin) : "—"}</td>
              <td>{trialSolution?.dcpaNm !== null && trialSolution?.dcpaNm !== undefined ? trialSolution.dcpaNm.toFixed(2) + " NM" : "—"}</td>
              <td><span className={track.swapDetected ? "arpa-swap active" : "arpa-swap"}>{track.swapDetected ? "TARGET SWAP" : track.swapCount > 0 ? "SWAP ×" + track.swapCount : "—"}</span></td>
              <td><span className={closeApproachAlert ? "arpa-alert active" : "arpa-alert"}>{closeApproachAlert ? "ОПАСНОЕ СБЛИЖЕНИЕ" : "—"}</span></td>
              <td><button className="secondary arpa-action" onClick={() => releaseTarget(track.targetId)}>Снять</button></td>
            </tr>;
          })}
          {Object.keys(arpaTracks).length === 0 && <tr><td colSpan={11}>Выберите радиолокационную отметку на PPI и выполните ручной захват.</td></tr>}
        </tbody></table></div>
        <p className="cpa-note">Захват выполняется вручную по радиолокационной отметке. Сопровождение использует только завершённые обзоры радара. Lost фиксируется после трёх пропущенных обзоров (7,5 с). При повторном обнаружении той же отметки трек захватывается заново без старой истории. Target Swap выявляется по прогнозируемому положению и однозначному сопоставлению отметок с активными треками; это упрощённая детерминированная модель, а не сертифицированный алгоритм. Trial Manoeuvre пересчитывает CPA/TCPA для заданных пробных курса и скорости, не меняя реальное движение судна. Тревога — учебная, не норматив COLREG.</p>
      </section>
      <section className="panel debrief-panel">
        <div className="eyebrow">КОНТРОЛЬНЫЕ ВОПРОСЫ</div><h2>Разбор после выполнения</h2>
        <ul>{activeScenario.debrief.map((item,index)=><li key={index}>{item}</li>)}</ul>
      </section>
      <div className="notice"><b>Ограничение учебной модели:</b> искусственные шумы и пропуски отметок отключены; обзор обновляется каждые 2,5 секунды. Нет моделирования диаграммы направленности антенны, мощности передатчика, отражательной способности, затенения, многолучёвости, Sea/Rain Clutter и ложных целей. Исторический след строится только по реально полученным радиолокационным отметкам; при пропуске обзора новая точка не добавляется. ARPA не является сертифицированным прибором. Сценарии предназначены для обучения, а не для реального судовождения.</div>
    </section>
  </main>;
}
