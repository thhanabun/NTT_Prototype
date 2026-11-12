import test from "node:test";
import assert from "node:assert/strict";
import { fitHomography, homography, invert, project } from "../src/lib/camera-calibration.ts";

const near = (a, b) => assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6, JSON.stringify([a, b]));
// A camera looking at a 20x8 shelf box at map (40,10): its corners appear as a trapezoid.
const image = [{ x: .30, y: .50 }, { x: .70, y: .50 }, { x: .80, y: .80 }, { x: .20, y: .80 }];
const map = [{ x: 40, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 18 }, { x: 40, y: 18 }];

test("clicked shape corners map exactly onto the shape, and back", () => {
  const h = homography(image, map);
  image.forEach((point, i) => near(project(h, point), map[i]));
  const back = invert(h);
  map.forEach((point, i) => near(project(back, point), image[i]));
});

test("least-squares fit matches the exact mapping and works with corners in any order", () => {
  const h = homography(image, map);
  const extraMap = [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 18 }, { x: 10, y: 18 }];
  const extraImage = extraMap.map(p => project(invert(h), p));
  const order = [2, 0, 3, 1];
  const fitted = fitHomography(order.map(i => image[i]), order.map(i => map[i]));
  map.forEach((point, i) => near(project(fitted, image[i]), point));
  const many = fitHomography([...image, ...extraImage], [...map, ...extraMap]);
  [...map, ...extraMap].forEach((point, i) => near(project(many, [...image, ...extraImage][i]), point));
  assert.throws(() => fitHomography([{ x: 0, y: 0 }, { x: .1, y: .1 }, { x: .2, y: .2 }, { x: .3, y: .3 }], map), /เส้นตรง/);
});

test("crossed clicks are rejected", () => {
  assert.throws(() => homography([image[0], image[2], image[1], image[3]], map), /ไขว้กัน/);
});
