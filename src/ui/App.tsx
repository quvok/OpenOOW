import { useEffect, useRef, useState } from "react";
import { Anchor, Gauge, RotateCcw, Ship, Waves, Target } from "lucide-react";
import { advanceFixedSteps } from "../core/simulationEngine";
import { advanceVessel, calculateCpa, velocityFromCourse, type VesselState } from "../core/navigation";
import { motionVectorToRadar, projectRelativePosition, type RadarVectorMode } from "../core/radar";
import { createRadarMeasurementTrackHistory, recordRadarMeasurementTracks } from "../core/radarTracks";
import { acquireArpaTarget, calculateArpaSolution, calculateBowCrossing, calculateDynamicTrialManoeuvre, updateArpaTracks, isArpaCloseApproachAlert, DEFAULT_ARPA_ALERT_CONFIG, DEFAULT_ARPA_LOST_AFTER_SECONDS, type ArpaTrackSet } from "../core/arpa";
import { DEFAULT_RADAR_CONFIG, isRadarScanDue, measureRadarContacts, type RadarScanClock } from "../core/radarMeasurements";
import { INITIAL_SHIP_STATE, stepShip, type ShipDynamicsState } from "../core/shipDynamics";
import { createAutopilotState, stepAutopilot, type AutopilotState } from "../core/autopilot";
import { ENCOUNTER_SCENARIOS, getScenarioTargetCpa, type EncounterScenario } from "../core/scenarios";
import { assessColregEncounter, evaluateColregManeuver, type Tack } from "../core/colreg";
import type { ColregVesselKind } from "../core/colregSignals";
import { getLightVisibilityMinimums, getRestrictedVisibilitySignal, getSoundSignals, LIGHT_DEFINITIONS } from "../core/colregSignals";
import { COLREG_RULES } from "../core/colregRules";
import EcdisModule from "./EcdisModule";

const STEP_SECONDS = 0.1;
const RADAR_RANGE_NM = 3;
const RADAR_CENTER = 250;
const RADAR_RADIUS_PX = 220;

const COLREG_VESSEL_OPTIONS: Array<{ value: ColregVesselKind; label: string }> = [
  { value: "power-driven", label: "Механическое судно" },
  { value: "sailing", label: "Парусное судно" },
  { value: "fishing", label: "Рыболовное судно" },
  { value: "nuc", label: "Не способно управляться (NUC)" },
  { value: "ram", label: "Ограничено в маневренности (RAM)" },
  { value: "constrained-draught", label: "Ограничено осадкой (CBD)" },
  { value: "pilot", label: "Лоцманское судно" },
  { value: "towing", label: "Буксирующее судно" },
  { value: "anchored", label: "На якоре" },
  { value: "aground", label: "На мели" },
  { value: "seaplane", label: "Гидросамолёт" },
  { value: "wig-craft", label: "WIG — судно на динамической воздушной подушке" },
  { value: "other", label: "Не определено" },
];

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
  const [scenarioDialogOpen, setScenarioDialogOpen] = useState(false);
  const [activeScenario, setActiveScenario] = useState<EncounterScenario>(ENCOUNTER_SCENARIOS[0]);
  const [ship, setShip] = useState<ShipDynamicsState>(() => createScenarioShipState(ENCOUNTER_SCENARIOS[0]));
  const [running, setRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<"radar" | "ecdis">("radar");
  const [autopilot, setAutopilot] = useState<AutopilotState>(() => createAutopilotState());
  const [eblBearingDeg, setEblBearingDeg] = useState(0);
  const [vrmRangeNm, setVrmRangeNm] = useState(1.5);
  const [vectorMode, setVectorMode] = useState<RadarVectorMode>("true");
  const [vectorMinutes, setVectorMinutes] = useState(6);
  const [trialCourseDeg, setTrialCourseDeg] = useState(ENCOUNTER_SCENARIOS[0].ownShip.courseDeg);
  const [trialSpeedKn, setTrialSpeedKn] = useState(ENCOUNTER_SCENARIOS[0].ownShip.speedKn);
  const [trialDelayMin, setTrialDelayMin] = useState(3);
  const [trialRotDegPerMin, setTrialRotDegPerMin] = useState(3);
  const [trialAcceleration, setTrialAcceleration] = useState(0.5);
  const [trialDeceleration, setTrialDeceleration] = useState(0.5);
  const [trialHorizonMin, setTrialHorizonMin] = useState(20);
  const [targetInfoMenuOpen, setTargetInfoMenuOpen] = useState(false);
  const [targetInfoPage, setTargetInfoPage] = useState("overview");
  const [selectedRadarTargetId, setSelectedRadarTargetId] = useState<string | null>(null);
  const [targetInfoTab, setTargetInfoTab] = useState<string>("multiple");
  const [targets, setTargets] = useState<VesselState[]>(() => ENCOUNTER_SCENARIOS[0].targets.map((target) => ({ ...target })));
  const [radarMeasurements, setRadarMeasurements] = useState(() => measureRadarContacts({ xNm: 0, yNm: 0 }, ENCOUNTER_SCENARIOS[0].targets, 0, 0));
  const [tracks, setTracks] = useState(() => createRadarMeasurementTrackHistory(radarMeasurements, { xNm: 0, yNm: 0 }));
  const [arpaTracks, setArpaTracks] = useState<ArpaTrackSet>({});
  const [alertDcpaNm, setAlertDcpaNm] = useState(DEFAULT_ARPA_ALERT_CONFIG.minimumDcpaNm);
  const [alertTcpaMinutes, setAlertTcpaMinutes] = useState(DEFAULT_ARPA_ALERT_CONFIG.maximumTcpaMinutes);
  const [colregOwnKind, setColregOwnKind] = useState<ColregVesselKind>("power-driven");
  const [colregTargetKind, setColregTargetKind] = useState<ColregVesselKind>("power-driven");
  const [colregOwnFishing, setColregOwnFishing] = useState(false);
  const [colregTargetFishing, setColregTargetFishing] = useState(false);
  const [colregOwnMotorUnderSail, setColregOwnMotorUnderSail] = useState(false);
  const [colregTargetMotorUnderSail, setColregTargetMotorUnderSail] = useState(false);
  const [colregOwnWigOnSurface, setColregOwnWigOnSurface] = useState(false);
  const [colregOwnMakingWay, setColregOwnMakingWay] = useState(false);
  const [colregTargetMakingWay, setColregTargetMakingWay] = useState(true);
  const [colregTargetWigOnSurface, setColregTargetWigOnSurface] = useState(false);
  const [colregOwnSeaplaneOnWater, setColregOwnSeaplaneOnWater] = useState(false);
  const [colregTargetSeaplaneOnWater, setColregTargetSeaplaneOnWater] = useState(false);
  const [colregOwnLengthM, setColregOwnLengthM] = useState(50);
  const [colregTargetLengthM, setColregTargetLengthM] = useState(50);
  const [colregOwnTack, setColregOwnTack] = useState<Tack>("unknown");
  const [colregTargetTack, setColregTargetTack] = useState<Tack>("unknown");
  const [colregOwnWindward, setColregOwnWindward] = useState("unknown");
  const [colregTargetWindward, setColregTargetWindward] = useState("unknown");
  const [colregVisibility, setColregVisibility] = useState<"good" | "restricted">("good");
  const [colregVesselsInSight, setColregVesselsInSight] = useState(true);
  const [colregDaylight, setColregDaylight] = useState(false);
  const [colregNarrowChannel, setColregNarrowChannel] = useState(false);
  const [colregTss, setColregTss] = useState(false);
  const [colregCrossingTss, setColregCrossingTss] = useState(false);
  const [colregTargetFollowingLane, setColregTargetFollowingLane] = useState(false);
  const [colregTargetChannelLimited, setColregTargetChannelLimited] = useState(false);
  const [colregTargetNavigatingChannel, setColregTargetNavigatingChannel] = useState(false);
  const [colregOwnInshoreZone, setColregOwnInshoreZone] = useState(false);
  const [colregTargetWindwardOfOwn, setColregTargetWindwardOfOwn] = useState("unknown");
  const [colregOwnOvertakingNotClear, setColregOwnOvertakingNotClear] = useState(false);
  const [colregTargetOvertakingNotClear, setColregTargetOvertakingNotClear] = useState(false);
  const shipRef = useRef<ShipDynamicsState>(ship);
  const autopilotRef = useRef<AutopilotState>(autopilot);
  const targetsRef = useRef<VesselState[]>(targets);
  const tracksRef = useRef(tracks);
  const arpaTracksRef = useRef<ArpaTrackSet>({});
  const radarMeasurementsRef = useRef(radarMeasurements);
  const radarScanClockRef = useRef<RadarScanClock>({ lastScanSeconds: 0, scanNumber: 0 });
  const accumulatorRef = useRef(0);

  const updateAutopilot = (update: (current: AutopilotState) => AutopilotState) => {
    const next = update(autopilotRef.current);
    autopilotRef.current = next;
    setAutopilot(next);
  };

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
          { ownShip: shipRef.current, autopilot: autopilotRef.current, targets: targetsRef.current, tracks: tracksRef.current, arpa: arpaTracksRef.current, radarMeasurements: radarMeasurementsRef.current, radarScan: radarScanClockRef.current },
          elapsedSeconds,
          accumulatorRef.current,
          STEP_SECONDS,
          (current, dtSeconds) => {
            const autopilotStep = stepAutopilot(current.autopilot, current.ownShip, dtSeconds);
            const shipCommand = autopilotStep.rudderCommandDeg === null
              ? current.ownShip
              : { ...current.ownShip, rudderDeg: autopilotStep.rudderCommandDeg };
            const nextOwnShip = stepShip(shipCommand, dtSeconds);
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
              autopilot: autopilotStep.state,
              targets: nextTargets,
              tracks: nextTracks,
              arpa: nextArpa,
              radarMeasurements: nextMeasurements,
              radarScan: nextScan,
            };
          },
        );

        shipRef.current = result.state.ownShip;
        autopilotRef.current = result.state.autopilot;
        targetsRef.current = result.state.targets;
        tracksRef.current = result.state.tracks;
        arpaTracksRef.current = result.state.arpa;
        radarMeasurementsRef.current = result.state.radarMeasurements;
        radarScanClockRef.current = result.state.radarScan;
        accumulatorRef.current = result.accumulatorSeconds;
        if (result.stepsExecuted > 0) {
          setShip(result.state.ownShip);
          setAutopilot(result.state.autopilot);
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
    setSelectedRadarTargetId(null);
    accumulatorRef.current = 0;
    const nextShip = createScenarioShipState(scenario);
    const standbyAutopilot = createAutopilotState(nextShip.headingDeg);
    autopilotRef.current = standbyAutopilot;
    setAutopilot(standbyAutopilot);
    shipRef.current = nextShip;
    setShip(nextShip);
    setActiveScenario(scenario);
    const colregContext = scenario.colregContext;
    const ownContext = colregContext?.ownProfile;
    const targetContext = colregContext?.targetProfile;
    const environmentContext = colregContext?.environment;
    setColregOwnKind(ownContext?.kind ?? "power-driven");
    setColregTargetKind(targetContext?.kind ?? "power-driven");
    setColregOwnFishing(ownContext?.engagedInFishing ?? false);
    setColregTargetFishing(targetContext?.engagedInFishing ?? false);
    setColregOwnMotorUnderSail(ownContext?.underSailAndPower ?? false);
    setColregTargetMotorUnderSail(targetContext?.underSailAndPower ?? false);
    setColregOwnWigOnSurface(ownContext?.wigOnSurface ?? false);
    setColregTargetWigOnSurface(targetContext?.wigOnSurface ?? false);
    setColregOwnSeaplaneOnWater(ownContext?.seaplaneOnWater ?? false);
    setColregTargetSeaplaneOnWater(targetContext?.seaplaneOnWater ?? false);
    setColregOwnMakingWay(ownContext?.makingWay ?? scenario.ownShip.speedKn > 0);
    setColregTargetMakingWay(targetContext?.makingWay ?? (scenario.targets[0]?.speedKn ?? 0) > 0);
    setColregOwnTack(ownContext?.tack ?? "unknown");
    setColregTargetTack(targetContext?.tack ?? "unknown");
    setColregOwnWindward(ownContext?.windward == null ? "unknown" : ownContext.windward ? "yes" : "no");
    setColregTargetWindward(targetContext?.windward == null ? "unknown" : targetContext.windward ? "yes" : "no");
    setColregOwnLengthM(ownContext?.lengthM ?? 50);
    setColregTargetLengthM(targetContext?.lengthM ?? 50);
    setColregVisibility(environmentContext?.visibility ?? (scenario.visibilityNm <= 2 ? "restricted" : "good"));
    setColregVesselsInSight(environmentContext?.vesselsInSight ?? scenario.visibilityNm > 2);
    setColregDaylight(environmentContext?.daylight ?? false);
    setColregNarrowChannel(environmentContext?.narrowChannel ?? false);
    setColregTss(environmentContext?.trafficSeparationScheme ?? false);
    setColregCrossingTss(environmentContext?.ownCrossingTrafficLane ?? false);
    setColregTargetFollowingLane(environmentContext?.targetFollowingTrafficLane ?? false);
    setColregTargetChannelLimited(environmentContext?.targetCanOnlyNavigateChannel ?? false);
    setColregTargetNavigatingChannel(environmentContext?.targetNavigatingChannel ?? false);
    setColregOwnInshoreZone(environmentContext?.ownInshoreTrafficZone ?? false);
    setColregTargetWindwardOfOwn(environmentContext?.targetWindwardOfOwn == null ? "unknown" : environmentContext.targetWindwardOfOwn ? "yes" : "no");
    setColregOwnOvertakingNotClear(environmentContext?.ownOvertakingNotClear ?? false);
    setColregTargetOvertakingNotClear(environmentContext?.targetOvertakingNotClear ?? false);
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
    const standbyAutopilot = createAutopilotState(resetShip.headingDeg);
    autopilotRef.current = standbyAutopilot;
    setAutopilot(standbyAutopilot);
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
    const alreadyTracked = Object.values(arpaTracksRef.current).some((track) => track.associatedRadarId === targetId || track.targetId === targetId);
    if (!measurement || alreadyTracked) return;
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
  const selectedTrack = selectedRadarTargetId ? Object.values(arpaTracks).find((track) => track.associatedRadarId === selectedRadarTargetId) ?? arpaTracks[selectedRadarTargetId] : undefined;
  const selectedColregHistory = selectedTrack ? tracks[selectedTrack.associatedRadarId] ?? [] : [];
  const latestColregRelativeSample = selectedColregHistory[selectedColregHistory.length - 1];
  const selectedColregTarget: VesselState | null = selectedTrack?.status === "tracking" &&
    selectedTrack.estimatedCourseDeg !== null && selectedTrack.estimatedSpeedKn !== null && latestColregRelativeSample
    ? (() => {
        const targetVelocity = velocityFromCourse(selectedTrack.estimatedCourseDeg, selectedTrack.estimatedSpeedKn);
        const ownVelocity = velocityFromCourse(ownVessel.courseDeg, ownVessel.speedKn);
        const measurementAgeHours = Math.max(0, (ship.elapsedSeconds - latestColregRelativeSample.timeSeconds) / 3600);
        const relativeEastNow = latestColregRelativeSample.xNm + (targetVelocity.eastKn - ownVelocity.eastKn) * measurementAgeHours;
        const relativeNorthNow = latestColregRelativeSample.yNm + (targetVelocity.northKn - ownVelocity.northKn) * measurementAgeHours;
        return {
          id: selectedTrack.targetId,
          xNm: ownVessel.xNm + relativeEastNow,
          yNm: ownVessel.yNm + relativeNorthNow,
          courseDeg: selectedTrack.estimatedCourseDeg,
          speedKn: selectedTrack.estimatedSpeedKn,
        };
      })()
    : null;
  const colregAssessment = selectedColregTarget
    ? assessColregEncounter(ownVessel, selectedColregTarget, {
        ownProfile: { kind: colregOwnKind, engagedInFishing: colregOwnFishing, underSailAndPower: colregOwnMotorUnderSail, wigOnSurface: colregOwnWigOnSurface, seaplaneOnWater: colregOwnSeaplaneOnWater, makingWay: colregOwnMakingWay, tack: colregOwnTack, windward: colregOwnWindward === "unknown" ? null : colregOwnWindward === "yes", lengthM: colregOwnLengthM },
        targetProfile: { kind: colregTargetKind, engagedInFishing: colregTargetFishing, underSailAndPower: colregTargetMotorUnderSail, wigOnSurface: colregTargetWigOnSurface, seaplaneOnWater: colregTargetSeaplaneOnWater, makingWay: colregTargetMakingWay, tack: colregTargetTack, windward: colregTargetWindward === "unknown" ? null : colregTargetWindward === "yes", lengthM: colregTargetLengthM },
        environment: { visibility: colregVisibility, vesselsInSight: colregVesselsInSight, daylight: colregDaylight, narrowChannel: colregNarrowChannel, trafficSeparationScheme: colregTss, ownCrossingTrafficLane: colregCrossingTss, targetFollowingTrafficLane: colregTargetFollowingLane, targetCanOnlyNavigateChannel: colregTargetChannelLimited, targetNavigatingChannel: colregTargetNavigatingChannel, ownInshoreTrafficZone: colregOwnInshoreZone, targetWindwardOfOwn: colregTargetWindwardOfOwn === "unknown" ? null : colregTargetWindwardOfOwn === "yes", ownOvertakingNotClear: colregOwnOvertakingNotClear, targetOvertakingNotClear: colregTargetOvertakingNotClear, bearingHistoryDeg: selectedColregHistory.slice(-8).map((sample) => (Math.atan2(sample.xNm, sample.yNm) * 180 / Math.PI + 360) % 360), rangeHistoryNm: selectedColregHistory.slice(-8).map((sample) => Math.hypot(sample.xNm, sample.yNm)), riskDcpaNm: alertDcpaNm },
      })
    : null;
  const colregResponsibilityLabel = colregAssessment?.responsibility === "give-way" ? "GIVE-WAY"
    : colregAssessment?.responsibility === "stand-on" ? "STAND-ON"
    : colregAssessment?.responsibility === "both-act" ? "BOTH ALTER STARBOARD"
    : colregAssessment?.responsibility === "no-impede" ? "DO NOT IMPEDE"
    : colregAssessment?.responsibility === "no-specific-duty" ? "NO AUTOMATIC PRIORITY" : "CHECK CONTEXT";
  const colregRiskLabel = colregAssessment?.collisionRisk === "risk" ? "CPA RISK"
    : colregAssessment?.collisionRisk === "no-immediate-risk" ? "NO IMMEDIATE RISK" : "CPA N/A";
  const colregRule7Summary = !colregAssessment ? "Нет оценки"
    : colregAssessment.rule7RiskIndication ? "Возможная опасность: пеленг практически постоянен, дистанция уменьшается"
    : "Пеленг: " + (colregAssessment.bearingTrend === "insufficient" ? "недостаточно данных" : colregAssessment.bearingTrend === "stable" ? "стабильный" : "изменяется")
      + " · дистанция: " + (colregAssessment.rangeTrend === "insufficient" ? "недостаточно данных" : colregAssessment.rangeTrend === "decreasing" ? "уменьшается" : colregAssessment.rangeTrend === "increasing" ? "увеличивается" : "без изменения");
  const ownRestrictedSignal = colregVisibility === "restricted" ? getRestrictedVisibilitySignal({ kind: colregOwnKind, lengthM: colregOwnLengthM, underway: colregOwnKind !== "anchored" && colregOwnKind !== "aground", makingWay: colregOwnMakingWay, underSailAndPower: colregOwnMotorUnderSail, wigOnSurface: colregOwnWigOnSurface, seaplaneOnWater: colregOwnSeaplaneOnWater, engagedInFishing: colregOwnFishing }) : null;
  const targetRestrictedSignal = colregVisibility === "restricted" ? getRestrictedVisibilitySignal({ kind: colregTargetKind, lengthM: colregTargetLengthM, underway: colregTargetKind !== "anchored" && colregTargetKind !== "aground", makingWay: colregTargetMakingWay, underSailAndPower: colregTargetMotorUnderSail, wigOnSurface: colregTargetWigOnSurface, seaplaneOnWater: colregTargetSeaplaneOnWater, engagedInFishing: colregTargetFishing }) : null;
  const ownLightRanges = colregAssessment ? getLightVisibilityMinimums(colregOwnLengthM) : null;
  const targetLightRanges = colregAssessment ? getLightVisibilityMinimums(colregTargetLengthM) : null;
  const colregManeuver = selectedColregTarget
    ? evaluateColregManeuver(ownVessel, { ...ownVessel, courseDeg: trialCourseDeg, speedKn: trialSpeedKn }, selectedColregTarget, selectedColregTarget)
    : null;
  const arpaInfoRows = Object.values(arpaTracks).map((track) => {
    const latest = radarMeasurements.find((item) => item.id === track.associatedRadarId) ??
      (track.measurements.length ? track.measurements[track.measurements.length - 1] : null);
    if (!latest) return null;
    return { track, latest, solution: calculateArpaSolution(track, latest, ownVessel), bow: calculateBowCrossing(track, latest, ownVessel) };
  }).filter((row): row is NonNullable<typeof row> => row !== null);
  const selectedInfoRow = arpaInfoRows.find((row) => row.track.targetId === targetInfoTab) ??
    arpaInfoRows.find((row) => row.track.associatedRadarId === selectedRadarTargetId) ?? null;
  const selectedTrialSolution = selectedInfoRow ? calculateDynamicTrialManoeuvre(
    selectedInfoRow.track, selectedInfoRow.latest, ownVessel,
    { courseDeg: trialCourseDeg, speedKn: trialSpeedKn, delayMin: trialDelayMin,
      turnRateDegPerMin: trialRotDegPerMin, accelerationKnPerMin: trialAcceleration,
      decelerationKnPerMin: trialDeceleration, horizonMin: trialHorizonMin },
  ) : null;
  const targetInfoMetricRows = [
    { label: "SRC", values: arpaInfoRows.map(({track}) => track.status === "tracking" ? "ARPA" : track.status === "lost" ? "LOST" : "ACQ") },
    { label: "CPA", values: arpaInfoRows.map(({solution}) => solution.dcpaNm === null ? "—" : solution.dcpaNm.toFixed(2)) },
    { label: "TCPA", values: arpaInfoRows.map(({solution}) => formatMinutes(solution.tcpaMin)) },
    { label: "BRG", values: arpaInfoRows.map(({solution}) => solution.bearingDeg.toFixed(1)) },
    { label: "RNG", values: arpaInfoRows.map(({solution}) => solution.rangeNm.toFixed(2)) },
    { label: "COG", values: arpaInfoRows.map(({track}) => track.estimatedCourseDeg === null ? "—" : track.estimatedCourseDeg.toFixed(1)) },
    { label: "SOG", values: arpaInfoRows.map(({track}) => track.estimatedSpeedKn === null ? "—" : track.estimatedSpeedKn.toFixed(1)) },
    { label: "BCR", values: arpaInfoRows.map(({bow}) => bow.bcrNm === null ? "—" : bow.bcrNm.toFixed(2)) },
    { label: "BCT", values: arpaInfoRows.map(({bow}) => formatMinutes(bow.bctMin)) },
  ];
  const eblDifference = selectedMeasurement ? ((selectedMeasurement.bearingDeg - eblBearingDeg + 540) % 360) - 180 : null;

  return <main className="app-shell">

    <section className="workspace">
      <header className="topbar transas-topbar">
        <div className="equipment-brand"><span className="equipment-mark">O</span><div><b>OPENOOW</b><small>MARITIME NAVIGATION SIMULATOR</small></div></div>
        <div className="equipment-title"><strong>{activeTab === "radar" ? "RADAR / ARPA" : "ECDIS"}</strong><span>{activeTab === "radar" ? activeScenario.title : "ЭЛЕКТРОННАЯ КАРТА И ПЛАНИРОВАНИЕ МАРШРУТА"}</span></div>
        <div className="header-actions">{activeTab === "radar" && <button type="button" className="header-key" onClick={() => setScenarioDialogOpen(true)}>СЦЕНАРИЙ</button>}<div className={running ? "status live" : "status"}><i/>{running ? "SIM RUNNING" : "SIM PAUSED"}</div></div>
      </header>
      <div className="instrument-strip">
        <span><small>HDG</small><b>{ship.headingDeg.toFixed(0)}°T</b></span>
        <span><small>SPD</small><b>{ship.speedKn.toFixed(1)} kn</b></span>
        <span><small>ROT</small><b>{(ship.yawRateDegPerSec*60).toFixed(1)}°/min</b></span>
        {activeTab === "radar" ? <><span><small>RANGE</small><b>{RADAR_RANGE_NM.toFixed(1)} NM</b></span><span><small>SCAN</small><b>2.5 s</b></span></> : <><span><small>POSITION E</small><b>{ship.eastNm.toFixed(2)} NM</b></span><span><small>POSITION N</small><b>{ship.northNm.toFixed(2)} NM</b></span></>}
        <span><small>TIME</small><b>{formatTime(ship.elapsedSeconds)}</b></span>
      </div>
      <nav className="module-tabs" aria-label="Навигационные модули">
        <button type="button" className={activeTab === "radar" ? "module-tab active" : "module-tab"} onClick={() => setActiveTab("radar")}><Target size={14}/> RADAR / ARPA</button>
        <button type="button" className={activeTab === "ecdis" ? "module-tab active" : "module-tab"} onClick={() => setActiveTab("ecdis")}><Anchor size={14}/> ECDIS</button>
      </nav>
      <div className="module-view" hidden={activeTab !== "radar"}>{scenarioDialogOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setScenarioDialogOpen(false); }}>
        <section className="scenario-dialog" role="dialog" aria-modal="true" aria-labelledby="scenario-dialog-title">
          <div className="dialog-heading"><div><span className="eyebrow">TRAINING SCENARIOS</span><h2 id="scenario-dialog-title">Выбор учебной ситуации</h2></div><button type="button" className="dialog-close" onClick={() => setScenarioDialogOpen(false)} aria-label="Закрыть">×</button></div>
          <label className="dialog-label" htmlFor="scenario-select">Сценарий</label>
          <div className="scenario-select-row">
            <select id="scenario-select" aria-label="Выбрать сценарий" value={selectedScenarioId} onChange={(event) => setSelectedScenarioId(event.target.value)}>
              {ENCOUNTER_SCENARIOS.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.title}</option>)}
            </select>
            <button className="primary" onClick={() => { loadScenario(); setScenarioDialogOpen(false); }}>Загрузить</button>
          </div>
          <div className="scenario-description">
            <b>{activeScenario.title}</b><span>{activeScenario.category}</span>
            <p>{activeScenario.description}</p>
            <p><strong>Задача:</strong> {activeScenario.task}</p>
            <p><strong>Нормативная основа:</strong> {activeScenario.ruleReference}</p>
            <div className="scenario-facts"><span>Собственный курс: {activeScenario.ownShip.courseDeg.toFixed(0)}° T</span><span>Скорость: {activeScenario.ownShip.speedKn.toFixed(1)} kn</span><span>Видимость: {activeScenario.visibilityNm.toFixed(1)} NM</span></div>
          </div>
        </section>
      </div>}
      <div className="main-grid radar-console">
        <aside className="console-rail" aria-label="Функциональные клавиши">
          <span className="rail-caption">MENU</span>
          <button type="button" className="console-key" onClick={() => setScenarioDialogOpen(true)}><b>F1</b><span>СЦЕНАРИЙ</span></button>
          <button type="button" className="console-key" onClick={() => setRunning(value => !value)}><b>F2</b><span>{running ? "ПАУЗА" : "ПУСК"}</span></button>
          <button type="button" className="console-key" onClick={reset}><b>F3</b><span>СБРОС</span></button>
          <div className="rail-readout"><small>RANGE</small><strong>3.0</strong><em>NM</em></div>
          <div className="rail-readout"><small>ORIENT</small><strong>N-UP</strong></div>
          <div className="rail-spacer"></div>
          <span className="rail-caption">OPENOOW</span>
        </aside>
        <section className="panel radar-panel transas-radar-panel">
          <div className="panel-heading radar-heading"><div><span className="eyebrow">RADAR / PPI</span><h2>RELATIVE POSITION INDICATOR</h2></div><span className="unit">NORTH UP · {vectorMode.toUpperCase()} · {vectorMinutes} MIN</span></div>
          <svg className="radar-view" viewBox="0 0 500 500" role="img" aria-label="Схема взаимного положения судов">
            <circle cx="250" cy="250" r="235" className="radar-bg"/>
            {[58,117,176,235].map((r)=><circle key={r} cx="250" cy="250" r={r} className="radar-ring"/>)
            }
            <path d="M250 15V485 M15 250H485" className="radar-cross"/>
            {Array.from({ length: 12 }, (_, index) => index * 30).map((bearing) => {
              const angle = bearing * Math.PI / 180;
              const inner = 222;
              const outer = 235;
              const label = 205;
              const x1 = RADAR_CENTER + Math.sin(angle) * inner;
              const y1 = RADAR_CENTER - Math.cos(angle) * inner;
              const x2 = RADAR_CENTER + Math.sin(angle) * outer;
              const y2 = RADAR_CENTER - Math.cos(angle) * outer;
              const tx = RADAR_CENTER + Math.sin(angle) * label;
              const ty = RADAR_CENTER - Math.cos(angle) * label;
              return <g key={bearing} className="bearing-mark">
                <line x1={x1} y1={y1} x2={x2} y2={y2}/>
                <text x={tx} y={ty + 3} textAnchor="middle">{String(bearing).padStart(3, "0")}</text>
              </g>;
            })}
            <g className="range-labels">
              <text x="258" y="193">0.75</text><text x="258" y="134">1.50</text>
              <text x="258" y="75">2.25</text><text x="258" y="17">3.00 NM</text>
            </g>
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
              const estimatedTarget = track?.status === "tracking" && track.estimatedCourseDeg !== null && track.estimatedCourseDeg !== undefined && track.estimatedSpeedKn !== null
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
                  ? <button className="secondary arpa-action" onClick={() => releaseTarget(selectedTrack.targetId)}>Снять захват</button>
                  : <button className="primary arpa-action" onClick={() => acquireTarget(selectedMeasurement.id)}>Захватить ARPA</button>}
              </div>
            </> : <p className="cpa-note">Нажмите на отметку цели на PPI, чтобы получить измеренный истинный пеленг и дистанцию. Для выбора с клавиатуры используйте Tab и Enter.</p>}
          </div>
        </section>
        <div className="control-column">
          <section className="panel console-panel target-information-panel">
            <div className="target-info-topline"><div><span className="eyebrow">ARPA / TARGET DATA</span><h2>Targets Information</h2></div><span className="target-source-indicator">● OWN ARPA</span></div>
            <div className="target-info-controls"><label>Priority <select aria-label="Приоритет источника"><option>ARPA</option></select></label><button type="button" className="target-info-association" title="AIS/ARPA association будет доступна после добавления AIS-потока">Association</button><label className="target-filter-label">AIS filter <select disabled aria-label="Фильтр AIS"><option>OFF · NO AIS SOURCE</option></select></label></div>
            <div className="target-info-titlebar"><span>Targets Information</span><button type="button" className="target-info-menu-trigger" aria-expanded={targetInfoMenuOpen} onClick={() => setTargetInfoMenuOpen((open) => !open)}>▼</button><small>{arpaInfoRows.length} TRACKED</small></div>
            {targetInfoMenuOpen && <div className="target-info-menu" role="menu">
              {[
                ["overview","Targets overview"],["cpa","CPA / TCPA"],["bow","BCR / BCT"],["history","Past positions"],["tracking","ARPA tracking"],["trial","Trial manoeuvre"],["ais","AIS data · unavailable"],
              ].map(([page,label])=><button type="button" role="menuitem" key={page} disabled={page==="ais"} className={targetInfoPage===page?"active":""} onClick={()=>{setTargetInfoPage(page);setTargetInfoMenuOpen(false);}}>{label}</button>)}
            </div>}
            {targetInfoPage==="overview" ? <>
              <div className="target-info-tabs" role="tablist" aria-label="Отображение целей">
                {arpaInfoRows.slice(0,6).map((row,index)=><button type="button" role="tab" aria-selected={targetInfoTab===row.track.targetId} className={targetInfoTab===row.track.targetId?"active":""} key={row.track.targetId} onClick={()=>{setTargetInfoTab(row.track.targetId);setSelectedRadarTargetId(row.track.associatedRadarId);}}>Target {index+1}</button>)}
                <button type="button" role="tab" aria-selected={targetInfoTab==="multiple"} className={targetInfoTab==="multiple"?"active":""} onClick={()=>setTargetInfoTab("multiple")}>Multiple</button>
              </div>
              {targetInfoTab==="multiple" || !selectedInfoRow ? <div className="target-info-table-wrap"><table className="target-info-table target-info-multiple-table"><thead><tr><th>TGT</th>{arpaInfoRows.slice(0,5).map((row,index)=><th key={row.track.targetId}><button type="button" className={selectedRadarTargetId===row.track.associatedRadarId?"selected":""} onClick={()=>{setSelectedRadarTargetId(row.track.associatedRadarId);setTargetInfoTab(row.track.targetId);}}>Target {index+1}</button></th>)}</tr></thead><tbody>
                {targetInfoMetricRows.map((metric)=><tr key={metric.label}><th>{metric.label}</th>{metric.values.slice(0,5).map((value,index)=><td key={arpaInfoRows[index].track.targetId} className={selectedRadarTargetId===arpaInfoRows[index].track.associatedRadarId?"selected":""} onClick={()=>{setSelectedRadarTargetId(arpaInfoRows[index].track.associatedRadarId);setTargetInfoTab(arpaInfoRows[index].track.targetId);}}>{value}</td>)}</tr>)}
                {arpaInfoRows.length===0&&<tr><td colSpan={6} className="target-info-empty">NO ARPA TARGETS · ACQUIRE A RADAR ECHO</td></tr>}
              </tbody></table></div> : <div className="target-info-single"><div className="target-info-single-heading"><b>{selectedInfoRow.track.targetId}</b><span>{selectedInfoRow.track.status.toUpperCase()} · SRC ARPA</span><button type="button" onClick={() => releaseTarget(selectedInfoRow.track.targetId)}>CANCEL</button></div>
                <div className="target-info-metrics">{[
                  ["CPA",selectedInfoRow.solution.dcpaNm===null?"—":selectedInfoRow.solution.dcpaNm.toFixed(2),"NM"],
                  ["TCPA",formatMinutes(selectedInfoRow.solution.tcpaMin),""],["BRG",selectedInfoRow.solution.bearingDeg.toFixed(1),"°T"],["RNG",selectedInfoRow.solution.rangeNm.toFixed(2),"NM"],
                  ["COG",selectedInfoRow.track.estimatedCourseDeg===null?"—":selectedInfoRow.track.estimatedCourseDeg.toFixed(1),"°T"],["SOG",selectedInfoRow.track.estimatedSpeedKn===null?"—":selectedInfoRow.track.estimatedSpeedKn.toFixed(1),"kn"],
                  ["BCR",selectedInfoRow.bow.bcrNm===null?"—":selectedInfoRow.bow.bcrNm.toFixed(2),"NM"],["BCT",formatMinutes(selectedInfoRow.bow.bctMin),""],
                ].map(([label,value,unit])=><div key={label}><small>{label}</small><b>{value}</b><em>{unit}</em></div>)}</div></div>}
            </> : targetInfoPage==="cpa" ? <div className="target-info-detail"><h3>CPA / TCPA · {selectedInfoRow?.track.targetId ?? "NO TARGET"}</h3>{selectedInfoRow ? <div className="target-info-metrics"><div><small>DCPA</small><b>{selectedInfoRow.solution.dcpaNm?.toFixed(2) ?? "—"}</b><em>NM</em></div><div><small>TCPA</small><b>{formatMinutes(selectedInfoRow.solution.tcpaMin)}</b></div><div><small>RANGE</small><b>{selectedInfoRow.solution.rangeNm.toFixed(2)}</b><em>NM</em></div><div><small>BEARING</small><b>{selectedInfoRow.solution.bearingDeg.toFixed(1)}</b><em>°T</em></div></div> : <p>Захватите отметку в ARPA.</p>}</div>
            : targetInfoPage==="bow" ? <div className="target-info-detail"><h3>BOW CROSSING · {selectedInfoRow?.track.targetId ?? "NO TARGET"}</h3>{selectedInfoRow ? <div className="target-info-metrics"><div><small>BCR</small><b>{selectedInfoRow.bow.bcrNm?.toFixed(2) ?? "—"}</b><em>NM</em></div><div><small>BCT</small><b>{formatMinutes(selectedInfoRow.bow.bctMin)}</b></div></div> : <p>Захватите и дождитесь TRACK.</p>}</div>
            : targetInfoPage==="history" ? <div className="target-info-detail"><h3>PAST POSITIONS · {selectedInfoRow?.track.targetId ?? "NO TARGET"}</h3>{selectedInfoRow ? <table className="target-info-table"><thead><tr><th>TIME</th><th>RANGE</th><th>BEARING</th></tr></thead><tbody>{selectedInfoRow.track.measurements.slice().reverse().map((sample,index)=>{const dx=sample.xNm-ownVessel.xNm,dy=sample.yNm-ownVessel.yNm;return <tr key={sample.timeSeconds+"-"+index}><td>{formatTime(sample.timeSeconds)}</td><td>{Math.hypot(dx,dy).toFixed(2)} NM</td><td>{((Math.atan2(dx,dy)*180/Math.PI+360)%360).toFixed(1)}°T</td></tr>;})}</tbody></table> : <p>Выберите ARPA-цель.</p>}</div>
            : targetInfoPage==="tracking" ? <div className="target-info-detail"><h3>ARPA TRACK STATUS</h3>{arpaInfoRows.map(row=><button type="button" className="target-info-track-row" key={row.track.targetId} onClick={()=>{setTargetInfoTab(row.track.targetId);setSelectedRadarTargetId(row.track.associatedRadarId);}}><b>{row.track.targetId}</b><span>{row.track.status.toUpperCase()}</span><span>{row.track.measurementsUsed} SCANS</span></button>)}</div>
            : <div className="target-info-detail"><h3>TRIAL MANOEUVRE · {selectedInfoRow?.track.targetId ?? "SELECT TARGET"}</h3>
              <div className="trial-controls trial-controls-compact">
                <label>SET CSE °T<input type="number" min="0" max="359" value={trialCourseDeg} onChange={e=>setTrialCourseDeg(Math.max(0,Math.min(359,Number(e.target.value)||0)))}/></label>
                <label>SET SPD kn<input type="number" min="0" max="30" step="0.5" value={trialSpeedKn} onChange={e=>setTrialSpeedKn(Math.max(0,Math.min(30,Number(e.target.value)||0)))}/></label>
                <label>DELAY min<input type="number" min="0" max="30" step="0.5" value={trialDelayMin} onChange={e=>setTrialDelayMin(Math.max(0,Math.min(30,Number(e.target.value)||0)))}/></label>
                <label>ROT °/min<input type="number" min="0.1" max="30" step="0.5" value={trialRotDegPerMin} onChange={e=>setTrialRotDegPerMin(Math.max(0.1,Math.min(30,Number(e.target.value)||0.1)))}/></label>
                <label>ACC kn/min<input type="number" min="0" max="5" step="0.1" value={trialAcceleration} onChange={e=>setTrialAcceleration(Math.max(0,Math.min(5,Number(e.target.value)||0)))}/></label>
                <label>DEC kn/min<input type="number" min="0" max="5" step="0.1" value={trialDeceleration} onChange={e=>setTrialDeceleration(Math.max(0,Math.min(5,Number(e.target.value)||0)))}/></label>
                <label>VECTOR min<input type="number" min="1" max="120" value={trialHorizonMin} onChange={e=>setTrialHorizonMin(Math.max(1,Math.min(120,Number(e.target.value)||1)))}/></label>
              </div>
              {selectedTrialSolution && <div className="target-info-metrics"><div><small>TRIAL CPA</small><b>{selectedTrialSolution.dcpaNm?.toFixed(2) ?? "—"}</b><em>NM</em></div><div><small>TRIAL TCPA</small><b>{formatMinutes(selectedTrialSolution.tcpaMin)}</b></div></div>}
              <p className="cpa-note">Прогноз учитывает задержку, поворот с постоянным ROT и темп изменения скорости. Все сопровождаемые цели продолжают обновляться; реальное движение собственного судна не меняется.</p>
            </div>}
            <div className="target-info-foot"><span>CPA/TCPA · BCR/BCT</span><span>BEARING: TRUE</span><span>SOURCE: RADAR MEASUREMENTS</span></div>
          </section>
          <section className="panel console-panel">
            <div className="panel-heading"><div><span className="eyebrow">ARPA DISPLAY</span><h2>Векторы целей</h2></div></div>
            <div className="console-field"><span>Режим</span><div className="console-toggle"><button type="button" className={vectorMode === "true" ? "mode-active" : "mode-button"} onClick={() => setVectorMode("true")}>TRUE</button><button type="button" className={vectorMode === "relative" ? "mode-active" : "mode-button"} onClick={() => setVectorMode("relative")}>REL</button></div></div>
            <div className="console-field"><label htmlFor="vector-time">Длина вектора</label><strong>{vectorMinutes} MIN</strong></div>
            <input id="vector-time" type="range" min="1" max="30" step="1" value={vectorMinutes} onChange={(event) => setVectorMinutes(Number(event.target.value))}/>
          </section>
          <section className="panel console-panel arpa-live-panel">
            <div className="panel-heading"><div><span className="eyebrow">ARPA TARGETS</span><h2>Сопровождаемые цели</h2></div><span className="unit">{Object.values(arpaTracks).filter((track) => track.status === "tracking").length} TRACK</span></div>
            {Object.values(arpaTracks).length > 0 ? <div className="arpa-live-list">
              {Object.values(arpaTracks).map((track) => {
                const latest = radarMeasurements.find((item) => item.id === track.associatedRadarId) ??
                  (track.measurements.length ? track.measurements[track.measurements.length - 1] : null);
                const solution = latest ? calculateArpaSolution(track, latest, ownVessel) : null;
                const alert = solution ? isArpaCloseApproachAlert(track, solution, { minimumDcpaNm: alertDcpaNm, maximumTcpaMinutes: alertTcpaMinutes }) : false;
                return <button type="button" key={track.targetId} className={selectedRadarTargetId === track.associatedRadarId ? "arpa-live-row selected" : "arpa-live-row"} onClick={() => setSelectedRadarTargetId(track.associatedRadarId)}>
                  <span className="arpa-live-id">{track.targetId}<small>{track.associatedRadarId}</small></span>
                  <span className="arpa-live-status">{track.status === "tracking" ? "TRACK" : track.status === "acquiring" ? "ACQ" : "LOST"}</span>
                  <span className="arpa-live-cpa"><b>{solution?.dcpaNm !== null && solution?.dcpaNm !== undefined ? solution.dcpaNm.toFixed(2) : "—"}</b><small> DCPA NM</small></span>
                  <span className={alert ? "arpa-live-alert active" : "arpa-live-alert"}>{alert ? "!" : " "}</span>
                </button>;
              })}
            </div> : <p className="cpa-note compact-note">Нет захваченных целей. Выберите эхо на PPI и нажмите «Захватить ARPA».</p>}
            <div className="arpa-threshold-line">ALARM: DCPA {alertDcpaNm.toFixed(1)} NM · TCPA {alertTcpaMinutes} MIN</div>
          </section>
          <section className="panel console-panel colreg-live-panel">
            <div className="panel-heading"><div><span className="eyebrow">COLREG ASSESSMENT</span><h2>МППСС-72 · контекстная оценка</h2></div><span className="unit">RULES 1–41</span></div>
            <div className="colreg-context">
              <div className="colreg-context-heading">ПАРАМЕТРЫ СОБСТВЕННОГО СУДНА И ЦЕЛИ</div>
              <div className="colreg-context-grid">
                <label><span>Собственное судно</span><select value={colregOwnKind} onChange={(event) => setColregOwnKind(event.target.value as ColregVesselKind)}>{COLREG_VESSEL_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                <label><span>Цель</span><select value={colregTargetKind} onChange={(event) => setColregTargetKind(event.target.value as ColregVesselKind)}>{COLREG_VESSEL_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                <label><span>Длина своего судна, м</span><input className="colreg-number" type="number" min="1" max="400" value={colregOwnLengthM} onChange={(event) => setColregOwnLengthM(Math.max(1, Math.min(400, Number(event.target.value) || 1)))}/></label>
                <label><span>Длина цели, м</span><input className="colreg-number" type="number" min="1" max="400" value={colregTargetLengthM} onChange={(event) => setColregTargetLengthM(Math.max(1, Math.min(400, Number(event.target.value) || 1)))}/></label>
                {colregOwnKind === "fishing" && <label className="colreg-check"><input type="checkbox" checked={colregOwnFishing} onChange={(event) => setColregOwnFishing(event.target.checked)}/><span>Собственное судно занято ловом рыбы</span></label>}
                {colregTargetKind === "fishing" && <label className="colreg-check"><input type="checkbox" checked={colregTargetFishing} onChange={(event) => setColregTargetFishing(event.target.checked)}/><span>Цель занята ловом рыбы</span></label>}
                {colregOwnKind === "sailing" && <label className="colreg-check"><input type="checkbox" checked={colregOwnMotorUnderSail} onChange={(event) => setColregOwnMotorUnderSail(event.target.checked)}/><span>Двигатель работает под парусами</span></label>}
                {!["anchored", "aground", "other"].includes(colregOwnKind) && (colregOwnKind !== "wig-craft" || colregOwnWigOnSurface) && (colregOwnKind !== "seaplane" || colregOwnSeaplaneOnWater) && <label className="colreg-check"><input type="checkbox" checked={colregOwnMakingWay} onChange={(event) => setColregOwnMakingWay(event.target.checked)}/><span>Собственное судно имеет ход относительно воды</span></label>}
                {!["anchored", "aground", "other"].includes(colregTargetKind) && (colregTargetKind !== "wig-craft" || colregTargetWigOnSurface) && (colregTargetKind !== "seaplane" || colregTargetSeaplaneOnWater) && <label className="colreg-check"><input type="checkbox" checked={colregTargetMakingWay} onChange={(event) => setColregTargetMakingWay(event.target.checked)}/><span>Цель имеет ход относительно воды</span></label>}
                {colregOwnKind === "seaplane" && <label className="colreg-check"><input type="checkbox" checked={colregOwnSeaplaneOnWater} onChange={(event) => setColregOwnSeaplaneOnWater(event.target.checked)}/><span>Гидросамолёт находится на воде</span></label>}
                {colregTargetKind === "seaplane" && <label className="colreg-check"><input type="checkbox" checked={colregTargetSeaplaneOnWater} onChange={(event) => setColregTargetSeaplaneOnWater(event.target.checked)}/><span>Гидросамолёт-цель находится на воде</span></label>}
                {colregOwnKind === "wig-craft" && <label className="colreg-check"><input type="checkbox" checked={colregOwnWigOnSurface} onChange={(event) => setColregOwnWigOnSurface(event.target.checked)}/><span>Собственный WIG движется по поверхности воды</span></label>}
                {colregTargetKind === "wig-craft" && <label className="colreg-check"><input type="checkbox" checked={colregTargetWigOnSurface} onChange={(event) => setColregTargetWigOnSurface(event.target.checked)}/><span>WIG-цель движется по поверхности воды</span></label>}
                {colregTargetKind === "sailing" && <label className="colreg-check"><input type="checkbox" checked={colregTargetMotorUnderSail} onChange={(event) => setColregTargetMotorUnderSail(event.target.checked)}/><span>Двигатель цели работает под парусами</span></label>}
                {colregOwnKind === "sailing" && !colregOwnMotorUnderSail && <label><span>Галс своего судна</span><select value={colregOwnTack} onChange={(event) => setColregOwnTack(event.target.value as Tack)}><option value="unknown">Не определён</option><option value="port">Левый галс</option><option value="starboard">Правый галс</option></select></label>}
                {colregTargetKind === "sailing" && !colregTargetMotorUnderSail && <label><span>Галс цели</span><select value={colregTargetTack} onChange={(event) => setColregTargetTack(event.target.value as Tack)}><option value="unknown">Не определён</option><option value="port">Левый галс</option><option value="starboard">Правый галс</option></select></label>}
                {colregOwnKind === "sailing" && !colregOwnMotorUnderSail && colregOwnTack === "port" && colregTargetTack === "unknown" && <label><span>Цель находится наветреннее?</span><select value={colregTargetWindwardOfOwn} onChange={(event) => setColregTargetWindwardOfOwn(event.target.value)}><option value="unknown">Неизвестно</option><option value="yes">Да</option><option value="no">Нет</option></select></label>}
                {colregOwnKind === "sailing" && !colregOwnMotorUnderSail && colregOwnTack !== "unknown" && colregOwnTack === colregTargetTack && <label><span>Своё судно наветренное?</span><select value={colregOwnWindward} onChange={(event) => setColregOwnWindward(event.target.value)}><option value="unknown">Неизвестно</option><option value="yes">Да</option><option value="no">Нет</option></select></label>}
                {colregTargetKind === "sailing" && !colregTargetMotorUnderSail && colregOwnTack !== "unknown" && colregOwnTack === colregTargetTack && <label><span>Цель наветренная?</span><select value={colregTargetWindward} onChange={(event) => setColregTargetWindward(event.target.value)}><option value="unknown">Неизвестно</option><option value="yes">Да</option><option value="no">Нет</option></select></label>}
              </div>
              <div className="colreg-context-heading">УСЛОВИЯ НАВИГАЦИИ</div>
              <div className="colreg-context-grid">
                <label><span>Видимость</span><select value={colregVisibility} onChange={(event) => setColregVisibility(event.target.value as "good" | "restricted")}><option value="good">Нормальная</option><option value="restricted">Ограниченная</option></select></label>
                <label><span>Суда на виду?</span><select value={colregVesselsInSight ? "yes" : "no"} onChange={(event) => setColregVesselsInSight(event.target.value === "yes")}><option value="yes">Да, визуальный контакт</option><option value="no">Нет, обнаружение радаром</option></select></label>
                <label><span>Время суток</span><select value={colregDaylight ? "day" : "night"} onChange={(event) => setColregDaylight(event.target.value === "day")}><option value="night">Ночь</option><option value="day">День</option></select></label>
                <label className="colreg-check"><input type="checkbox" checked={colregOwnOvertakingNotClear} onChange={(event) => { setColregOwnOvertakingNotClear(event.target.checked); if (event.target.checked) setColregTargetOvertakingNotClear(false); }}/><span>Собственное судно обгоняет, ещё не прошло чисто (правило 13)</span></label>
                <label className="colreg-check"><input type="checkbox" checked={colregTargetOvertakingNotClear} onChange={(event) => { setColregTargetOvertakingNotClear(event.target.checked); if (event.target.checked) setColregOwnOvertakingNotClear(false); }}/><span>Цель обгоняет, ещё не прошла чисто (правило 13)</span></label>
                <label className="colreg-check"><input type="checkbox" checked={colregNarrowChannel} onChange={(event) => setColregNarrowChannel(event.target.checked)}/><span>Узкий проход / фарватер (правило 9)</span></label>
                {colregNarrowChannel && <label className="colreg-check"><input type="checkbox" checked={colregTargetChannelLimited} onChange={(event) => setColregTargetChannelLimited(event.target.checked)}/><span>Цель может безопасно идти только в канале</span></label>}
                {colregNarrowChannel && <label className="colreg-check"><input type="checkbox" checked={colregTargetNavigatingChannel} onChange={(event) => setColregTargetNavigatingChannel(event.target.checked)}/><span>Цель следует в узком проходе</span></label>}
                <label className="colreg-check"><input type="checkbox" checked={colregTss} onChange={(event) => setColregTss(event.target.checked)}/><span>Система разделения движения (правило 10)</span></label>
                {colregTss && <label className="colreg-check"><input type="checkbox" checked={colregCrossingTss} onChange={(event) => setColregCrossingTss(event.target.checked)}/><span>Собственное судно пересекает полосу</span></label>}
                {colregTss && <label className="colreg-check"><input type="checkbox" checked={colregTargetFollowingLane} onChange={(event) => setColregTargetFollowingLane(event.target.checked)}/><span>Цель следует по полосе движения</span></label>}
                {colregTss && <label className="colreg-check"><input type="checkbox" checked={colregOwnInshoreZone} onChange={(event) => setColregOwnInshoreZone(event.target.checked)}/><span>Своё судно в прибрежной зоне движения</span></label>}
              </div>
            </div>
            {colregAssessment ? <>
              <div className="colreg-rule-line">
                <strong>{colregAssessment.primaryRule ? "ПРАВИЛО " + colregAssessment.primaryRule : "ПРАВИЛО НЕ ОПРЕДЕЛЕНО"}</strong>
                <span>{colregResponsibilityLabel} · {colregRiskLabel}</span>
              </div>
              <h3 className="colreg-title">{colregAssessment.title}</h3>
              <p className="colreg-duty">{colregAssessment.ownShipDuty}</p>
              <div className={colregAssessment.rule7RiskIndication ? "colreg-rule7-line active" : "colreg-rule7-line"}>
                <strong>RULE 7 · RADAR PLOT</strong>
                <span>{colregRule7Summary}</span>
              </div>
              <div className="colreg-readouts">
                <div><small>ПЕЛЕНГ ЦЕЛИ</small><b>{colregAssessment.targetRelativeBearingDeg.toFixed(1)}° от носа</b></div>
                <div><small>КУРСОВАЯ РАЗНИЦА</small><b>{colregAssessment.courseDifferenceDeg.toFixed(1)}°</b></div>
                <div><small>ДИСТАНЦИЯ</small><b>{colregAssessment.rangeNm.toFixed(2)} NM</b></div>
                <div><small>СКОРОСТЬ СБЛИЖЕНИЯ</small><b>{colregAssessment.closingSpeedKn.toFixed(1)} kn</b></div>
                <div><small>DCPA</small><b>{colregAssessment.dcpaNm === null ? "—" : colregAssessment.dcpaNm.toFixed(2) + " NM"}</b></div>
                <div><small>TCPA</small><b>{colregAssessment.tcpaMin === null ? "—" : formatMinutes(colregAssessment.tcpaMin)}</b></div>
              </div>
              <div className="colreg-applicable-rules"><b>Применимые обязанности</b>{colregAssessment.applicableRules.map((item, index) => <div key={item.rule + "-" + index}><strong>П{item.rule} · {item.title}</strong><span>{item.duty}</span></div>)}</div>
              {colregManeuver && <div className="colreg-maneuver"><b>Проверка пробного манёвра</b><strong className={colregManeuver.cpaTrend}>{colregManeuver.cpaTrend === "improved" ? "CPA УЛУЧШАЕТСЯ" : colregManeuver.cpaTrend === "degraded" ? "CPA УХУДШАЕТСЯ" : colregManeuver.cpaTrend === "unchanged" ? "БЕЗ СУЩЕСТВЕННЫХ ИЗМЕНЕНИЙ" : "НЕДОСТАТОЧНО ДАННЫХ"}</strong><span>{colregManeuver.observation}</span><small>{colregManeuver.caution}</small></div>}
              <details className="colreg-signals">
                <summary>Огни и знаки: {colregAssessment.ownLightGuidance.title}</summary>
                <b>Собственное судно · правило {colregAssessment.ownLightGuidance.rule}</b>
                <small>Правило 22 · длина {colregOwnLengthM} м ({ownLightRanges?.vesselLengthBand}): топовый {ownLightRanges?.mastheadNm} NM, бортовые {ownLightRanges?.sidelightsNm} NM, кормовой {ownLightRanges?.sternNm} NM, буксировочный {ownLightRanges?.towingNm} NM, круговой {ownLightRanges?.allRoundNm} NM.</small>
                <ul>{colregAssessment.ownLightGuidance.lights.map((item) => <li key={item}>{item}</li>)}</ul>
                {colregAssessment.ownLightGuidance.dayShapes.length > 0 && (
                  <>
                    <b>Дневные знаки</b>
                    <ul>{colregAssessment.ownLightGuidance.dayShapes.map((item) => <li key={item}>{item}</li>)}</ul>
                  </>
                )}
                {colregAssessment.ownLightGuidance.notes.length > 0 && (
                  <>
                    <b>Примечания</b>
                    <ul>{colregAssessment.ownLightGuidance.notes.map((item) => <li key={item}>{item}</li>)}</ul>
                  </>
                )}
              </details>
              <details className="colreg-signals">
                <summary>Огни и знаки цели: {colregAssessment.targetLightGuidance.title}</summary>
                <b>Цель · правило {colregAssessment.targetLightGuidance.rule}</b>
                <small>Правило 22 · длина {colregTargetLengthM} м ({targetLightRanges?.vesselLengthBand}): топовый {targetLightRanges?.mastheadNm} NM, бортовые {targetLightRanges?.sidelightsNm} NM, кормовой {targetLightRanges?.sternNm} NM, буксировочный {targetLightRanges?.towingNm} NM, круговой {targetLightRanges?.allRoundNm} NM.</small>
                <ul>{colregAssessment.targetLightGuidance.lights.map((item) => <li key={item}>{item}</li>)}</ul>
                {colregAssessment.targetLightGuidance.dayShapes.length > 0 && (
                  <>
                    <b>Дневные знаки</b>
                    <ul>{colregAssessment.targetLightGuidance.dayShapes.map((item) => <li key={item}>{item}</li>)}</ul>
                  </>
                )}
                {colregAssessment.targetLightGuidance.notes.length > 0 && (
                  <>
                    <b>Примечания</b>
                    <ul>{colregAssessment.targetLightGuidance.notes.map((item) => <li key={item}>{item}</li>)}</ul>
                  </>
                )}
              </details>
              <details className="colreg-limitations"><summary>Ограничения автоматической оценки</summary><ul>{colregAssessment.limitations.map((item) => <li key={item}>{item}</li>)}</ul></details>
            </> : <p className="cpa-note compact-note">Выберите отметку на PPI, захватите её в ARPA и дождитесь статуса TRACK. После этого оценка использует измеренное положение и оценённые ARPA курс/скорость. Контекст судов и навигации можно задать выше.</p>}
            {colregVisibility === "restricted" && <div className="colreg-applicable-rules">
              <b>Рекомендуемый сигнал при ограниченной видимости · правило 35</b>
              {ownRestrictedSignal && <div><strong>Собственное судно · {ownRestrictedSignal.pattern}</strong><span>{ownRestrictedSignal.meaning} · {ownRestrictedSignal.context}</span></div>}
              {targetRestrictedSignal && <div><strong>Цель · {targetRestrictedSignal.pattern}</strong><span>{targetRestrictedSignal.meaning} · {targetRestrictedSignal.context}</span></div>}
            </div>}
            <details className="colreg-signals"><summary>Справочник звуковых сигналов · правила 32–37</summary>{getSoundSignals().map((signal, index) => <div className="colreg-signal-row" key={signal.rule + "-" + index}><b>П{signal.rule} · {signal.pattern}</b><span>{signal.meaning}</span><small>{signal.context}</small></div>)}</details>
            <details className="colreg-signals"><summary>Определения огней · правило 21</summary>{LIGHT_DEFINITIONS.map((light) => <div className="colreg-signal-row" key={light.name}><b>{light.name}</b><span>{light.description}</span></div>)}</details>
            <details className="colreg-rulebook"><summary>Справочник МППСС-72 · все правила 1–41</summary>{COLREG_RULES.map((rule) => <div className="colreg-rulebook-row" key={rule.number}><strong>Правило {rule.number} · {rule.title}</strong><small>{rule.part}{rule.operational ? "" : " · административная часть"}</small><span>{rule.summary}</span></div>)}</details>
            <p className="cpa-note compact-note">Учебная оценка не распознаёт огни/знаки автоматически и не является юридическим заключением или командой к манёвру. Правила 39–41 относятся к проверке выполнения Конвенции государствами, а не к расхождению судов.</p>
          </section>
          <section className="panel autopilot-panel">
            <div className="panel-heading"><div><span className="eyebrow">HEADING CONTROL</span><h2>Автопилот</h2></div><span className={autopilot.engaged ? (Math.abs(((autopilot.selectedHeadingDeg - ship.headingDeg + 540) % 360) - 180) > autopilot.offCourseAlarmDeg ? "autopilot-badge alarm" : "autopilot-badge active") : "autopilot-badge"}>{autopilot.engaged ? (Math.abs(((autopilot.selectedHeadingDeg - ship.headingDeg + 540) % 360) - 180) > autopilot.offCourseAlarmDeg ? "OFF COURSE" : "AUTO") : "STANDBY"}</span></div>
            <div className="autopilot-readouts">
              <div><small>ЗАДАННЫЙ КУРС</small><b>{autopilot.selectedHeadingDeg.toFixed(0)}°T</b></div>
              <div><small>ФАКТИЧЕСКИЙ КУРС</small><b>{ship.headingDeg.toFixed(1)}°T</b></div>
              <div><small>ОТКЛОНЕНИЕ</small><b>{(((autopilot.selectedHeadingDeg - ship.headingDeg + 540) % 360) - 180).toFixed(1)}°</b></div>
            </div>
            <div className="console-field autopilot-setpoint"><label htmlFor="autopilot-heading">Уставка курса, °T</label><input id="autopilot-heading" type="number" min="0" max="359" step="1" value={autopilot.selectedHeadingDeg} onChange={(event) => updateAutopilot((current) => ({ ...current, selectedHeadingDeg: ((Number(event.target.value) || 0) % 360 + 360) % 360 }))}/></div>
            <div className="autopilot-adjust">
              {[-10,-1,1,10].map((step) => <button type="button" className="secondary autopilot-nudge" key={step} onClick={() => updateAutopilot((current) => ({ ...current, selectedHeadingDeg: (current.selectedHeadingDeg + step + 360) % 360 }))}>{step > 0 ? "+" : ""}{step}°</button>)}
              <button type="button" className="secondary autopilot-nudge" onClick={() => updateAutopilot((current) => ({ ...current, selectedHeadingDeg: shipRef.current.headingDeg }))}>SYNC</button>
            </div>
            <div className="autopilot-settings">
              <label>Предел руля <b>{autopilot.rudderLimitDeg}°</b><input type="range" min="5" max="35" step="1" value={autopilot.rudderLimitDeg} onChange={(event) => updateAutopilot((current) => ({ ...current, rudderLimitDeg: Number(event.target.value) }))}/></label>
              <label>Сигнал отклонения <b>{autopilot.offCourseAlarmDeg}°</b><input type="range" min="2" max="20" step="1" value={autopilot.offCourseAlarmDeg} onChange={(event) => updateAutopilot((current) => ({ ...current, offCourseAlarmDeg: Number(event.target.value) }))}/></label>
            </div>
            <div className="action-row autopilot-actions">
              <button type="button" className={autopilot.engaged ? "secondary" : "primary"} onClick={() => updateAutopilot((current) => current.engaged ? { ...current, engaged: false } : { ...current, engaged: true, selectedHeadingDeg: current.selectedHeadingDeg })}>{autopilot.engaged ? "ОТКЛЮЧИТЬ" : "ВКЛЮЧИТЬ AUTO"}</button>
              <span>{autopilot.engaged ? "Руль управляется автопилотом" : "Ручное управление"}</span>
            </div>
            <p className="cpa-note compact-note">Автопилот удерживает только заданный курс. Маршрутное управление, адаптивная модель перекладки и отказоустойчивость рулевого привода пока не моделируются.</p>
          </section>
          <section className="panel">
            <div className="panel-heading"><div><span className="eyebrow">МОСТИК</span><h2>Органы управления</h2></div></div>
            <div className="control-block">
              <div className="control-title"><label htmlFor="throttle">Телеграф двигателя</label><strong>{Math.round(ship.throttlePercent)}%</strong></div>
              <input id="throttle" type="range" min="0" max="100" step="1" value={ship.throttlePercent} onChange={(e)=>updateShip(s=>({...s,throttlePercent:Number(e.target.value)}))}/>
              <div className="range-labels"><span>STOP</span><span>FULL AHEAD</span></div>
            </div>
            <div className="control-block">
              <div className="control-title"><label htmlFor="rudder">Угол руля</label><strong>{ship.rudderDeg.toFixed(0)}°</strong></div>
              <input id="rudder" type="range" min="-35" max="35" step="1" value={ship.rudderDeg} disabled={autopilot.engaged} onChange={(e)=>updateShip(s=>({...s,rudderDeg:Number(e.target.value)}))}/>
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
      <div className="instrument-footer">
        <span className={running ? "tx-indicator active" : "tx-indicator"}>{running ? "SIM ACTIVE" : "SIM PAUSED"}</span>
        <span>EBL: {eblBearingDeg.toFixed(0)}°T</span><span>VRM: {vrmRangeNm.toFixed(1)} NM</span>
        <span>VECTOR: {vectorMode.toUpperCase()}</span><span>ARPA: {Object.keys(arpaTracks).length} TRACKS</span>
        <span className="footer-spacer"></span><span>TRAINING DISPLAY</span>
      </div>
      <details className="data-drawer"><summary>CPA / TCPA · Геометрическая оценка всех целей</summary><section className="panel cpa-panel">
        <div className="panel-heading"><div><span className="eyebrow">РАСЧЁТ В РЕАЛЬНОМ ВРЕМЕНИ</span><h2>Геометрическая оценка без захвата</h2></div><Target size={18}/></div>
        <div className="cpa-table-wrap"><table className="cpa-table"><thead><tr><th>Цель</th><th>Пеленг</th><th>Дистанция</th><th>TCPA</th><th>DCPA</th></tr></thead><tbody>
          {targetCpa.map(({target,cpa}) => <tr key={target.id}><td>{target.id}</td><td>{cpa ? cpa.bearingDeg.toFixed(1) + "°" : "—"}</td><td>{cpa ? cpa.rangeNm.toFixed(2) + " NM" : "—"}</td><td>{cpa ? formatMinutes(cpa.tcpaMin) : "—"}</td><td>{cpa ? cpa.dcpaNm.toFixed(2) + " NM" : "—"}</td></tr>)}
        </tbody></table></div>
        <p className="cpa-note">Позиции целей и собственного судна обновляются с фиксированным шагом 0,1 с. CPA/TCPA пересчитываются по текущим векторам при каждом кадре интерфейса. Это геометрический прогноз по заданным сценарным курсам и скоростям. Векторы на PPI выше строятся отдельно по оценкам ARPA, полученным из радиолокационных обзоров.</p>
      </section></details>
      <details className="data-drawer"><summary>ARPA · Сопровождение и Trial Manoeuvre</summary><section className="panel cpa-panel arpa-panel">
        <div className="panel-heading"><div><span className="eyebrow">AUTOMATIC RADAR PLOTTING AID</span><h2>ARPA · Захват и сопровождение</h2></div><span className="unit">{Object.keys(arpaTracks).length} ЗАХВАЧЕНО</span></div>
        <div className="arpa-alert-settings">
          <label>Порог DCPA, NM <input type="number" min="0" max="10" step="0.1" value={alertDcpaNm} onChange={(event) => setAlertDcpaNm(Math.max(0, Math.min(10, Number(event.target.value) || 0)))}/></label>
          <label>Окно TCPA, min <input type="number" min="1" max="120" step="1" value={alertTcpaMinutes} onChange={(event) => setAlertTcpaMinutes(Math.max(1, Math.min(120, Number(event.target.value) || 1)))}/></label>
          <span>Учебные пороги, не норматив COLREG</span>
        </div>
        <div className="trial-controls">
          <div><span className="eyebrow">TRIAL MANOEUVRE · DYNAMIC</span><p>Сценарий собственного манёвра. Задержка до начала, конечный курс/скорость, ROT и темпы разгона/торможения. Векторы целей продолжают обновляться.</p></div>
          <label>SET CSE °T <input type="number" min="0" max="359" step="1" value={trialCourseDeg} onChange={e=>setTrialCourseDeg(Math.max(0,Math.min(359,Number(e.target.value)||0)))}/></label>
          <label>SET SPD kn <input type="number" min="0" max="30" step="0.5" value={trialSpeedKn} onChange={e=>setTrialSpeedKn(Math.max(0,Math.min(30,Number(e.target.value)||0)))}/></label>
          <label>DELAY min <input type="number" min="0" max="30" step="0.5" value={trialDelayMin} onChange={e=>setTrialDelayMin(Math.max(0,Math.min(30,Number(e.target.value)||0)))}/></label>
          <label>ROT °/min <input type="number" min="0.1" max="30" step="0.5" value={trialRotDegPerMin} onChange={e=>setTrialRotDegPerMin(Math.max(0.1,Math.min(30,Number(e.target.value)||0.1)))}/></label>
          <label>ACC kn/min <input type="number" min="0" max="5" step="0.1" value={trialAcceleration} onChange={e=>setTrialAcceleration(Math.max(0,Math.min(5,Number(e.target.value)||0)))}/></label>
          <label>DEC kn/min <input type="number" min="0" max="5" step="0.1" value={trialDeceleration} onChange={e=>setTrialDeceleration(Math.max(0,Math.min(5,Number(e.target.value)||0)))}/></label>
          <label>VECTOR min <input type="number" min="1" max="120" step="1" value={trialHorizonMin} onChange={e=>setTrialHorizonMin(Math.max(1,Math.min(120,Number(e.target.value)||1)))}/></label>
          <button type="button" className="secondary arpa-action" onClick={() => { setTrialCourseDeg(ownVessel.courseDeg); setTrialSpeedKn(ownVessel.speedKn); setTrialDelayMin(3); setTrialRotDegPerMin(3); setTrialAcceleration(0.5); setTrialDeceleration(0.5); setTrialHorizonMin(20); }}>RESET TRIAL</button>
        </div>
        <div className="cpa-table-wrap"><table className="cpa-table arpa-table"><thead><tr><th>ARPA-трек</th><th>Радарная отметка</th><th>Статус</th><th>Курс / скорость</th><th>TCPA</th><th>DCPA</th><th>Trial TCPA</th><th>Trial DCPA</th><th>Событие</th><th>Тревога</th><th>Действие</th></tr></thead><tbody>
          {Object.values(arpaTracks).map((track) => {
            const latestMeasurement = radarMeasurements.find((item) => item.id === track.associatedRadarId) ??
              (track.measurements.length ? track.measurements[track.measurements.length - 1] : null);
            const solution = latestMeasurement ? calculateArpaSolution(track, latestMeasurement, ownVessel) : null;
            const trialSolution = latestMeasurement ? calculateDynamicTrialManoeuvre(track, latestMeasurement, ownVessel, { courseDeg: trialCourseDeg, speedKn: trialSpeedKn, delayMin: trialDelayMin, turnRateDegPerMin: trialRotDegPerMin, accelerationKnPerMin: trialAcceleration, decelerationKnPerMin: trialDeceleration, horizonMin: trialHorizonMin }) : null;
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
      </section></details>
      <details className="data-drawer"><summary>РАЗБОР УЧЕБНОЙ СИТУАЦИИ</summary><section className="panel debrief-panel">
        <div className="eyebrow">КОНТРОЛЬНЫЕ ВОПРОСЫ</div><h2>Разбор после выполнения</h2>
        <ul>{activeScenario.debrief.map((item,index)=><li key={index}>{item}</li>)}</ul>
      </section></details>
      <div className="notice"><b>Ограничение учебной модели:</b> искусственные шумы и пропуски отметок отключены; обзор обновляется каждые 2,5 секунды. Нет моделирования диаграммы направленности антенны, мощности передатчика, отражательной способности, затенения, многолучёвости, Sea/Rain Clutter и ложных целей. Исторический след строится только по реально полученным радиолокационным отметкам; при пропуске обзора новая точка не добавляется. ARPA не является сертифицированным прибором. Сценарии предназначены для обучения, а не для реального судовождения.</div>
      </div><div className="module-view" hidden={activeTab !== "ecdis"}><EcdisModule ship={ship} targets={targets}/></div>
    </section>
  </main>;
}
