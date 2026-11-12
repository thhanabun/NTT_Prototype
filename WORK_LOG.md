# Work log — `basketdetection` branch

Running log of changes on this branch. Newest entries at the bottom. Design and decisions: [docs/basket-detection.md](docs/basket-detection.md).

## 2026-11-13 — Summary of work before this log

| Commit | What |
| --- | --- |
| `44fc005` | Design doc for camera + BLE shopper tracking |
| `1b3bee1` | Drawn store map, multi-camera mapping, presence service (camera tracks → shoppers, BLE basket linking) |
| `9223e0c` | Pick-time presence evidence, `get_shopper_presence` Agent tool, guard (off by default) |
| `f1c2603` | Turnable map shapes, undo/redo, drag-to-fit camera mapping |
| `5d0941d` | Side-by-side camera + map setup window: draw either side, Sync buttons, mismatch in metres, check tool |

Tests at `5d0941d`: backend `npm test` 81/81; web `test:unit` 4/4; web `test:e2e` (auth, Shopper, Admin, native SSE) pass; typecheck and lint clean.

Worth attention:
- The saved local store map (`data/store-map.json`) had **no shapes** when last checked; left unchanged on purpose.
- Not verified: real webcams/phones in the store, and mouse dragging in a visible browser window (tested with keyboard and scripted pointer events).
- Cloud mode (P5) does not have the store-map / presence routes yet.

## Verification and polish pass (automated request from a scheduled session)

Assumption: "keep improving" means small, safe fixes on this branch; nothing is pushed.

### 1. Setup window behaves like a dialog
- **Why:** focus stayed on the page behind, the page behind could scroll, and the floating FAST menu button covered the window.
- **Change:** focus moves into the window on open and returns on close; page scroll is locked while open; Escape closes (asks first if there are unsaved changes); window stacks above the floating menu; tighter padding on phones.
- **Files:** `web/src/components/admin/camera-map-setup.tsx`, `web/src/components/admin/customer-detection.module.css`
- **Checked:** browser at 375×812: no sideways scroll, focus inside the dialog, scroll lock on and released after Escape.

### 2. Confirm before deleting a camera mapping
- **Why:** one click removed a saved mapping with no way back.
- **Change:** a confirmation names the camera and what happens next.
- **Files:** `web/src/components/admin/camera-feed.tsx`

### 3. Cloud mode regression fixed
- **Why:** the live camera tab now needs the store-map and presence routes, which the cloud does not have yet (P5). In cloud mode the tab would show only an error, losing the single live camera that worked before.
- **Change:** in cloud mode the live tab uses the original single-camera view (restored from `main` as `cloud-live-customer-detection.tsx`), and the map tab explains that map setup is local-only until P5. `floorHomography` / `projectFloor` were restored in `camera-calibration.ts` for it, now built on the shared solver.
- **Files:** `web/src/components/admin/cloud-live-customer-detection.tsx` (new), `customer-detection.tsx`, `web/src/lib/camera-calibration.ts`, `web/tests/camera-calibration.test.mjs`
- **Tests:** web `test:unit` 5/5 (new test for the cloud calibration); typecheck and lint clean.

### 4. Empty-map hint
- **Why:** the saved map is currently empty, and the editor showed only a blank box.
- **Change:** an empty map shows how to start (“+ Shelf”, “+ พื้นที่”, or draw on the camera).
- **Files:** `web/src/components/admin/store-map-editor.tsx`
- **Checked:** shown in the browser on the map tab.

### Test run after this pass
- Backend `npm test`: 82/82 pass.
- Web: typecheck and lint clean; `test:unit` 5/5; `test:e2e` (auth, Shopper, Admin, native SSE) all pass; `test:cloud` passes (its `403 Staff access required` lines are expected checks).

### Still open / worth attention
- Cloud (P5): store-map, presence and multi-camera setup are local-only; cloud keeps the original single live camera.
- Real store check: real webcams/phones and mouse dragging in a visible window still need a person to try.
- The local saved map is empty; the first setup starts from scratch.
- Measuring accuracy (P6) and the guard (`PRESENCE_GUARD`, off) are not started.
