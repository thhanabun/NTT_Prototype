export type Point = { x: number; y: number };

const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);

/** True when the 4 points form a non-crossed quadrilateral in the given order (either direction). */
export function isConvexQuad(points: Point[]) {
  const turns = points.map((a, i) => cross(a, points[(i + 1) % 4], points[(i + 2) % 4]));
  return turns.every(t => t > 1e-9) || turns.every(t => t < -1e-9);
}

/** Homography mapping 4 source points onto 4 target points (h[8] = 1). */
export function homography(source: Point[], target: Point[]) {
  if (source.length !== 4 || target.length !== 4) throw new Error("ต้องใช้ 4 จุด");
  if (!isConvexQuad(source)) throw new Error("จุดที่คลิกไขว้กันหรือเรียงผิดลำดับ กรุณาคลิกใหม่ตามลำดับมุม");
  const rows = source.flatMap(({ x, y }, i) => {
    const { x: u, y: v } = target[i];
    return [[x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]];
  });
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const divisor = rows[col][col];
    if (Math.abs(divisor) < 1e-12) throw new Error("จุดอ้างอิงเกือบอยู่บนเส้นตรงเดียวกัน กรุณาเลือกใหม่");
    rows[col] = rows[col].map(value => value / divisor);
    for (let row = 0; row < 8; row++) if (row !== col) {
      const factor = rows[row][col];
      rows[row] = rows[row].map((value, i) => value - factor * rows[col][i]);
    }
  }
  return [...rows.map(row => row[8]), 1];
}

export function project(h: number[], point: Point): Point | null {
  const d = h[6] * point.x + h[7] * point.y + h[8];
  if (Math.abs(d) < 1e-12) return null;
  const x = (h[0] * point.x + h[1] * point.y + h[2]) / d, y = (h[3] * point.x + h[4] * point.y + h[5]) / d;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function invert(h: number[]) {
  const [a, b, c, d, e, f, g, i, j] = h;
  const det = a * (e * j - f * i) - b * (d * j - f * g) + c * (d * i - e * g);
  if (Math.abs(det) < 1e-15) throw new Error("Mapping cannot be inverted");
  return [e * j - f * i, c * i - b * j, b * f - c * e, f * g - d * j, a * j - c * g, c * d - a * f, d * i - e * g, b * g - a * i, a * e - b * d].map(v => v / det);
}

const area = (points: Point[]) => Math.abs(points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % points.length].y - p.y * points[(i + 1) % points.length].x, 0)) / 2;

/**
 * Mapping from any 4+ clicked corners. shortcut: with more than 4 it keeps the 4 most spread out in the image,
 * not a least-squares fit; upgrade if wide-angle lenses need every point.
 */
export function mappingFromCorners(image: Point[], map: Point[]) {
  if (image.length < 4 || image.length !== map.length) throw new Error("ต้องคลิกอย่างน้อย 4 มุม");
  let best: number[] = [0, 1, 2, 3], bestArea = -1;
  for (let a = 0; a < image.length; a++) for (let b = a + 1; b < image.length; b++) for (let c = b + 1; c < image.length; c++) for (let d = c + 1; d < image.length; d++) {
    const pick = [a, b, c, d];
    const cx = pick.reduce((s, k) => s + image[k].x, 0) / 4, cy = pick.reduce((s, k) => s + image[k].y, 0) / 4;
    pick.sort((p, q) => Math.atan2(image[p].y - cy, image[p].x - cx) - Math.atan2(image[q].y - cy, image[q].x - cx));
    const size = area(pick.map(k => image[k]));
    if (size > bestArea && isConvexQuad(pick.map(k => map[k]))) { best = pick; bestArea = size; }
  }
  if (bestArea < 0.002) throw new Error("มุมที่คลิกอยู่ใกล้กันเกินไป ลองเลือกมุมที่ห่างกันมากขึ้น");
  return homography(best.map(k => image[k]), best.map(k => map[k]));
}
