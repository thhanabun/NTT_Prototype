import recording from "./customer-tracking-recording.json";

export interface CustomerDetection {
  basketId: string;
  trackId: number;
  confidence: number;
  box: number[];
  mapPoint: { x: number; y: number } | null;
}

export interface TrackingFrame {
  time: number;
  detections: CustomerDetection[];
  alignmentValid: boolean;
}

export const customerRecording = recording;

export function recordingFrameIndex(time: number) {
  let low = 0, high = recording.frames.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (recording.frames[mid].time <= time) low = mid;
    else high = mid - 1;
  }
  return low;
}

export function trackSegments(frames: TrackingFrame[], basketId: string) {
  const segments: { x: number; y: number }[][] = [];
  let previousTime = -Infinity;
  for (const frame of frames) {
    const point = frame.detections.find(d => d.basketId === basketId)?.mapPoint;
    if (!point) { previousTime = -Infinity; continue; }
    if (frame.time - previousTime > .25) segments.push([]);
    segments[segments.length - 1].push(point);
    previousTime = frame.time;
  }
  return segments;
}
