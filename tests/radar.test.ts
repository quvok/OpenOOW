import { describe, expect, it } from "vitest";
import { courseVectorToRadar, projectRelativePosition } from "../src/core/radar";

describe("radar projection", () => {
  const own = { xNm: 0, yNm: 0 };

  it("keeps the own ship at the centre and plots a northern contact above it", () => {
    const point = projectRelativePosition(own, { xNm: 0, yNm: 1 }, 3, 220, 250);
    expect(point.x).toBeCloseTo(250);
    expect(point.y).toBeCloseTo(250 - 220 / 3);
  });

  it("plots an eastern contact to the right of own ship", () => {
    const point = projectRelativePosition(own, { xNm: 1, yNm: 0 }, 3, 220, 250);
    expect(point.x).toBeGreaterThan(250);
    expect(point.y).toBeCloseTo(250);
  });

  it("points the six-minute vector north for course zero", () => {
    const vector = courseVectorToRadar(0, 10, 6, 3, 220);
    expect(vector.dx).toBeCloseTo(0);
    expect(vector.dy).toBeLessThan(0);
  });

  it("points the six-minute vector east for course 090", () => {
    const vector = courseVectorToRadar(90, 10, 6, 3, 220);
    expect(vector.dx).toBeGreaterThan(0);
    expect(vector.dy).toBeCloseTo(0);
  });

  it("points the six-minute vector south for course 180", () => {
    const vector = courseVectorToRadar(180, 10, 6, 3, 220);
    expect(vector.dx).toBeCloseTo(0);
    expect(vector.dy).toBeGreaterThan(0);
  });

  it("points the six-minute vector west for course 270", () => {
    const vector = courseVectorToRadar(270, 10, 6, 3, 220);
    expect(vector.dx).toBeLessThan(0);
    expect(vector.dy).toBeCloseTo(0);
  });
});
