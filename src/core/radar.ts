import type { VesselState } from "./navigation";
import { velocityFromCourse } from "./navigation";

export interface RadarPoint {
  x: number;
  y: number;
}

export interface RadarVector {
  dx: number;
  dy: number;
}

/** Projects a contact into a north-up PPI centred on the own ship. */
export function projectRelativePosition(
  own: Pick<VesselState, "xNm" | "yNm">,
  target: Pick<VesselState, "xNm" | "yNm">,
  rangeNm: number,
  radiusPx: number,
  centerPx: number,
): RadarPoint {
  if (!Number.isFinite(rangeNm) || rangeNm <= 0 || !Number.isFinite(radiusPx) || radiusPx <= 0) {
    throw new RangeError("Radar range and radius must be finite and greater than zero.");
  }
  return {
    x: centerPx + ((target.xNm - own.xNm) / rangeNm) * radiusPx,
    y: centerPx - ((target.yNm - own.yNm) / rangeNm) * radiusPx,
  };
}

/** Projects a target's course/speed vector onto a north-up PPI for a chosen vector time. */
export function courseVectorToRadar(
  courseDeg: number,
  speedKn: number,
  vectorMinutes: number,
  rangeNm: number,
  radiusPx: number,
): RadarVector {
  if (![speedKn, vectorMinutes, rangeNm, radiusPx].every(Number.isFinite) ||
      speedKn < 0 || vectorMinutes < 0 || rangeNm <= 0 || radiusPx <= 0) {
    throw new RangeError("Radar vector inputs must be finite and non-negative; range and radius must be positive.");
  }
  const velocity = velocityFromCourse(courseDeg, speedKn);
  const hours = vectorMinutes / 60;
  return {
    dx: (velocity.eastKn * hours / rangeNm) * radiusPx,
    dy: -(velocity.northKn * hours / rangeNm) * radiusPx,
  };
}

export type RadarVectorMode = "true" | "relative";

/** Returns a target vector in true or own-ship-relative motion mode. */
export function motionVectorToRadar(
  own: Pick<VesselState, "courseDeg" | "speedKn">,
  target: Pick<VesselState, "courseDeg" | "speedKn">,
  mode: RadarVectorMode,
  vectorMinutes: number,
  rangeNm: number,
  radiusPx: number,
): RadarVector {
  const targetVelocity = velocityFromCourse(target.courseDeg, target.speedKn);
  const ownVelocity = velocityFromCourse(own.courseDeg, own.speedKn);
  const relative = mode === "relative";
  const eastKn = targetVelocity.eastKn - (relative ? ownVelocity.eastKn : 0);
  const northKn = targetVelocity.northKn - (relative ? ownVelocity.northKn : 0);
  if (![vectorMinutes, rangeNm, radiusPx].every(Number.isFinite) || vectorMinutes < 0 || rangeNm <= 0 || radiusPx <= 0) {
    throw new RangeError("Radar vector inputs must be finite; vector time must be non-negative and range/radius positive.");
  }
  const hours = vectorMinutes / 60;
  return {
    dx: (eastKn * hours / rangeNm) * radiusPx,
    dy: -(northKn * hours / rangeNm) * radiusPx,
  };
}
