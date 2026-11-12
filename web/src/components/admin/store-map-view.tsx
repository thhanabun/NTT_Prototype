"use client";

import type { ReactNode, SVGProps } from "react";
import type { StoreMap, StoreShape } from "@/lib/api/types";
import type { Point } from "@/lib/camera-calibration";

export const ASSUMED_WIDTH_M = 10;
export const metresPerUnit = (map: StoreMap) => map.metresPerUnit ?? ASSUMED_WIDTH_M / map.width;
/** Shape corners in click order: 1 top-left, 2 top-right, 3 bottom-right, 4 bottom-left (as drawn on the map). */
export const corners = (s: Pick<StoreShape, "x" | "y" | "w" | "h">): Point[] =>
  [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }];
export const shapeColor = (shape: StoreShape) => shape.kind === "shelf" ? "var(--c-hi)" : "var(--c-info)";

/** The store map drawing shared by the editor, the camera wizard and the live view. Children draw in map units. */
export function StoreMapView({ map, selectedId, cornerHint, children, label, ...svg }: {
  map: StoreMap; selectedId?: string | null; cornerHint?: number | null; children?: ReactNode; label: string;
} & Omit<SVGProps<SVGSVGElement>, "children">) {
  const pad = map.width * .03;
  const stroke = map.width / 300;
  const font = Math.max(map.width, map.height) / 34;
  return <svg viewBox={`${-pad} ${-pad} ${map.width + pad * 2} ${map.height + pad * 2}`} role="img" aria-label={label} {...svg}>
    <rect x={0} y={0} width={map.width} height={map.height} rx={stroke * 4} fill="var(--c-bg)" stroke="var(--c-line)" strokeWidth={stroke} />
    {map.shapes.map(shape => {
      const on = shape.id === selectedId;
      return <g key={shape.id} data-shape={shape.id}>
        <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={stroke * 2} fill={shapeColor(shape)} fillOpacity={on ? .32 : .16}
          stroke={shapeColor(shape)} strokeWidth={on ? stroke * 3 : stroke * 1.5} strokeDasharray={shape.kind === "area" ? `${stroke * 6} ${stroke * 4}` : undefined} />
        <text x={shape.x + shape.w / 2} y={shape.y + shape.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={font} fill="var(--c-ink)" style={{ pointerEvents: "none" }}>{shape.label}</text>
        {on && cornerHint !== null && cornerHint !== undefined && (() => {
          const point = corners(shape)[cornerHint];
          return <circle cx={point.x} cy={point.y} r={font * .55} fill="var(--c-hi)" stroke="var(--c-surface)" strokeWidth={stroke * 2} />;
        })()}
      </g>;
    })}
    {children}
    <text x={map.width} y={map.height + pad * .8} textAnchor="end" fontSize={font * .7} fill="var(--c-soft)">
      {map.metresPerUnit === null ? `สเกล: สมมติกว้าง ${ASSUMED_WIDTH_M} ม. (ยังไม่วัด)` : `สเกล: วัดแล้ว · กว้าง ${(map.width * map.metresPerUnit).toFixed(1)} ม.`}
    </text>
  </svg>;
}
