"use client";

import type { KeyboardEvent, PointerEvent, Ref } from "react";
import type { BasketId, PresenceSnapshot, StoreLayout, StoreZone } from "@/lib/api/types";
import { anchorPoint, shelfZone, shortLabel, standPoint } from "@/lib/store-layout";
import styles from "./store-map-canvas.module.css";

export type ZoneGrab = "move" | "resize" | "anchor";

interface Props {
  layout: StoreLayout;
  presence: PresenceSnapshot | null;
  // The shopper's own basket gets the big pin; null draws every basket the same (Admin).
  basketId: BasketId | null;
  label: string;
  editable?: boolean;
  selectedZoneId?: string | null;
  svgRef?: Ref<SVGSVGElement>;
  onZonePointerDown?: (event: PointerEvent<SVGElement>, zone: StoreZone, grab: ZoneGrab) => void;
  onCanvasPointerDown?: () => void;
  onKeyDown?: (event: KeyboardEvent<SVGSVGElement>) => void;
}

export function StoreMapCanvas({ layout, presence, basketId, label, editable = false, selectedZoneId = null, svgRef, onZonePointerDown, onCanvasPointerDown, onKeyDown }: Props) {
  const online = new Map(presence?.shelves.map((shelf) => [shelf.shelfId, shelf.online]) ?? []);
  const baskets = presence?.baskets ?? [];
  const positions = presence?.positioning?.positions ?? {};
  // A basket is drawn at its (x, y) estimate when positioning has one, else in front of its zone shelf.
  const zoned = baskets
    .filter((basket) => !positions[basket.basketId])
    .map((basket) => ({ basket, zone: shelfZone(layout, basket.zone) }))
    .filter((item): item is { basket: (typeof baskets)[number]; zone: StoreZone } => Boolean(item.zone));
  const offsetFor = (zone: StoreZone, basketIdAt: BasketId) => {
    const here = zoned.filter((item) => item.zone.id === zone.id).map((item) => item.basket.basketId);
    return here.length < 2 ? 0 : (here.indexOf(basketIdAt) - (here.length - 1) / 2) * 26;
  };
  const markers = [
    ...zoned.map(({ basket, zone }) => ({ basketId: basket.basketId, point: standPoint(layout, zone, offsetFor(zone, basket.basketId)), radius: 0 })),
    ...baskets.filter((basket) => positions[basket.basketId]).map((basket) => {
      const position = positions[basket.basketId]!;
      return { basketId: basket.basketId, point: { x: position.x, y: position.y + 8 }, radius: position.radius };
    }),
  ];
  // Draw the shopper's own pin last so it sits on top.
  const ordered = [...markers].sort((a, b) => Number(a.basketId === basketId) - Number(b.basketId === basketId));
  // ESP32s are infrastructure: only staff editing the map need to see them.
  const anchors = editable ? layout.zones.filter((zone) => zone.kind === "shelf" && zone.shelfId) : [];

  return (
    <svg
      ref={svgRef}
      className={`${styles.map} ${editable ? styles.editable : ""}`}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role={editable ? "application" : "img"}
      aria-label={label}
      tabIndex={editable ? 0 : undefined}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => { if (event.target === event.currentTarget) onCanvasPointerDown?.(); }}
    >
      <rect className={styles.floor} x="1" y="1" width={layout.width - 2} height={layout.height - 2} rx="14"
        onPointerDown={() => onCanvasPointerDown?.()} />

      {layout.zones.map((zone) => {
        const selected = editable && zone.id === selectedZoneId;
        const isShelf = zone.kind === "shelf";
        const isOnline = isShelf && (online.get(zone.shelfId ?? "") ?? false);
        const isHere = isShelf && basketId !== null && baskets.some((b) => b.basketId === basketId && b.zone === zone.shelfId);
        const kindClass = isShelf ? styles.shelf : zone.kind === "cashier" ? styles.cashier : styles.entrance;
        const stateClass = isShelf ? `${isHere ? styles.shelfHere : ""} ${isOnline ? "" : styles.shelfOffline}` : "";
        const compact = zone.w < 92;
        return (
          <g key={zone.id} className={`${styles.zone} ${kindClass} ${stateClass} ${selected ? styles.selected : ""}`}
            onPointerDown={editable ? (event) => onZonePointerDown?.(event, zone, "move") : undefined}>
            <rect x={zone.x} y={zone.y} width={zone.w} height={zone.h} rx={Math.min(8, zone.h / 3)} />
            {isShelf ? <>
              <text className={styles.zoneLabel} x={zone.x + 10} y={zone.y + zone.h / 2 + 4}>
                {shortLabel(zone.label, zone.w, compact ? 26 : 52)}
              </text>
              {!compact && <text className={styles.zoneTag} x={zone.x + zone.w - 20} y={zone.y + zone.h / 2 + 4} textAnchor="end">
                {zone.shelfId?.replace("SHELF-", "S")}
              </text>}
              <circle className={isOnline ? styles.dotOnline : styles.dotOffline} cx={zone.x + zone.w - 10} cy={zone.y + zone.h / 2} r="4" />
            </> : (
              <text className={zone.kind === "entrance" ? styles.entranceLabel : styles.zoneLabel}
                x={zone.x + zone.w / 2} y={zone.y + zone.h / 2 + 4} textAnchor="middle">
                {shortLabel(zone.label, zone.w, 10)}
              </text>
            )}
            {selected && <rect className={styles.handle} x={zone.x + zone.w - 7} y={zone.y + zone.h - 7} width="12" height="12" rx="3"
              onPointerDown={(event) => { event.stopPropagation(); onZonePointerDown?.(event, zone, "resize"); }} />}
          </g>
        );
      })}

      {/* ESP32 anchors: where each shelf's board is mounted. Draggable in the editor. */}
      {anchors.map((zone) => {
        const point = anchorPoint(zone);
        const isOnline = online.get(zone.shelfId ?? "") ?? false;
        return (
          <g key={`anchor-${zone.id}`} className={`${styles.anchor} ${editable ? styles.anchorEditable : ""} ${isOnline ? "" : styles.anchorOffline}`}
            transform={`translate(${point.x} ${point.y})`}
            onPointerDown={editable ? (event) => { event.stopPropagation(); onZonePointerDown?.(event, zone, "anchor"); } : undefined}>
            {editable && <circle className={styles.anchorHit} r="11" />}
            <circle className={styles.anchorDot} r={editable ? 5 : 3.5} />
            <path className={styles.anchorWaves} d="M-7 -5 A8 8 0 0 1 -7 5 M7 -5 A8 8 0 0 0 7 5" />
            {editable && <text className={styles.anchorLabel} y="-10" textAnchor="middle">{zone.shelfId?.replace("SHELF-", "ESP ")}</text>}
          </g>
        );
      })}

      {ordered.map(({ basketId: id, point, radius }) => {
        const mine = basketId === null || id === basketId;
        return (
          <g key={id} aria-hidden="true">
            {radius > 0 && mine && <circle className={styles.accuracy} style={{ transform: `translate(${point.x}px, ${point.y - 8}px)` }} r={radius} />}
            <g className={styles.marker} style={{ transform: `translate(${point.x}px, ${point.y}px)` }}>
              {mine ? <>
                {basketId !== null && <circle className={styles.pulse} r="16" />}
                <path className={styles.myPin} d="M0 8 C-9 -2 -11 -6 -11 -11 A11 11 0 1 1 11 -11 C11 -6 9 -2 0 8 Z" />
                <text className={styles.myLetter} y="-7" textAnchor="middle">{id}</text>
              </> : <>
                <circle className={styles.otherPin} r="9" />
                <text className={styles.otherLetter} y="4" textAnchor="middle">{id}</text>
              </>}
            </g>
          </g>
        );
      })}
    </svg>
  );
}
