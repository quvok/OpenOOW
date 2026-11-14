import { useEffect, useRef, useState } from "react";
import { Anchor, Gauge, RotateCcw, Ship, Waves } from "lucide-react";
import { advanceFixedSteps } from "../core/simulationEngine";
import { INITIAL_SHIP_STATE, stepShip, type ShipDynamicsState } from "../core/shipDynamics";

const STEP_SECONDS = 0.1;
const RADAR_RANGE_NM = 1.5;

function formatTime(seconds: number) {
  const total = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  return pad(Math.floor(total / 3600)) + ":" + pad(Math.floor((total % 3600) / 60)) + ":" + pad(total % 60);
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><b>{value}</b></div>;
}

export default function App() {
  const [ship, setShip] = useState<ShipDynamicsState>(INITIAL_SHIP_STATE);
  const [running, setRunning] = useState(false);
  const shipRef = useRef<ShipDynamicsState>(INITIAL_SHIP_STATE);
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

        const result = advanceFixedSteps(
          shipRef.current,
          elapsedSeconds,
          accumulatorRef.current,
          STEP_SECONDS,
          stepShip,
        );

        shipRef.current = result.state;
        accumulatorRef.current = result.accumulatorSeconds;
        if (result.stepsExecuted > 0) setShip(result.state);
      }

      frameId = window.requestAnimationFrame(frame);
    };

    frameId = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(frameId);
  }, [running]);

  const reset = () => {
    setRunning(false);
    accumulatorRef.current = 0;
    shipRef.current = INITIAL_SHIP_STATE;
    setShip(INITIAL_SHIP_STATE);
  };

  const x = 250 + (ship.eastNm / RADAR_RANGE_NM) * 220;
  const y = 250 - (ship.northNm / RADAR_RANGE_NM) * 220;

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><Ship size={24}/><span>OpenOOW</span></div>
      <div className="side-label">ТРЕНАЖЁР</div>
      <div className="side-link active"><Gauge size={17}/>Динамика судна</div>
      <div className="side-link"><Anchor size={17}/>Маневрирование</div>
      <div className="side-link"><Waves size={17}/>Внешняя среда</div>
      <div className="sidebar-foot">SIM CORE · 0.3.0</div>
    </aside>
    <section className="workspace">
      <header className="topbar">
        <div><div className="eyebrow">OPENOOW / ПРОТОТИП</div><h1>Динамика собственного судна</h1></div>
        <div className={running ? "status live" : "status"}><i/>{running ? "СИМУЛЯЦИЯ ЗАПУЩЕНА" : "ПАУЗА"}</div>
      </header>
      <div className="main-grid">
        <section className="panel radar-panel">
          <div className="panel-heading"><div><span className="eyebrow">ВИД СВЕРХУ</span><h2>Положение судна</h2></div><span className="unit">NORTH UP · 1.5 NM</span></div>
          <svg className="radar-view" viewBox="0 0 500 500" role="img" aria-label="Положение и курс собственного судна">
            <circle cx="250" cy="250" r="235" className="radar-bg"/>
            {[58,117,176,235].map((r)=><circle key={r} cx="250" cy="250" r={r} className="radar-ring"/>)}
            <path d="M250 15V485 M15 250H485" className="radar-cross"/>
            <path d={"M250 250 L" + x + " " + y} className="track-line"/>
            <g transform={"translate(" + x + " " + y + ") rotate(" + ship.headingDeg + ")"}><path d="M0 -18 L10 15 L0 9 L-10 15 Z" className="own-ship"/></g>
            <text x="260" y="28">N</text><text x="260" y="270">OWN SHIP</text>
          </svg>
          <div className="radar-legend"><span><i className="dot own-dot"/>Собственное судно</span><span>Шкала: ±1.5 NM</span></div>
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
      <div className="notice"><b>О модели:</b> расчёт выполняется ядром с фиксированным шагом 0,1 с. Интерфейс только передаёт команды и отображает состояние. Динамика остаётся упрощённой кинематической моделью, не полноценной гидродинамикой и не навигационным прибором.</div>
    </section>
  </main>;
}
