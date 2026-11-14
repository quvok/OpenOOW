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
