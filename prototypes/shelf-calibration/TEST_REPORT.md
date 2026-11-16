# Test report: store map page (2026-11-13)

Scripted tests in the browser (real click/drag/key events on the page) plus server checks. EPFL lab videos used for cameras; accuracy measured against EPFL's own calibration. The page was not looked at in a normal browser window; two rendered snapshots were checked instead (cameras + map while people walk; camera zoomed out).

## Result

**All checks pass after 4 bugs were fixed during the run.** No script errors in the browser console.

| Area | Checks | Result |
| --- | --- | --- |
| Server: routes, video files, `/status`, `/segment` (MobileSAM + GrabCut), `/people` (per-camera trackers), bad input, folder escape | 12 | pass |
| Old page `/v1` | 1 | pass |
| Map: draw/rename/size/angle/front/move/resize/rotate/delete references, Delete key, undo | 15 | pass |
| Map: shop area, zone, close by first point / Enter, Esc, 2-point refused, rename, kind, drag corner, move | 8 | pass |
| Drawing: rectangle, shape, line/wall + thickness, text + size, rename, colour, move, drag corner, → zone + undo, lock, hide | 13 | pass |
| Layers, zoom (wheel/buttons), pan, fit, map mode on/off, check tool | 13 | pass |
| Cameras: sample load, link by numbered corners, counters (x of 6 / 7 / 5), "needs N more", edge counting, level off, typed height | 15 | pass |
| Cameras: turned numbering → "แก้ให้", mirrored numbering, ✕ / right-click / Delete key / Ctrl+Z (incl. with dropdown focused, not while typing), drag selected point, map corner number pick | 12 | pass |
| Cameras: zoom (wheel/buttons), Alt-drag pan, click outside picture (marked), too far refused, reset, check + zone from a camera | 7 | pass |
| References from cameras: measured from a linked camera (2 corners outside the picture: centre 0.36 m off), MobileSAM auto, unplaced from an unlinked camera → drag to place → camera links, undo; add/rename/offset/delete camera | 12 | pass (see notes) |
| EPFL samples full / ก / ข / ค: both cameras linked; camera 2 vs truth 0.06 / 0.06 / 0.18 / 0.08 m median; same floor spot from both cameras 0.17 / 0.15 / – / 0.12 m | 11 | pass |
| Playback: seeking, cameras in step, people + numbers, same number in both cameras, paths, hide paths/people, ✕ + Ctrl+Z while playing, pause/resume, end of video, ⏮, play again | 14 | pass |
| People data: foot matches + heights collected, agreement line, "camera may have moved" warning, foot tuning not offered, rough heights link a 2-corner camera and are ignored once corners suffice, own video file (lens centre reset) | 10 | pass |
| Saving across reload: references, areas, drawings, links, camera name/height, map mode, layers + locks, map view; videos not stored; Esc; clear-all with confirm + undo | 16 | pass |

## Bugs found and fixed

1. **Videos could not seek** (server sent whole files, no byte ranges). Camera 2 jumped back to 0 s and stalled whenever it fell 0.25 s behind camera 1; ⏮ was affected too. Server now answers range requests (206, 8 MB pieces), and the page only jumps when the video is seekable.
2. **Placing an unplaced reference did not tie its camera** until something else changed (the "unplaced" flag was missing from the camera fit's cache key).
3. **Saved layer settings were applied but the checkboxes showed defaults** after a reload.
4. A syntax slip introduced while fixing 1 (a `//` comment in a one-line statement) broke the page; caught by the run and fixed.

## Notes / limits seen

- **MobileSAM "หามุมเอง" on a flat rug** finds the corners only roughly (2.86 × 1.23 m vs 3.6 × 2.2 m, centre 0.97 m off): the corner finder was built for shelves with height. Check its outline and drag corners, or click 4 corners.
- **First play after the server starts** detects nothing for a few seconds while each camera's tracker loads its model.
- **People heights** are rough (~0.8 m in the EPFL test) and only used for a camera that cannot be tied with corners.
- Labels: now short (corner number only) except for the reference being worked on; on very small objects zoom into the camera to separate them.

## Follow-up (2026-11-14): other videos

- Repo shop clip `walk.webm` (different room/camera, 960×540): linked from one 0.8 × 0.5 m table; the other two tables measured 0.84 × 0.42 and 0.74 × 0.49 m. All clicks in one narrow strip → estimated camera height 17.5 m, floor outside the strip guessed → new warning shown (card, camera list, dashed amber grid when zoomed out). Typed height 3 m → realistic grid, warning gone.
- EPFL cameras (clicks spread over the picture): no warning (heights 3.3 / 3.4 m).

## Follow-up (2026-11-14): new corner controls + full view

All scripted checks pass (real click/drag/key events), at 1366 × 800 and in a small 600 × 547 pane:
- Adding: plain click adds nothing; ＋ arms, click places and disarms (no jump to the next number); ＋ twice cancels; edges need 2 clicks.
- Points: drag any point directly; click selects (no move); floating toolbar renumber (swaps), ↻ re-place, 🗑; Delete removes the *selected* point (nothing when none selected); right-click; Ctrl+Z / Ctrl+Y.
- Suggested corners appear once linked; double-click adds one (on EPFL camera 2 with the minimum 6 values the guess was 23 px from the real corner, then dragged onto it); map corner numbers arm/select; zoomed-out armed click outside the picture is marked outside; magnifier redraws with the mouse.
- Full view: camera and map fill the window (page scroll hidden), picture enlarged keeping its shape (629 → 739 px wide at 1366 × 800, height-limited), point toolbar next to the point and not covering it, mini map over the picture's corner with clickable corners, Esc twice (cancel, then leave), ⛶ switching, playing in full view.
- Regression: all EPFL samples linked through the new controls, camera 2 vs truth 0.05 / 0.02 / 0.14 / 0.06 m median (full / ก / ข / ค); ✚ reference from a camera; zone drawing; playback in step; links saved across reload.
- Bugs found and fixed during this run: full-view picture did not enlarge; toolbar and mini map were offset when the picture is centred in full view; toolbar could overlap its point near the right edge.

## Follow-up (2026-11-14): corner count + points-only bar + lines from points

- Corner-count box: default 4, Esc / cancel, < 3 refused; 4 = rectangle drag as before; 5-corner reference by clicks (numbered in click order), corner drag, move, turn (shape kept), undo, list "5 มุม", side lengths in the panel; 3-corner reference measured from tied camera 1 (corners within 0.46 m of the real carpet corners, 2 of them clicked outside the picture); untied camera refuses a 5-corner reference with a message; 5-corner reference kept across reload.
- Camera 2 linked through a 5-corner floor-plan reference + rug: 0.01 m median vs truth.
- Lines: Shift+click + ╱ ทำเป็นเส้น; ╱ เส้น… + second point; ╱ เส้น… + empty spot along an edge from a visible corner (corner kept); แยกเป็นจุด; undo.
- All EPFL samples using points + both kinds of line (strict check: every line's points on its labelled true edge, no edge used twice): camera 2 median 0.06 / 0.03 / 0.14 / 0.06 m (full / ก / ข / ค). Slowest click ≈ 1.1 s (the page re-checks guessed edges after each point).
- Bugs found and fixed during this run: 5-corner reference crashed the reference list; corners drawn on the map were renumbered against the click order; line from a visible corner was missing (regression vs the old edge buttons); guessed edge choice wrong without neighbours; an early decision about a corner's two lines was locked in; a re-check could put two lines on one edge.
