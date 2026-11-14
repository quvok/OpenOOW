import { useEffect, useRef, useState } from "react";
import { Anchor, Gauge, RotateCcw, Ship, Waves, Target } from "lucide-react";
import { advanceFixedSteps } from "../core/simulationEngine";
import { advanceVessel, calculateCpa, type VesselState } from "../core/navigation";
import { courseVectorToRadar, projectRelativePosition } from "../core/radar";
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
  const [targets, setTargets] = useState<VesselState[]>(() => ENCOUNTER_SCENARIOS[0].targets.map((target) => ({ ...target })));
  const shipRef = useRef<ShipDynamicsState>(ship);
  const targetsRef = useRef<VesselState[]>(targets);
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
          { ownShip: shipRef.current, targets: targetsRef.current },
          elapsedSeconds,
          accumulatorRef.current,
          STEP_SECONDS,
          (current, dtSeconds) => ({
            ownShip: stepShip(current.ownShip, dtSeconds),
            targets: current.targets.map((target) => advanceVessel(target, dtSeconds)),
          }),
        );

        shipRef.current = result.state.ownShip;
        targetsRef.current = result.state.targets;
        accumulatorRef.current = result.accumulatorSeconds;
        if (result.stepsExecuted > 0) {
          setShip(result.state.ownShip);
          setTargets(result.state.targets);
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
    const nextTargets = scenario.targets.map((target) => ({ ...target }));
    targetsRef.current = nextTargets;
    setTargets(nextTargets);
  };

  const reset = () => {
    setRunning(false);
    accumulatorRef.current = 0;
    const resetShip = createScenarioShipState(activeScenario);
    shipRef.current = resetShip;
    setShip(resetShip);
    const resetTargets = activeScenario.targets.map((target) => ({ ...target }));
    targetsRef.current = resetTargets;
    setTargets(resetTargets);
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

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><Ship size={24}/><span>OpenOOW</span></div>
      <div className="side-label">ТРЕНАЖЁР</div>
      <div className="side-link active"><Gauge size={17}/>Динамика судна</div>
      <div className="side-link"><Anchor size={17}/>Маневрирование</div>
      <div className="side-link"><Waves size={17}/>Внешняя среда</div>
      <div className="sidebar-foot">SIM CORE · 0.6.0</div>
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
          <div className="panel-heading"><div><span className="eyebrow">СИТУАЦИОННАЯ КАРТИНА</span><h2>Положение судов</h2></div><span className="unit">NORTH UP · 3 NM · VECTOR 6 MIN</span></div>
          <svg className="radar-view" viewBox="0 0 500 500" role="img" aria-label="Схема взаимного положения судов">
            <circle cx="250" cy="250" r="235" className="radar-bg"/>
            {[58,117,176,235].map((r)=><circle key={r} cx="250" cy="250" r={r} className="radar-ring"/>)
            }
            <path d="M250 15V485 M15 250H485" className="radar-cross"/>
            <circle cx={x} cy={y} r={vrmRadiusPx} className="vrm-ring"/>
            <path d={"M" + x + " " + y + " L" + eblX + " " + eblY} className="ebl-line"/>
            <text x={x + 9} y={y - 10}>EBL {eblBearingDeg.toFixed(0)}°T</text>
            {targets.map((target) => {
              const point = projectRelativePosition(ownVessel, target, RADAR_RANGE_NM, RADAR_RADIUS_PX, RADAR_CENTER);
              const vector = courseVectorToRadar(target.courseDeg, target.speedKn, RADAR_VECTOR_MINUTES, RADAR_RANGE_NM, RADAR_RADIUS_PX);
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
              return <g key={target.id} transform={"translate(" + point.x + " " + point.y + ")"}>
                <path d={"M0 0 L" + vector.dx + " " + vector.dy} className="target-vector"/>
                {vectorLength > 0 && <path d={arrowHead} className="target-vector-head"/>}
                <circle r="7" className="target-echo"/>
                <text x="12" y="4">{target.id}</text>
                <text x="12" y="17" className="target-course-label">{target.courseDeg.toFixed(0)}°T</text>
              </g>;
            })}
            <g transform={"translate(" + x + " " + y + ") rotate(" + ship.headingDeg + ")"}><path d="M0 -18 L10 15 L0 9 L-10 15 Z" className="own-ship"/></g>
            <text x="260" y="28">N</text><text x="260" y="270">OWN SHIP</text>
          </svg>
          <div className="radar-legend"><span><i className="dot own-dot"/>Собственное судно</span><span><i className="dot target-dot"/>Цели</span><span>Шкала: 3 NM</span></div>
          <div className="radar-tools">
            <div className="radar-tool"><div className="control-title"><label htmlFor="ebl-bearing">EBL · Истинный пеленг</label><strong>{eblBearingDeg.toFixed(0)}° T</strong></div><input id="ebl-bearing" type="range" min="0" max="359" step="1" value={eblBearingDeg} onChange={(event) => setEblBearingDeg(Number(event.target.value))}/><div className="range-labels"><span>000°</span><span>359°</span></div></div>
            <div className="radar-tool"><div className="control-title"><label htmlFor="vrm-range">VRM · Дистанция</label><strong>{vrmRangeNm.toFixed(1)} NM</strong></div><input id="vrm-range" type="range" min="0.1" max="3" step="0.1" value={vrmRangeNm} onChange={(event) => setVrmRangeNm(Number(event.target.value))}/><div className="range-labels"><span>0.1 NM</span><span>3.0 NM</span></div></div>
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
        <div className="panel-heading"><div><span className="eyebrow">РАСЧЁТ В РЕАЛЬНОМ ВРЕМЕНИ</span><h2>Текущая оценка целей</h2></div><Target size={18}/></div>
        <div className="cpa-table-wrap"><table className="cpa-table"><thead><tr><th>Цель</th><th>Пеленг</th><th>Дистанция</th><th>TCPA</th><th>DCPA</th></tr></thead><tbody>
          {targetCpa.map(({target,cpa}) => <tr key={target.id}><td>{target.id}</td><td>{cpa ? cpa.bearingDeg.toFixed(1) + "°" : "—"}</td><td>{cpa ? cpa.rangeNm.toFixed(2) + " NM" : "—"}</td><td>{cpa ? formatMinutes(cpa.tcpaMin) : "—"}</td><td>{cpa ? cpa.dcpaNm.toFixed(2) + " NM" : "—"}</td></tr>)}
        </tbody></table></div>
        <p className="cpa-note">Позиции целей и собственного судна обновляются с фиксированным шагом 0,1 с. CPA/TCPA пересчитываются по текущим векторам при каждом кадре интерфейса. Это геометрический прогноз при сохранении текущих курсов и скоростей, а не ARPA-сопровождение и не прогноз с учётом будущих манёвров.</p>
      </section>
      <section className="panel debrief-panel">
        <div className="eyebrow">КОНТРОЛЬНЫЕ ВОПРОСЫ</div><h2>Разбор после выполнения</h2>
        <ul>{activeScenario.debrief.map((item,index)=><li key={index}>{item}</li>)}</ul>
      </section>
      <div className="notice"><b>Ограничение учебной модели:</b> цели движутся по заданным постоянным курсам и скоростям. Их манёвры, ускорение, дрейф, ветер и течение пока не моделируются. Пересчёт CPA/TCPA не является полноценным ARPA и не оценивает автоматически правильность манёвра. Сценарии предназначены для обучения, а не для реального судовождения.</div>
    </section>
  </main>;
}
