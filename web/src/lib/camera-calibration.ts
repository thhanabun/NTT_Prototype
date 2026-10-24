export type Point = { x: number; y: number };

export function floorHomography(points: Point[]) {
  if (points.length !== 4) throw new Error("เลือกจุดบนพื้น 4 จุด");
  const cross = points.map((a, i) => {
    const b = points[(i + 1) % 4], c = points[(i + 2) % 4];
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  });
  const area = Math.abs(points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % 4].y - p.y * points[(i + 1) % 4].x, 0)) / 2;
  if (area < .03 || cross.some(value => value <= 1e-5)) throw new Error("เรียงมุม ซ้ายบน → ขวาบน → ขวาล่าง → ซ้ายล่าง ให้เป็นสี่เหลี่ยมไม่ไขว้กัน");
  const targets = [{ x: .05, y: .05 }, { x: .95, y: .05 }, { x: .95, y: .95 }, { x: .05, y: .95 }];
  const rows = points.flatMap(({ x, y }, i) => {
    const { x: u, y: v } = targets[i];
    return [[x, y, 1, 0, 0, 0, -u*x, -u*y, u], [0, 0, 0, x, y, 1, -v*x, -v*y, v]];
  });
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const divisor = rows[col][col];
    if (Math.abs(divisor) < 1e-9) throw new Error("จุดอ้างอิงใกล้เส้นตรงเกินไป กรุณาเลือกใหม่");
    rows[col] = rows[col].map(value => value / divisor);
    for (let row = 0; row < 8; row++) if (row !== col) {
      const factor = rows[row][col];
      rows[row] = rows[row].map((value, i) => value - factor * rows[col][i]);
    }
  }
  return [...rows.map(row => row[8]), 1];
}

export function projectFloor(point: Point, h: number[]): Point | null {
  const denominator = h[6] * point.x + h[7] * point.y + 1;
  if (Math.abs(denominator) < 1e-8) return null;
  const x = (h[0]*point.x + h[1]*point.y + h[2]) / denominator;
  const y = (h[3]*point.x + h[4]*point.y + h[5]) / denominator;
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}
