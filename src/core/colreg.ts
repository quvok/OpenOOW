import type { VesselState } from "./navigation";
import { calculateCpa, velocityFromCourse } from "./navigation";
import { normalize360 } from "./units";

export type EncounterType =
  | "restricted-visibility"
  | "overtaking"
  | "head-on"
  | "crossing-starboard"
  | "crossing-port"
  | "uncertain";

export interface ColregAssessment {
  encounter: EncounterType;
  rule: "19" | "13" | "14" | "15" | null;
  title: string;
  ownShipDuty: string;
  targetRelativeBearingDeg: number;
  ownRelativeBearingDeg: number;
  courseDifferenceDeg: number;
  closingSpeedKn: number;
  dcpaNm: number | null;
  tcpaMin: number | null;
  collisionRisk: "risk" | "no-immediate-risk" | "undetermined";
  limitations: string[];
}

export interface ColregAssessmentOptions {
  restrictedVisibility?: boolean;
  riskDcpaNm?: number;
  headOnCourseToleranceDeg?: number;
  headOnBearingToleranceDeg?: number;
}

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

/**
 * Conservative encounter geometry aid for training.
 * It does not determine legal status or replace a full COLREG assessment.
 */
export function assessColregEncounter(
  own: VesselState,
  target: VesselState,
  options: ColregAssessmentOptions = {},
): ColregAssessment {
  validateVessel(own);
  validateVessel(target);
  const range = Math.hypot(target.xNm - own.xNm, target.yNm - own.yNm);
  if (range < 1e-9) throw new RangeError("Own ship and target cannot occupy the same position.");

  const bearing = trueBearing(own, target);
  const ownRelativeBearing = normalize360(bearing - own.courseDeg);
  const targetRelativeBearing = normalize360(trueBearing(target, own) - target.courseDeg);
  const courseDifference = Math.abs(signedAngle(target.courseDeg - own.courseDeg));
  const closing = closingSpeed(own, target, bearing);
  const cpa = calculateCpa(own, target);
  const riskLimit = options.riskDcpaNm ?? 0.5;
  if (!Number.isFinite(riskLimit) || riskLimit < 0) throw new RangeError("Risk DCPA threshold must be finite and non-negative.");

  let encounter: EncounterType = "uncertain";
  let rule: ColregAssessment["rule"] = null;
  let title = "Ситуация не классифицирована";
  let ownShipDuty = "Не делайте вывод о применимом правиле только по геометрии. Продолжайте наблюдение и оценку риска столкновения.";

  if (options.restrictedVisibility) {
    encounter = "restricted-visibility";
    rule = "19";
    title = "Плавание в условиях ограниченной видимости";
    ownShipDuty = "Применяйте правило 19: безопасная скорость, машины в готовности, тщательная оценка радиолокационной информации. Избегайте поворота влево для цели впереди траверза, кроме обгона; насколько возможно, избегайте поворота в сторону цели на траверзе или позади него.";
  } else {
    const headOnCourseTolerance = options.headOnCourseToleranceDeg ?? 15;
    const headOnBearingTolerance = options.headOnBearingToleranceDeg ?? 10;
    if (![headOnCourseTolerance, headOnBearingTolerance].every(Number.isFinite) ||
        headOnCourseTolerance < 0 || headOnCourseTolerance > 45 ||
        headOnBearingTolerance < 0 || headOnBearingTolerance > 45) {
      throw new RangeError("Head-on tolerances must be between 0 and 45 degrees.");
    }

    const targetIsAbaftOwnBeam = targetRelativeBearing > 112.5 && targetRelativeBearing < 247.5;
    if (targetIsAbaftOwnBeam && closing > 0.05) {
      encounter = "overtaking";
      rule = "13";
      title = "Вероятная ситуация обгона";
      ownShipDuty = "Если судно является обгоняющим по смыслу правила 13, оно обязано держаться в стороне от пути обгоняемого до окончательного прохода и чистого расхождения. При сомнении считайте себя обгоняющим.";
    } else if (Math.abs(180 - courseDifference) <= headOnCourseTolerance &&
               Math.min(ownRelativeBearing, 360 - ownRelativeBearing) <= headOnBearingTolerance) {
      encounter = "head-on";
      rule = "14";
      title = "Вероятная ситуация встречного сближения";
      ownShipDuty = "Если оба судна — механические и ситуация действительно встречная, каждое должно изменить курс вправо, чтобы пройти левыми бортами. При сомнении считайте ситуацию встречной.";
    } else if (ownRelativeBearing > 0 && ownRelativeBearing < 112.5) {
      encounter = "crossing-starboard";
      rule = "15";
      title = "Цель на правом борту — возможное пересечение";
      ownShipDuty = "Если оба судна — механические и ситуация пересечения подтверждена, собственное судно должно уступить дорогу и, насколько возможно, не пересекать курс цели перед её носом (правила 15–16).";
    } else if (ownRelativeBearing > 247.5 && ownRelativeBearing < 360) {
      encounter = "crossing-port";
      rule = "15";
      title = "Цель на левом борту — возможное пересечение";
      ownShipDuty = "Собственное судно может быть судном, сохраняющим курс и скорость, только если применимость правила 15 подтверждена. Контролируйте действия другого судна и будьте готовы к манёвру по правилу 17.";
    }
  }

  const collisionRisk: ColregAssessment["collisionRisk"] = !cpa || cpa.tcpaMin <= 0
    ? "undetermined"
    : cpa.dcpaNm <= riskLimit ? "risk" : "no-immediate-risk";

  return {
    encounter,
    rule,
    title,
    ownShipDuty,
    targetRelativeBearingDeg: ownRelativeBearing,
    ownRelativeBearingDeg: targetRelativeBearing,
    courseDifferenceDeg: courseDifference,
    closingSpeedKn: closing,
    dcpaNm: cpa?.dcpaNm ?? null,
    tcpaMin: cpa?.tcpaMin ?? null,
    collisionRisk,
    limitations: [
      "Предполагаются постоянные курсы и скорости; манёвры целей и собственного судна в прогнозе не учитываются.",
      "Неизвестны типы судов, их статус, ограничения манёвренности, огни и знаки; правила 15 и 14 применимы только при выполнении соответствующих условий.",
      "Не учитываются схемы разделения движения, узкости, фарватеры, местные правила, ветер, течение и волновое воздействие.",
      "Классификация геометрическая и учебная; при сомнении требуется консервативная оценка и соблюдение МППСС-72 в полном объёме.",
    ],
  };
}
