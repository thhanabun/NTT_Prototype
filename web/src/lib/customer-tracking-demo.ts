import demo from "./customer-tracking-demo.json";

export { demo as customerTrackingDemo };

// shortcut: synthetic floor coordinates; replace with calibrated camera tracks when a clip is available.
export function demoPosition(points: number[][], time: number) {
  const end = points.findIndex(point => point[0] >= time);
  const before = points[Math.max(0, end < 0 ? points.length - 1 : end - 1)];
  const after = points[end < 0 ? points.length - 1 : end];
  const ratio = after[0] === before[0] ? 0 : Math.max(0, Math.min(1, (time - before[0]) / (after[0] - before[0])));
  return { x: before[1] + (after[1] - before[1]) * ratio, y: before[2] + (after[2] - before[2]) * ratio };
}

export function demoCameraBox({ x, y }: { x: number; y: number }) {
  const height = 50 + 55 * y;
  const width = height * 0.48;
  return { x: 32 + x * 896 - width / 2, y: 60 + y * 450 - height, width, height };
}
