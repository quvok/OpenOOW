import type { VesselState } from "./navigation";
import { calculateCpa, velocityFromCourse } from "./navigation";
import { normalize360 } from "./units";
import type { ColregVesselKind } from "./colregSignals";
import { getVesselLightGuidance } from "./colregSignals";

export type EncounterType =
  | "restricted-visibility"
  | "overtaking-own"
  | "overtaking-target"
  | "sailing-meeting"
  | "head-on"
  | "crossing-starboard"
  | "crossing-port"
  | "vessel-priority"
  | "uncertain";

export type ColregResponsibility = "give-way" | "stand-on" | "both-act" | "no-impede" | "no-specific-duty" | "undetermined";
export type Tack = "port" | "starboard" | "unknown";

export interface ColregVesselProfile {
  kind: ColregVesselKind;
  underway: boolean;
  makingWay: boolean;
  lengthM?: number;
  tack?: Tack;
  windward?: boolean | null;
  engagedInFishing?: boolean;
  underSailAndPower?: boolean;
  wigOnSurface?: boolean;
  seaplaneOnWater?: boolean;
}

export interface ColregEnvironment {
  visibility: "good" | "restricted";
  vesselsInSight: boolean;
  daylight: boolean;
  narrowChannel: boolean;
  trafficSeparationScheme: boolean;
  ownCrossingTrafficLane?: boolean;
  ownInshoreTrafficZone?: boolean;
  targetFollowingTrafficLane?: boolean;
  targetCanOnlyNavigateChannel?: boolean;
  targetNavigatingChannel?: boolean;
  targetWindwardOfOwn?: boolean | null;
  ownOvertakingNotClear?: boolean;
  targetOvertakingNotClear?: boolean;
  bearingHistoryDeg?: number[];
  rangeHistoryNm?: number[];
  riskDcpaNm?: number;
}

export interface ColregRuleDuty {
  rule: number;
  title: string;
  duty: string;
  status: "applies" | "conditional" | "reference";
}

export interface ColregAssessment {
  encounter: EncounterType;
  primaryRule: number | null;
  rule: number | null;
  title: string;
  ownShipDuty: string;
  responsibility: ColregResponsibility;
  targetRelativeBearingDeg: number;
  ownRelativeBearingDeg: number;
  courseDifferenceDeg: number;
  closingSpeedKn: number;
  rangeNm: number;
  dcpaNm: number | null;
  tcpaMin: number | null;
  collisionRisk: "risk" | "no-immediate-risk" | "undetermined";
  bearingTrend: "stable" | "changing" | "insufficient";
  rangeTrend: "decreasing" | "increasing" | "stable" | "insufficient";
  rule7RiskIndication: boolean;
  applicableRules: ColregRuleDuty[];
  ownLightGuidance: ReturnType<typeof getVesselLightGuidance>;
  targetLightGuidance: ReturnType<typeof getVesselLightGuidance>;
  limitations: string[];
}

export interface ColregAssessmentOptions {
  ownProfile?: Partial<ColregVesselProfile>;
  targetProfile?: Partial<ColregVesselProfile>;
  environment?: Partial<ColregEnvironment>;
  /** Backward-compatible convenience flag. */
  restrictedVisibility?: boolean;
  riskDcpaNm?: number;
  headOnCourseToleranceDeg?: number;
  headOnBearingToleranceDeg?: number;
}

export interface ManeuverEvaluation {
  courseChangeDeg: number;
  speedChangeKn: number;
  dcpaBeforeNm: number | null;
  dcpaAfterNm: number | null;
  tcpaBeforeMin: number | null;
  tcpaAfterMin: number | null;
  cpaTrend: "improved" | "degraded" | "unchanged" | "undetermined";
  observation: string;
  caution: string;
}

const defaultProfile: ColregVesselProfile = {
  kind: "power-driven",
  underway: true,
  makingWay: true,
  lengthM: 50,
  tack: "unknown",
  windward: null,
  engagedInFishing: false,
  underSailAndPower: false,
};

const defaultEnvironment: ColregEnvironment = {
  visibility: "good",
  vesselsInSight: true,
  daylight: false,
  narrowChannel: false,
  trafficSeparationScheme: false,
  ownCrossingTrafficLane: false,
  ownInshoreTrafficZone: false,
  riskDcpaNm: 0.5,
};

const generalDuties: ColregRuleDuty[] = [
  { rule: 1, title: "Область применения", duty: "Убедитесь, что район плавания подпадает под COLREG; проверьте специальные местные правила, портовые предписания и правила для внутренних вод.", status: "reference" },
  { rule: 2, title: "Ответственность", duty: "Ни одно положение МППСС-72 не освобождает судно, капитана или экипаж от последствий пренебрежения правилами, обычной практикой мореплавания или особыми обстоятельствами. При необходимости избежать непосредственной опасности допустимо отступление от правил в пределах, необходимых обстоятельствами; ответственность за решение сохраняется.", status: "applies" },
  { rule: 3, title: "Определения", duty: "Для выбора правила используйте фактический статус и операцию судна: механическое, парусное, занятое ловом, NUC, RAM, CBD, WIG и другие определения.", status: "reference" },
  { rule: 4, title: "Применение правил 4–10", duty: "Правила 4–10 применяются при любых условиях видимости.", status: "applies" },
  { rule: 5, title: "Наблюдение", duty: "Поддерживайте постоянное надлежащее наблюдение зрением, слухом и всеми доступными средствами.", status: "applies" },
  { rule: 6, title: "Безопасная скорость", duty: "Выбирайте скорость с учётом видимости, плотности трафика, маневренности и остановочного пути, фоновых огней, ветра, моря, течения, глубины и возможностей/ограничений радара.", status: "applies" },
  { rule: 7, title: "Опасность столкновения", duty: "Используйте все доступные средства; при сомнении считайте опасность существующей. Не делайте выводов по скудным данным.", status: "applies" },
  { rule: 8, title: "Предупреждение столкновения", duty: "Действуйте заблаговременно, решительно и заметно; избегайте серии малых изменений курса. При достаточном пространстве изменение курса само по себе может быть наиболее эффективным; при необходимости уменьшите ход, остановите судно или дайте задний ход. Проверяйте эффективность до полного расхождения.", status: "applies" },
];

function signedAngle(degrees: number): number {
  return ((degrees + 180) % 360 + 360) % 360 - 180;
}

function trueBearing(from: Pick<VesselState, "xNm" | "yNm">, to: Pick<VesselState, "xNm" | "yNm">): number {
  return normalize360(Math.atan2(to.xNm - from.xNm, to.yNm - from.yNm) * 180 / Math.PI);
}

function validateVessel(vessel: VesselState): void {
  if (![vessel.xNm, vessel.yNm, vessel.courseDeg, vessel.speedKn].every(Number.isFinite) ||
      vessel.speedKn < 0) {
    throw new RangeError("Vessel position, course and speed must be finite; speed cannot be negative.");
  }
}

function closingSpeed(own: VesselState, target: VesselState, bearingDeg: number): number {
  const ownVelocity = velocityFromCourse(own.courseDeg, own.speedKn);
  const targetVelocity = velocityFromCourse(target.courseDeg, target.speedKn);
  const angle = bearingDeg * Math.PI / 180;
  const relativeEast = targetVelocity.eastKn - ownVelocity.eastKn;
  const relativeNorth = targetVelocity.northKn - ownVelocity.northKn;
  return -(relativeEast * Math.sin(angle) + relativeNorth * Math.cos(angle));
}

function isAbaftBeam(relativeBearing: number): boolean {
  return relativeBearing > 112.5 && relativeBearing < 247.5;
}

function assessRadarTrend(bearings: number[] | undefined, ranges: number[] | undefined): {
  bearingTrend: "stable" | "changing" | "insufficient";
  rangeTrend: "decreasing" | "increasing" | "stable" | "insufficient";
  rule7RiskIndication: boolean;
} {
  if (!bearings || !ranges || bearings.length < 3 || ranges.length < 3) {
    return { bearingTrend: "insufficient", rangeTrend: "insufficient", rule7RiskIndication: false };
  }
  const count = Math.min(bearings.length, ranges.length, 8);
  const b = bearings.slice(-count);
  const r = ranges.slice(-count);
  if (![...b, ...r].every(Number.isFinite) || r.some((value) => value < 0)) {
    throw new RangeError("Radar bearing/range history must contain finite values.");
  }
  const deltas = b.slice(1).map((value) => Math.abs(signedAngle(value - b[0])));
  const bearingStable = deltas.every((delta) => delta <= 2.5);
  const rangeDelta = r[r.length - 1] - r[0];
  const rangeTrend = rangeDelta < -0.01 ? "decreasing" : rangeDelta > 0.01 ? "increasing" : "stable";
  const bearingTrend = bearingStable ? "stable" : "changing";
  return { bearingTrend, rangeTrend, rule7RiskIndication: bearingStable && rangeTrend === "decreasing" };
}

function normalizeProfile(profile: Partial<ColregVesselProfile> | undefined): ColregVesselProfile {
  const normalized = { ...defaultProfile, ...profile };
  if (normalized.lengthM !== undefined && (!Number.isFinite(normalized.lengthM) || normalized.lengthM <= 0)) {
    throw new RangeError("Vessel length must be finite and greater than zero.");
  }
  if (normalized.kind === "anchored" || normalized.kind === "aground") {
    normalized.underway = false;
    normalized.makingWay = false;
  }
  return normalized;
}

function normalizeEnvironment(options: ColregAssessmentOptions): ColregEnvironment {
  const environment = { ...defaultEnvironment, ...options.environment, riskDcpaNm: options.environment?.riskDcpaNm ?? options.riskDcpaNm ?? defaultEnvironment.riskDcpaNm };
  if (options.restrictedVisibility !== undefined && options.environment?.visibility === undefined) {
    environment.visibility = options.restrictedVisibility ? "restricted" : "good";
  }
  if (environment.ownOvertakingNotClear && environment.targetOvertakingNotClear) {
    throw new RangeError("Only one vessel can be marked as still overtaking in this pair.");
  }
  if (!Number.isFinite(environment.riskDcpaNm) || (environment.riskDcpaNm ?? -1) < 0) {
    throw new RangeError("Risk DCPA threshold must be finite and non-negative.");
  }
  return environment;
}

function isPowerDriven(profile: ColregVesselProfile): boolean {
  return (profile.kind === "wig-craft" && profile.wigOnSurface === true) || profile.kind === "power-driven" || profile.kind === "pilot" || profile.kind === "towing" ||
    (profile.kind === "fishing" && !profile.engagedInFishing) ||
    (profile.kind === "sailing" && profile.underSailAndPower === true);
}

function profileRank(profile: ColregVesselProfile): number | null {
  if (profile.kind === "wig-craft" && !profile.wigOnSurface) return -1;
  if (profile.kind === "seaplane" && profile.seaplaneOnWater) return -1;
  if (profile.kind === "seaplane") return profile.seaplaneOnWater ? 0 : null;
  if (profile.kind === "nuc" || profile.kind === "ram") return 3;
  if (profile.kind === "fishing" && profile.engagedInFishing) return 2;
  if (profile.kind === "sailing" && !profile.underSailAndPower) return 1;
  if (isPowerDriven(profile)) return 0;
  return null;
}

function addDuty(list: ColregRuleDuty[], duty: ColregRuleDuty): void {
  if (!list.some((item) => item.rule === duty.rule && item.duty === duty.duty)) list.push(duty);
}

function classifyRule18(
  own: ColregVesselProfile,
  target: ColregVesselProfile,
): { responsibility: ColregResponsibility; duty: string } {
  const ownWigInFlight = own.kind === "wig-craft" && !own.wigOnSurface;
  const targetWigInFlight = target.kind === "wig-craft" && !target.wigOnSurface;
  const ownSeaplaneOnWater = own.kind === "seaplane" && own.seaplaneOnWater === true;
  const targetSeaplaneOnWater = target.kind === "seaplane" && target.seaplaneOnWater === true;
  if ((ownWigInFlight || ownSeaplaneOnWater) && (targetWigInFlight || targetSeaplaneOnWater)) {
    return { responsibility: "undetermined", duty: "Оба WIG находятся в полёте у поверхности. Правило 18(f) требует каждому держаться в стороне от других судов; проверьте фактическую траекторию и специальные обстоятельства." };
  }
  if (ownWigInFlight || ownSeaplaneOnWater) {
    return { responsibility: "give-way", duty: ownWigInFlight
      ? "WIG при взлёте, посадке и полёте у поверхности должен держаться в стороне от всех других судов и не затруднять их движение (правило 18(f))."
      : "Гидросамолёт на воде должен в общем случае держаться в стороне от всех судов и не затруднять их движение; при возникновении риска столкновения соблюдайте правила раздела II (правило 18(e))." };
  }
  if (targetWigInFlight || targetSeaplaneOnWater) {
    return { responsibility: "stand-on", duty: targetWigInFlight
      ? "Цель — WIG в полёте у поверхности; она должна держаться в стороне от всех судов и не затруднять их движение (правило 18(f)). Продолжайте наблюдение."
      : "Цель — гидросамолёт на воде; он должен в общем случае держаться в стороне от всех судов и не затруднять их движение (правило 18(e)). Продолжайте наблюдение." };
  }
  if (own.kind === "constrained-draught" && target.kind === "constrained-draught") {
    return { responsibility: "undetermined", duty: "Оба судна ограничены своей осадкой. Правило 18 не устанавливает приоритет между ними; каждое должно учитывать условия и не затруднять безопасное движение другого." };
  }
  if (own.kind === "constrained-draught" && target.kind !== "nuc" && target.kind !== "ram") {
    return {
      responsibility: "no-specific-duty",
      duty: "Судно ограничено своей осадкой. Другие суда, кроме NUC/RAM, должны по возможности не затруднять его безопасный проход; это не даёт автоматического права требовать уступить дорогу во всех ситуациях.",
    };
  }
  if (target.kind === "constrained-draught" && own.kind !== "nuc" && own.kind !== "ram") {
    return {
      responsibility: "no-specific-duty",
      duty: "Цель ограничена своей осадкой. Если обстоятельства позволяют, не затрудняйте её безопасный проход; не трактуйте это как безусловное освобождение цели от всех обязанностей.",
    };
  }
  const ownRank = profileRank(own);
  const targetRank = profileRank(target);
  if (ownRank === null || targetRank === null || ownRank === targetRank) {
    return {
      responsibility: "undetermined",
      duty: "Правило 18 не устанавливает однозначного приоритета для выбранной пары статусов. Проверьте специальные обстоятельства и применимые правила 9, 10 и 13.",
    };
  }
  if (ownRank < targetRank) {
    return {
      responsibility: "give-way",
      duty: "По правилу 18 собственное судно должно держаться в стороне от пути цели с указанным специальным статусом, если специальные правила 9, 10 или 13 не требуют иного.",
    };
  }
  return {
    responsibility: "stand-on",
    duty: "По правилу 18 цель должна держаться в стороне от пути собственного судна с указанным статусом. Продолжайте наблюдение и будьте готовы действовать по правилу 17 и общим правилам.",
  };
}

/**
 * Context-aware COLREG training assessment.
 * Geometry suggests candidate encounters; legal applicability still depends on
 * the real vessel status, visibility, local rules and circumstances.
 */
export function assessColregEncounter(
  own: VesselState,
  target: VesselState,
  options: ColregAssessmentOptions = {},
): ColregAssessment {
  validateVessel(own);
  validateVessel(target);
  const rangeNm = Math.hypot(target.xNm - own.xNm, target.yNm - own.yNm);
  if (rangeNm < 1e-9) throw new RangeError("Own ship and target cannot occupy the same position.");

  const ownProfile = normalizeProfile(options.ownProfile);
  const targetProfile = normalizeProfile(options.targetProfile);
  const environment = normalizeEnvironment(options);
  const bearing = trueBearing(own, target);
  const ownRelativeBearing = normalize360(bearing - own.courseDeg);
  const targetRelativeBearing = normalize360(trueBearing(target, own) - target.courseDeg);
  const courseDifference = Math.abs(signedAngle(target.courseDeg - own.courseDeg));
  const closing = closingSpeed(own, target, bearing);
  const cpa = calculateCpa(own, target);
  const headOnCourseTolerance = options.headOnCourseToleranceDeg ?? 15;
  const headOnBearingTolerance = options.headOnBearingToleranceDeg ?? 10;
  if (![headOnCourseTolerance, headOnBearingTolerance].every(Number.isFinite) ||
      headOnCourseTolerance < 0 || headOnCourseTolerance > 45 ||
      headOnBearingTolerance < 0 || headOnBearingTolerance > 45) {
    throw new RangeError("Head-on tolerances must be between 0 and 45 degrees.");
  }
  const riskLimit = environment.riskDcpaNm ?? 0.5;
  const cpaRisk: ColregAssessment["collisionRisk"] = !cpa || cpa.tcpaMin <= 0
    ? "undetermined"
    : cpa.dcpaNm <= riskLimit ? "risk" : "no-immediate-risk";
  const radarTrend = assessRadarTrend(environment.bearingHistoryDeg, environment.rangeHistoryNm);
  const collisionRisk: ColregAssessment["collisionRisk"] = radarTrend.rule7RiskIndication ? "risk" : cpaRisk;
  const hasRisk = collisionRisk === "risk";
  const ownSmallOrSailing = (ownProfile.lengthM ?? 50) < 20 ||
    (ownProfile.kind === "sailing" && !ownProfile.underSailAndPower);
  const ownFishingEngaged = ownProfile.kind === "fishing" && ownProfile.engagedInFishing === true;
  const rule9MustNotImpede = environment.narrowChannel && (
    ownSmallOrSailing && environment.targetCanOnlyNavigateChannel === true ||
    ownFishingEngaged && environment.targetNavigatingChannel === true
  );
  const rule10MustNotImpede = environment.trafficSeparationScheme && environment.targetFollowingTrafficLane === true && (
    ownFishingEngaged || ownSmallOrSailing && isPowerDriven(targetProfile)
  );

  const applicableRules = generalDuties.map((item) => item.rule === 7 && radarTrend.rule7RiskIndication
    ? { ...item, duty: "Постоянный пеленг при уменьшающейся дистанции по последним радиолокационным измерениям указывает на возможную опасность. Не полагайтесь на один признак: продолжайте систематическую прокладку и оценку всеми доступными средствами." }
    : item);
  let encounter: EncounterType = "uncertain";
  let primaryRule: number | null = null;
  let title = "Ситуация не классифицирована";
  let ownShipDuty = "Не делайте вывод о применимом правиле только по геометрии. Продолжайте наблюдение и оценку риска.";
  let responsibility: ColregResponsibility = "undetermined";

  if (environment.narrowChannel) {
    addDuty(applicableRules, {
      rule: 9,
      title: "Узкий проход",
      duty: "Держитесь ближе к правой внешней границе фарватера, насколько это безопасно и практически возможно. Не затрудняйте проход судну, которое может безопасно идти только в пределах канала; пересекайте канал только если не создаёте помех. Обгоняйте в узком проходе только при безопасной возможности и согласии обгоняемого, используя сигналы правила 34. По возможности избегайте постановки на якорь в узком проходе.",
      status: "applies",
    });
  }
  if (environment.trafficSeparationScheme) {
    addDuty(applicableRules, {
      rule: 10,
      title: "Система разделения движения",
      duty: "Следуйте полосой в общем направлении потока; избегайте разделительной полосы и зоны разделения. По возможности не пересекайте полосы; если пересечение необходимо, выполняйте его почти под прямым углом. При входе в полосу или выходе из неё у её окончания делайте это под малым углом к общему направлению потока. Не затрудняйте движение судна, следующего по полосе. Не входите в зону разделения и не становитесь на якорь в TSS без предусмотренной правилами необходимости.",
      status: "applies",
    });
    if (environment.ownCrossingTrafficLane) {
      addDuty(applicableRules, {
        rule: 10,
        title: "Пересечение полосы TSS",
        duty: "Пересекайте полосу по возможности под прямым углом к общему направлению потока, а не под малым углом.",
        status: "conditional",
      });
    }
    if (environment.ownInshoreTrafficZone) {
      const inshoreExceptionCategory = (ownProfile.lengthM ?? 50) < 20 ||
        (ownProfile.kind === "sailing" && !ownProfile.underSailAndPower) ||
        (ownProfile.kind === "fishing" && ownProfile.engagedInFishing);
      addDuty(applicableRules, {
        rule: 10,
        title: "Прибрежная зона движения",
        duty: inshoreExceptionCategory
          ? "Ваше судно относится к категории, которой правило 10 допускает использование inshore traffic zone. Учитывайте направление движения и не затрудняйте суда в полосе TSS."
          : "Не используйте inshore traffic zone, если можете безопасно использовать соответствующую полосу TSS, кроме предусмотренных правилом 10 исключений (например, следование в/из порта, избежание непосредственной опасности или пересечение зоны).",
        status: "conditional",
      });
    }
  }

  if (environment.visibility === "restricted" && !environment.vesselsInSight) {
    encounter = "restricted-visibility";
    primaryRule = 19;
    title = "Ограниченная видимость: суда не находятся на виду";
    ownShipDuty = "Правило 19: безопасная скорость с учётом ограниченной видимости; машины готовы к немедленному манёвру. Используйте радар для систематической оценки риска. Избегайте поворота влево для цели впереди траверза, кроме случая обгона; насколько возможно, избегайте поворота в сторону цели на траверзе или позади неё. Если услышан туманный сигнал впереди траверза либо нельзя избежать опасного сближения с целью впереди траверза, уменьшите ход до минимального, при котором судно может удерживаться на курсе, и при необходимости остановитесь.";
    applicableRules.push({
      rule: 19,
      title: "Ограниченная видимость",
      duty: ownShipDuty,
      status: "applies",
    });
  } else if (environment.vesselsInSight) {
    applicableRules.push({
      rule: 11,
      title: "Суда на виду друг у друга",
      duty: "Применяются правила 11–18 для судов, находящихся на виду друг у друга, при соблюдении условий каждого конкретного правила.",
      status: "applies",
    });

    const ownOvertaking = ownProfile.underway && targetProfile.underway &&
      (environment.ownOvertakingNotClear === true || (isAbaftBeam(targetRelativeBearing) && closing > 0.05));
    const targetOvertaking = ownProfile.underway && targetProfile.underway &&
      (environment.targetOvertakingNotClear === true || (isAbaftBeam(ownRelativeBearing) && closing > 0.05));

    // Rule 13 takes precedence over the other encounter rules in Section II.
    if (ownOvertaking && targetOvertaking) {
      ownShipDuty = "Оба признака обгона отмечены одновременно. Проверьте идентификацию целей и историю сближения; не назначайте обязанность автоматически.";
    } else if (ownOvertaking) {
      encounter = "overtaking-own";
      primaryRule = 13;
      title = "Собственное судно, вероятно, обгоняет цель";
      responsibility = "give-way";
      ownShipDuty = "Правило 13: собственное судно как обгоняющее обязано держаться в стороне от пути обгоняемого до окончательного прохода и чистого расхождения. При сомнении считайте себя обгоняющим.";
    } else if (targetOvertaking) {
      encounter = "overtaking-target";
      primaryRule = 13;
      title = "Цель, вероятно, обгоняет собственное судно";
      responsibility = "stand-on";
      ownShipDuty = "Цель, вероятно, является обгоняющей и обязана держаться в стороне. Сохраняйте курс и скорость, если нет оснований действовать по правилу 17 или другим правилам; не мешайте обгону.";
    } else if (ownProfile.underway && targetProfile.underway && hasRisk &&
               ownProfile.kind === "sailing" && targetProfile.kind === "sailing" &&
               !ownProfile.underSailAndPower && !targetProfile.underSailAndPower) {
      encounter = "sailing-meeting";
      primaryRule = 12;
      title = "Сближение двух парусных судов";
      if (ownProfile.tack !== "unknown" && targetProfile.tack !== "unknown" &&
          ownProfile.tack !== targetProfile.tack) {
        responsibility = ownProfile.tack === "port" ? "give-way" : "stand-on";
        ownShipDuty = ownProfile.tack === "port"
          ? "Судно левым галсом должно держаться в стороне от судна правым галсом."
          : "Судно правым галсом сохраняет курс и скорость; наблюдайте за выполнением обязанности другим судном и будьте готовы действовать.";
      } else if (ownProfile.tack === targetProfile.tack && ownProfile.tack !== "unknown" &&
                 ownProfile.windward !== null && targetProfile.windward !== null && ownProfile.windward !== targetProfile.windward) {
        responsibility = ownProfile.windward ? "give-way" : "stand-on";
        ownShipDuty = ownProfile.windward
          ? "На одном галсе наветренное судно должно держаться в стороне от подветренного."
          : "Подветренное судно сохраняет курс и скорость; контролируйте обстановку.";
      } else if (ownProfile.tack === "port" && targetProfile.tack === "unknown" && environment.targetWindwardOfOwn === true) {
        ownShipDuty = "Вы не можете определить галс другого парусного судна, находясь на левом галсе, и цель находится наветреннее. По правилу 12(c) держитесь в стороне от неё.";
        responsibility = "give-way";
      } else {
        ownShipDuty = "Нельзя надёжно определить галс или наветренную сторону. При сомнении уточните положение ветра и парусов; не назначайте обязанность автоматически.";
        responsibility = "undetermined";
      }
    } else if (ownProfile.underway && targetProfile.underway && hasRisk &&
               isPowerDriven(ownProfile) && isPowerDriven(targetProfile) &&
               Math.abs(180 - courseDifference) <= headOnCourseTolerance &&
               Math.min(ownRelativeBearing, 360 - ownRelativeBearing) <= headOnBearingTolerance &&
               Math.min(targetRelativeBearing, 360 - targetRelativeBearing) <= headOnBearingTolerance) {
      encounter = "head-on";
      primaryRule = 14;
      title = "Вероятная ситуация встречного сближения";
      responsibility = "both-act";
      ownShipDuty = "Правило 14: оба механических судна должны изменить курс вправо, чтобы пройти левыми бортами. Это взаимная обязанность обоих судов, а не обычная пара «уступающее/сохраняющее курс». При сомнении считайте ситуацию встречной.";
    } else if (ownProfile.underway && targetProfile.underway &&
               isPowerDriven(ownProfile) && isPowerDriven(targetProfile) &&
               hasRisk && ownRelativeBearing > 0 && ownRelativeBearing < 112.5) {
      encounter = "crossing-starboard";
      primaryRule = 15;
      title = "Пересечение: цель справа";
      responsibility = "give-way";
      ownShipDuty = "Правило 15: собственное судно видит другое механическое судно справа и должно уступить дорогу. Правило 16 требует заблаговременного и решительного действия; по возможности не пересекайте курс цели перед её носом.";
    } else if (ownProfile.underway && targetProfile.underway &&
               isPowerDriven(ownProfile) && isPowerDriven(targetProfile) &&
               hasRisk && ownRelativeBearing > 247.5 && ownRelativeBearing < 360) {
      encounter = "crossing-port";
      primaryRule = 15;
      title = "Пересечение: цель слева";
      responsibility = "stand-on";
      ownShipDuty = "При подтверждённой ситуации пересечения цель находится слева, поэтому собственное судно обычно сохраняет курс и скорость по правилу 17. Это не освобождает от наблюдения и действий, когда этого требует правило 17.";
    } else {
      const hierarchy = classifyRule18(ownProfile, targetProfile);
      const specialKeepClearSituation = (ownProfile.kind === "wig-craft" && !ownProfile.wigOnSurface) || (targetProfile.kind === "wig-craft" && !targetProfile.wigOnSurface) || (ownProfile.kind === "seaplane" && ownProfile.seaplaneOnWater) || (targetProfile.kind === "seaplane" && targetProfile.seaplaneOnWater);
      if (hierarchy.responsibility !== "undetermined" && ((ownProfile.underway && targetProfile.underway) || specialKeepClearSituation)) {
        encounter = "vessel-priority";
        primaryRule = 18;
        title = "Взаимные обязанности по статусу судов";
        responsibility = hierarchy.responsibility;
        ownShipDuty = hierarchy.duty;
      } else {
        ownShipDuty = "Геометрия не позволяет назначить конкретную обязанность по правилам 12–18. Учитывайте статусы судов, характер операции, местные условия и все доступные средства наблюдения.";
      }
    }

  } else {
    ownShipDuty = environment.visibility === "restricted"
      ? "Суда не находятся на виду друг у друга: проверьте применимость правила 19 и используйте радарную информацию."
      : "Правила 11–18 для судов на виду пока не применяются: цель не подтверждена визуально. Продолжайте оценку по правилам 4–10.";
  }

  if (rule9MustNotImpede || rule10MustNotImpede) {
    const nonImpedimentDuties: string[] = [];
    if (rule9MustNotImpede) {
      const duty = ownFishingEngaged
        ? "По правилу 9(c) рыболовное судно не должно затруднять проход любого другого судна, следующего в узком проходе."
        : "По правилу 9(b) малое или парусное судно не должно затруднять проход судна, способного безопасно идти только в пределах узкого прохода.";
      nonImpedimentDuties.push(duty);
      addDuty(applicableRules, { rule: 9, title: "Не затруднять проход в узком канале", duty, status: "conditional" });
    }
    if (rule10MustNotImpede) {
      const duty = ownFishingEngaged
        ? "По правилу 10(j) рыболовное судно не должно затруднять безопасный проход любого судна, следующего по полосе TSS."
        : "По правилу 10(j) судно менее 20 м или парусное судно не должно затруднять безопасный проход механического судна, следующего по полосе TSS.";
      nonImpedimentDuties.push(duty);
      addDuty(applicableRules, { rule: 10, title: "Не затруднять судно в полосе TSS", duty, status: "conditional" });
    }
    const combinedDuty = nonImpedimentDuties.join(" ");
    if (primaryRule === null) {
      primaryRule = rule9MustNotImpede ? 9 : 10;
      encounter = "vessel-priority";
      title = rule9MustNotImpede ? "Узкий проход: обязанность не затруднять" : "TSS: обязанность не затруднять";
      ownShipDuty = combinedDuty;
      responsibility = "no-impede";
    } else if (responsibility === "stand-on" || responsibility === "undetermined" || responsibility === "no-specific-duty") {
      ownShipDuty = combinedDuty + " Геометрическая оценка могла бы указывать на сохранение курса, но специальная обязанность не затруднять проход имеет приоритет.";
      responsibility = "no-impede";
    } else {
      ownShipDuty += " Дополнительно: " + combinedDuty;
    }
  }

  if (primaryRule !== null && primaryRule >= 12 && primaryRule <= 18) {
    addDuty(applicableRules, {
      rule: primaryRule,
      title: primaryRule === 12 ? "Парусные суда" : primaryRule === 13 ? "Обгон" : primaryRule === 14 ? "Встречное сближение" : primaryRule === 15 ? "Пересечение курсов" : "Взаимные обязанности судов",
      duty: ownShipDuty,
      status: "applies",
    });
  }

  if (primaryRule === 13 || primaryRule === 15 || primaryRule === 18 || primaryRule === 12) {
    if (responsibility === "give-way") {
      applicableRules.push({ rule: 16, title: "Судно, уступающее дорогу", duty: "Предпринимайте заблаговременное и решительное действие, чтобы чисто разойтись; по возможности избегайте пересечения курса другого судна перед его носом.", status: "applies" });
    } else if (responsibility === "stand-on") {
      applicableRules.push({ rule: 17, title: "Судно, сохраняющее курс и скорость", duty: "Сохраняйте курс и скорость. Когда становится очевидно, что уступающее судно не действует должным образом, можете действовать самостоятельно; когда столкновения нельзя избежать только его действиями, обязаны предпринять наиболее эффективное действие. В ситуации пересечения механическому судну, которое действует по правилу 17(a)(ii), по возможности не следует изменять курс влево для судна, находящегося слева от него.", status: "applies" });
    }
  }

  if (environment.daylight === false) {
    applicableRules.push({
      rule: 20,
      title: "Огни",
      duty: "От захода до восхода солнца выставляйте требуемые огни; не выставляйте другие огни, которые могут быть приняты за них или ухудшить видимость/характерный вид.",
      status: "applies",
    });
  } else if (environment.visibility === "restricted") {
    applicableRules.push({
      rule: 20,
      title: "Огни при ограниченной видимости",
      duty: "При ограниченной видимости требуемые огни должны быть выставлены также днём.",
      status: "applies",
    });
  }

  const ownLightKind = ownProfile.underSailAndPower || (ownProfile.kind === "wig-craft" && ownProfile.wigOnSurface) || (ownProfile.kind === "seaplane" && ownProfile.seaplaneOnWater) || (ownProfile.kind === "fishing" && !ownProfile.engagedInFishing) ? "power-driven" : ownProfile.kind;
  const targetLightKind = targetProfile.underSailAndPower || (targetProfile.kind === "wig-craft" && targetProfile.wigOnSurface) || (targetProfile.kind === "seaplane" && targetProfile.seaplaneOnWater) || (targetProfile.kind === "fishing" && !targetProfile.engagedInFishing) ? "power-driven" : targetProfile.kind;
  const ownLightBase = getVesselLightGuidance(ownLightKind);
  const targetLightBase = getVesselLightGuidance(targetLightKind);
  const ownLightGuidance = { ...ownLightBase, lights: [...ownLightBase.lights], dayShapes: [...ownLightBase.dayShapes], notes: [...ownLightBase.notes] };
  const targetLightGuidance = { ...targetLightBase, lights: [...targetLightBase.lights], dayShapes: [...targetLightBase.dayShapes], notes: [...targetLightBase.notes] };
  if (ownProfile.underSailAndPower) ownLightGuidance.dayShapes.push("Чёрный конус вершиной вниз: судно идёт под парусами и одновременно использует механическую установку.");
  if (targetProfile.underSailAndPower) targetLightGuidance.dayShapes.push("Чёрный конус вершиной вниз: судно идёт под парусами и одновременно использует механическую установку.");
  if ((ownProfile.kind === "nuc" || ownProfile.kind === "ram") && ownProfile.makingWay) ownLightGuidance.notes.push("При движении относительно воды выставляются также соответствующие ходовые огни.");
  if ((targetProfile.kind === "nuc" || targetProfile.kind === "ram") && targetProfile.makingWay) targetLightGuidance.notes.push("При движении относительно воды выставляются также соответствующие ходовые огни.");
  const limitations = [
    "Классификация геометрическая и зависит от введённых профилей; алгоритм не распознаёт огни, знаки, тип судна или его фактическую операцию автоматически.",
    "CPA/TCPA предполагает постоянство курсов и скоростей. Манёвры, дрейф, ветер, течение, мелководье и гидродинамическое взаимодействие не моделируются.",
    "Правила 9 и 10 требуют реальной карты, геометрии фарватера/TSS и местных правил; интерфейс учитывает только заданный пользователем факт нахождения в соответствующей зоне.",
    "Порог DCPA — учебная настройка, а не универсальная безопасная дистанция или норматив МППСС-72.",
    "Признак Rule 7 по постоянному пеленгу и уменьшающейся дистанции — упрощённая проверка последних радиолокационных измерений, а не доказательство риска и не замена систематической прокладки.",
    "При сомнении, неполных данных или особых обстоятельствах нельзя полагаться на автоматическую классификацию; действует ответственность по правилу 2.",
  ];

  return {
    encounter,
    primaryRule,
    rule: primaryRule,
    title,
    ownShipDuty,
    responsibility,
    targetRelativeBearingDeg: ownRelativeBearing,
    ownRelativeBearingDeg: targetRelativeBearing,
    courseDifferenceDeg: courseDifference,
    closingSpeedKn: closing,
    rangeNm,
    dcpaNm: cpa?.dcpaNm ?? null,
    tcpaMin: cpa?.tcpaMin ?? null,
    collisionRisk,
    bearingTrend: radarTrend.bearingTrend,
    rangeTrend: radarTrend.rangeTrend,
    rule7RiskIndication: radarTrend.rule7RiskIndication,
    applicableRules,
    ownLightGuidance,
    targetLightGuidance,
    limitations,
  };
}

/**
 * Compares two snapshots of relative-motion prediction.
 * It reports trend only; it cannot decide whether a manoeuvre is legally sufficient.
 */
export function evaluateColregManeuver(
  ownBefore: VesselState,
  ownAfter: VesselState,
  targetBefore: VesselState,
  targetAfter: VesselState,
): ManeuverEvaluation {
  [ownBefore, ownAfter, targetBefore, targetAfter].forEach(validateVessel);
  const before = calculateCpa(ownBefore, targetBefore);
  const after = calculateCpa(ownAfter, targetAfter);
  const courseChangeDeg = Math.abs(signedAngle(ownAfter.courseDeg - ownBefore.courseDeg));
  const speedChangeKn = ownAfter.speedKn - ownBefore.speedKn;
  let cpaTrend: ManeuverEvaluation["cpaTrend"] = "undetermined";
  if (before && after) {
    if (after.dcpaNm > before.dcpaNm + 0.02) cpaTrend = "improved";
    else if (after.dcpaNm < before.dcpaNm - 0.02) cpaTrend = "degraded";
    else cpaTrend = "unchanged";
  }
  const observation = cpaTrend === "improved"
    ? "Расчётный DCPA увеличился относительно исходного состояния."
    : cpaTrend === "degraded"
      ? "Расчётный DCPA уменьшился: текущий манёвр ухудшает прогнозируемое расхождение."
      : cpaTrend === "unchanged"
        ? "Расчётный DCPA существенно не изменился."
        : "Недостаточно данных для сравнения CPA.";
  return {
    courseChangeDeg,
    speedChangeKn,
    dcpaBeforeNm: before?.dcpaNm ?? null,
    dcpaAfterNm: after?.dcpaNm ?? null,
    tcpaBeforeMin: before?.tcpaMin ?? null,
    tcpaAfterMin: after?.tcpaMin ?? null,
    cpaTrend,
    observation,
    caution: "Сравнение — только кинематическая подсказка. Заблаговременность, заметность, безопасность для других целей и достаточность манёвра требуют полной оценки обстановки и наблюдения до чистого расхождения.",
  };
}
