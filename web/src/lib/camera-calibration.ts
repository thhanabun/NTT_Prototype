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

/** Best homography for 4+ point pairs (exact for 4, least squares for more). Any order; rejects nearly-collinear sets. */
export function fitHomography(source: Point[], target: Point[]) {
  if (source.length < 4 || source.length !== target.length) throw new Error("ต้องมีอย่างน้อย 4 จุด");
  const ata = Array.from({ length: 8 }, () => new Array(9).fill(0));
  source.forEach(({ x, y }, i) => {
    const { x: u, y: v } = target[i];
    for (const [row, rhs] of [[[x, y, 1, 0, 0, 0, -u * x, -u * y], u], [[0, 0, 0, x, y, 1, -v * x, -v * y], v]] as [number[], number][]) {
      for (let r = 0; r < 8; r++) { for (let c = 0; c < 8; c++) ata[r][c] += row[r] * row[c]; ata[r][8] += row[r] * rhs; }
    }
  });
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) if (Math.abs(ata[row][col]) > Math.abs(ata[pivot][col])) pivot = row;
    [ata[col], ata[pivot]] = [ata[pivot], ata[col]];
    if (Math.abs(ata[col][col]) < 1e-12) throw new Error("จุดอยู่บนเส้นตรงเดียวกันเกินไป ลากมุมให้กระจายมากขึ้น");
    const d = ata[col][col];
    ata[col] = ata[col].map(v => v / d);
    for (let row = 0; row < 8; row++) if (row !== col) { const f = ata[row][col]; ata[row] = ata[row].map((v, i) => v - f * ata[col][i]); }
  }
  return [...ata.map(row => row[8]), 1];
}
