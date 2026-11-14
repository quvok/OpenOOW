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

export type ColregResponsibility = "give-way" | "stand-on" | "no-specific-duty" | "undetermined";
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
}

export interface ColregEnvironment {
  visibility: "good" | "restricted";
  vesselsInSight: boolean;
  daylight: boolean;
  narrowChannel: boolean;
  trafficSeparationScheme: boolean;
  ownCrossingTrafficLane?: boolean;
  ownInshoreTrafficZone?: boolean;
  windDirectionKnown?: boolean;
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
  windDirectionKnown: false,
  riskDcpaNm: 0.5,
};

const generalDuties: ColregRuleDuty[] = [
  { rule: 5, title: "Наблюдение", duty: "Поддерживайте постоянное надлежащее наблюдение зрением, слухом и всеми доступными средствами.", status: "applies" },
  { rule: 6, title: "Безопасная скорость", duty: "Выбирайте скорость с учётом видимости, плотности движения, маневренности, фона огней, ветра, моря, течения, глубины и возможностей радара.", status: "applies" },
  { rule: 7, title: "Опасность столкновения", duty: "Используйте все доступные средства; при сомнении считайте опасность существующей. Не делайте выводов по скудным данным.", status: "applies" },
  { rule: 8, title: "Предупреждение столкновения", duty: "Действуйте заблаговременно, решительно и заметно; проверяйте эффективность манёвра до полного расхождения. При необходимости уменьшите ход или остановитесь.", status: "applies" },
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

function isForwardSector(relativeBearing: number): boolean {
  return relativeBearing < 112.5 || relativeBearing > 247.5;
}

function normalizeProfile(profile: Partial<ColregVesselProfile> | undefined): ColregVesselProfile {
  return { ...defaultProfile, ...profile };
}

function normalizeEnvironment(options: ColregAssessmentOptions): ColregEnvironment {
  const environment = { ...defaultEnvironment, ...options.environment };
  if (options.restrictedVisibility !== undefined && options.environment?.visibility === undefined) {
    environment.visibility = options.restrictedVisibility ? "restricted" : "good";
  }
  if (!Number.isFinite(environment.riskDcpaNm) || (environment.riskDcpaNm ?? -1) < 0) {
    throw new RangeError("Risk DCPA threshold must be finite and non-negative.");
  }
  return environment;
}

function profileRank(kind: ColregVesselKind): number | null {
  if (kind === "nuc" || kind === "ram") return 3;
  if (kind === "fishing") return 2;
  if (kind === "sailing") return 1;
  if (kind === "power-driven" || kind === "pilot" || kind === "towing" || kind === "other") return 0;
  return null;
}

function addDuty(list: ColregRuleDuty[], duty: ColregRuleDuty): void {
  if (!list.some((item) => item.rule === duty.rule && item.duty === duty.duty)) list.push(duty);
}

function classifyRule18(
  own: ColregVesselProfile,
  target: ColregVesselProfile,
): { responsibility: ColregResponsibility; duty: string } {
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
  const ownRank = profileRank(own.kind);
  const targetRank = profileRank(target.kind);
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
  const riskLimit = environment.riskDcpaNm ?? 0.5;
  const collisionRisk: ColregAssessment["collisionRisk"] = !cpa || cpa.tcpaMin <= 0
    ? "undetermined"
    : cpa.dcpaNm <= riskLimit ? "risk" : "no-immediate-risk";
  const hasRisk = collisionRisk === "risk";

  const applicableRules = [...generalDuties];
  let encounter: EncounterType = "uncertain";
  let primaryRule: number | null = null;
  let title = "Ситуация не классифицирована";
  let ownShipDuty = "Не делайте вывод о применимом правиле только по геометрии. Продолжайте наблюдение и оценку риска.";
  let responsibility: ColregResponsibility = "undetermined";

  if (environment.narrowChannel) {
    addDuty(applicableRules, {
      rule: 9,
      title: "Узкий проход",
      duty: "Держитесь ближе к правой внешней границе фарватера, насколько это безопасно и практически возможно. Не затрудняйте проход судну, которое может безопасно идти только в пределах канала; пересекайте канал только если не создаёте помех.",
      status: "applies",
    });
  }
  if (environment.trafficSeparationScheme) {
    addDuty(applicableRules, {
      rule: 10,
      title: "Система разделения движения",
      duty: "Следуйте полосой в общем направлении потока; избегайте разделительной полосы и зоны разделения. Если пересекаете полосу, делайте это по возможности под прямым углом; не затрудняйте движение судна, следующего по полосе.",
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
      addDuty(applicableRules, {
        rule: 10,
        title: "Прибрежная зона движения",
        duty: "Использование inshore traffic zone ограничено категориями судов и обстоятельствами, указанными в правиле 10; проверьте право нахождения в этой зоне.",
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

    if (ownProfile.underway && targetProfile.underway &&
        (ownProfile.kind === "sailing" || ownProfile.underSailAndPower) &&
        (targetProfile.kind === "sailing" || targetProfile.underSailAndPower)) {
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
                 ownProfile.windward !== null && targetProfile.windward !== null) {
        responsibility = ownProfile.windward ? "give-way" : "stand-on";
        ownShipDuty = ownProfile.windward
          ? "На одном галсе наветренное судно должно держаться в стороне от подветренного."
          : "Подветренное судно сохраняет курс и скорость; контролируйте обстановку.";
      } else {
        ownShipDuty = "Нельзя надёжно определить галс или наветренную сторону. При сомнении примените консервативное действие: держитесь в стороне от другого парусного судна.";
        responsibility = "undetermined";
      }
      applicableRules.push({ rule: 12, title: "Парусные суда", duty: ownShipDuty, status: "applies" });
    } else {
      const ownOvertaking = isAbaftBeam(targetRelativeBearing) && closing > 0.05;
      const targetOvertaking = isAbaftBeam(ownRelativeBearing) && closing > 0.05;
      if (ownOvertaking) {
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
      } else if (ownProfile.kind === "power-driven" && targetProfile.kind === "power-driven" &&
                 Math.abs(180 - courseDifference) <= (options.headOnCourseToleranceDeg ?? 15) &&
                 Math.min(ownRelativeBearing, 360 - ownRelativeBearing) <= (options.headOnBearingToleranceDeg ?? 10) &&
                 Math.min(targetRelativeBearing, 360 - targetRelativeBearing) <= (options.headOnBearingToleranceDeg ?? 10)) {
        encounter = "head-on";
        primaryRule = 14;
        title = "Вероятная ситуация встречного сближения";
        responsibility = "give-way";
        ownShipDuty = "Правило 14: если действительно наблюдается встречное или почти встречное сближение двух механических судов, измените курс вправо, чтобы пройти левыми бортами. При сомнении считайте ситуацию встречной.";
      } else if (ownProfile.kind === "power-driven" && targetProfile.kind === "power-driven" &&
                 hasRisk && isForwardSector(ownRelativeBearing) &&
                 ownRelativeBearing > 0 && ownRelativeBearing < 112.5) {
        encounter = "crossing-starboard";
        primaryRule = 15;
        title = "Пересечение: цель справа";
        responsibility = "give-way";
        ownShipDuty = "Правило 15: собственное судно видит другое механическое судно справа и должно уступить дорогу. Правило 16 требует заблаговременного и решительного действия; по возможности не пересекайте курс цели перед её носом.";
      } else if (ownProfile.kind === "power-driven" && targetProfile.kind === "power-driven" &&
                 hasRisk && ownRelativeBearing > 247.5 && ownRelativeBearing < 360) {
        encounter = "crossing-port";
        primaryRule = 15;
        title = "Пересечение: цель слева";
        responsibility = "stand-on";
        ownShipDuty = "При подтверждённой ситуации пересечения цель находится слева, поэтому собственное судно обычно сохраняет курс и скорость по правилу 17. Это не освобождает от наблюдения и действий, когда этого требует правило 17.";
      } else {
        const hierarchy = classifyRule18(ownProfile, targetProfile);
        if (hierarchy.responsibility !== "undetermined" &&
            (ownProfile.kind !== targetProfile.kind)) {
          encounter = "vessel-priority";
          primaryRule = 18;
          title = "Взаимные обязанности по статусу судов";
          responsibility = hierarchy.responsibility;
          ownShipDuty = hierarchy.duty;
          applicableRules.push({ rule: 18, title: "Взаимные обязанности судов", duty: ownShipDuty, status: "conditional" });
        } else {
          ownShipDuty = "Геометрия не позволяет назначить конкретную обязанность по правилам 12–18. Учитывайте статусы судов, характер операции, местные условия и все доступные средства наблюдения.";
        }
      }
    }

    if (primaryRule === 13 || primaryRule === 14 || primaryRule === 15 || primaryRule === 18 || primaryRule === 12) {
      if (responsibility === "give-way") {
        applicableRules.push({ rule: 16, title: "Судно, уступающее дорогу", duty: "Предпринимайте заблаговременное и решительное действие, чтобы чисто разойтись; по возможности избегайте пересечения курса другого судна перед его носом.", status: "applies" });
      } else if (responsibility === "stand-on") {
        applicableRules.push({ rule: 17, title: "Судно, сохраняющее курс и скорость", duty: "Сохраняйте курс и скорость. Когда становится очевидно, что уступающее судно не действует должным образом, можете действовать самостоятельно; когда столкновения нельзя избежать только его действиями, обязаны предпринять наиболее эффективное действие.", status: "applies" });
      }
    }
  } else {
    ownShipDuty = environment.visibility === "restricted"
      ? "Суда не находятся на виду друг у друга: проверьте применимость правила 19 и используйте радарную информацию."
      : "Правила 11–18 для судов на виду пока не применяются: цель не подтверждена визуально. Продолжайте оценку по правилам 4–10.";
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

  const ownLightGuidance = getVesselLightGuidance(ownProfile.kind);
  const targetLightGuidance = getVesselLightGuidance(targetProfile.kind);
  const limitations = [
    "Классификация геометрическая и зависит от введённых профилей; алгоритм не распознаёт огни, знаки, тип судна или его фактическую операцию автоматически.",
    "CPA/TCPA предполагает постоянство курсов и скоростей. Манёвры, дрейф, ветер, течение, мелководье и гидродинамическое взаимодействие не моделируются.",
    "Правила 9 и 10 требуют реальной карты, геометрии фарватера/TSS и местных правил; интерфейс учитывает только заданный пользователем факт нахождения в соответствующей зоне.",
    "Порог DCPA — учебная настройка, а не универсальная безопасная дистанция или норматив МППСС-72.",
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
