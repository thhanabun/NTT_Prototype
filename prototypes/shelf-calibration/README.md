# Shelf calibration prototype (throwaway)

Standalone test of: **drag a box around a shelf in the camera picture → the system finds the shelf's floor corners by itself → after one real size, the map is built (or a rough map is aligned) automatically.** Not part of the NTT_Prototype app; it only borrows its Python environment and demo video.

## Run

From this folder (Windows, Git Bash or PowerShell):

```
..\NTT_Prototype\.venv-vision\Scripts\python.exe -I server.py
```

Open http://127.0.0.1:8090. Self-check: `... server.py --selftest`. Regenerate the angled test picture: `... make_sample.py`.

## Store map page (current, http://127.0.0.1:8090)

The map is the truth; every camera ties to it the same way. The earlier one-reference-shelf page is kept at `/v1`.

1. **References on the map**: **▭ วาด Reference** (drag a box), or from a camera with **✚ Reference ใหม่: คลิก 4 มุม** / **▭ หามุมเอง** (MobileSAM). Each reference has a name you choose, a real size, and **numbered corners 1-4** (1 front-left, 2 front-right, 3 back-right, 4 back-left; the thick line is the front edge 1-2). Select it to rename, type length/depth/angle, **↻ เปลี่ยนด้านหน้า** (camera links follow the physical corners), delete. Drag to move, corner squares to resize, round knob to turn. Zoom with the wheel or ＋/－/⤢, drag empty map to pan.
2. **Layers**: show/hide and lock references and areas; show people + paths; show each camera's floor coverage.
3. **Tie each camera**: pick the reference (list above the picture, or click it on the map), pick a corner number (buttons, or click the number on the map), click that corner where it touches the floor in the picture. Edges: pick edge 1–2 / 2–3 / 3–4 / 4–1 and click 2 points along it (ends may be hidden). It needs **8 independent values**: a corner = 2, an edge = 2 (1 if one of its end corners is also clicked, 0 if both). The camera is fitted as a real camera; each click shows its error in metres; mirrored numbering, points behind the camera and misnumbered references are reported, with **แก้ให้** when renumbering one reference fixes it. The picture shows every reference and area as the camera should see it, so a wrong number is visible at once.
4. **Areas**: **⬠ พื้นที่ร้าน / ⬠ โซน**, click corners on the map or on the floor in any tied camera. Shown in every camera. People outside the shop area are not counted.
5. **▶ เล่นทุกกล้อง**: all cameras play in step (**เลื่อนเวลา** per camera); each person gets one colour in every camera and on the map, with their whole path. People seen by several cameras are one person.
6. **🎯 ตรวจตำแหน่ง**: click the map or any tied camera; the pink 60 cm square shows that spot everywhere and lists which cameras see it.
7. **✓ เสร็จการตั้งค่า / 🔧 ตั้งค่า**: map mode hides and locks references, corner numbers, camera icons and the linking controls (links keep working); 🔧 brings them back.
8. **Drawing (pictures only, never affect cameras or counting)**: ▭ rectangle, ⬠ shape, ╱ line/wall (thickness), T text (size); name, colour, move, drag corners, delete, own layer (show/lock). A closed drawing can become a zone or the shop area (**→ เป็นโซน / → เป็นพื้นที่ร้าน**).
9. **Fewer clicks per camera**: **กล้องไม่เอียงข้าง** (on by default) → 6 values instead of 8 (e.g. 3 corners); a typed **สูงจากพื้น** height → 5. The card says how many more it needs and what to add.
10. **Learning from people** (collected while playing, nothing changes until clicked): how far apart the cameras place the same people, a **"กล้องนี้อาจถูกขยับ"** warning when that jumps, and **ใช้ความสูงคนช่วย (คร่าวๆ)** for a camera that cannot be tied otherwise (needs only 4 values; rough). It is never used when the clicks are enough.
11. **Any camera adds references, any camera uses them**: ✚ / ▭ in every camera card. From a tied camera the new reference gets its real size and place. From a camera that is not tied yet (while the map already has references) it is **not placed yet**: it flashes beside the map, ties nothing, and becomes placed when you drag it to its real spot (or **✓ อยู่ตรงนี้แล้ว**). Each camera's reference list puts the ones it uses first (✓ + count), then the ones it probably sees, and marks "จากกล้องนี้" / "ยังไม่ได้วาง".
12. **Zoom and pan in every camera**: mouse wheel or ＋ － ⤢; Alt+drag or middle button to pan. Zoomed out, the picture sits in a grey border with a 1 m floor grid, and **corners can be clicked outside the picture** (up to one picture beyond the edge), e.g. a rug corner just off-screen. They are marked "นอกภาพ (ประมาณ)" and count half as much as a visible corner when there are spare values.
13. **How each camera knows its floor**: only from the clicked corners/edges (a real-camera model is fitted to them); nothing is specific to one video. The floor is well known where the clicks are. When the clicks sit in a narrow strip of the picture, or the estimated camera height is implausible (outside 1.5–8 m), the card and camera list warn **"พื้นนอกบริเวณที่คลิกยังไม่แน่นอน"**, and when zoomed out the floor grid is drawn dashed amber with a note. Fix: type the camera height, or add a reference near the bottom/side of the picture. Tested on the repo's shop clip (`walk.webm`, 3 small tables in one strip): estimated height 17.5 m → warning; typed 3 m → realistic grid, no warning; EPFL cameras (spread clicks, 3.3 / 3.4 m): no warning.
14. **Labels in cameras**: clicked points show only their corner number, except for the reference being worked on (number + error), bad points (≥ 0.3 m) and unplaced references. Zoom into the camera to separate labels on small objects.
15. **Corner controls in a camera** (replaces the old corner/edge buttons): pick the reference, then the bar shows `มุม 1 ✓ 2 ✓ 3 ＋ 4 ＋ · ขอบ 1–2 ＋ …`. **＋** arms that corner/edge; the next click in the picture places it (an edge: 2 clicks) and disarms. A plain click never adds a point (it only selects or clears). **Drag any point** to move it. **Click a point** to select it: a small toolbar next to it changes its number (swaps if taken), **↻** re-places it with the next click, **🗑** deletes. **Delete** removes the selected point; right-click deletes the point under the mouse; **Ctrl+Z / Ctrl+Y** undo/redo (↶ ↷ buttons). Points are numbered circles coloured by error (green < 0.1 m, amber, red ≥ 0.3 m); selected = white ring; outside the picture = dashed. A **magnifier** (3×, top-right) follows the mouse while adding or dragging. Once a camera is linked, missing corners of the reference (and of others it uses) show as **dashed suggestion circles**: double-click one to add it there, then drag it onto the real corner. Clicking a corner number on the map arms it (missing) or selects it (placed) in the active camera.
16. **Full view**: **⛶ เต็มจอ** on every camera and **⛶** on the map. A camera fills the window with its picture as large as fits (shape kept), its controls on top, and a **small map** in the picture's corner with clickable corner numbers (**แผนที่เล็ก** hides it). The map fills the window with its tools; the selection panel floats at the side. ⛶ on another section switches; ⛶ again or Esc leaves (Esc first cancels anything in progress). Works while playing.
17. **References with any number of corners**: **▭ วาด Reference** and **✚ Reference ใหม่** first ask *how many corners* (3–12, default 4). 4 = a rectangle as before (drag on the map / 4 clicks in a camera, real size + angle boxes). Other numbers: click the corners on the map (numbered in click order), or in a camera that is already tied (measured from it; an untied camera cannot make one: its size is unknown). On the map: drag corners, move, turn; the panel lists side lengths.
18. **Points only, lines from points**: the corner bar has only corner buttons (no edge buttons). To use an edge whose corners are hidden: place two of its corner numbers anywhere along the visible part, select one, **Shift+click** the other, **╱ ทำเป็นเส้น**. To add an edge going out of a visible corner: select the corner, **╱ เส้น…**, click any spot along that edge: the corner stays and the edge's direction is added. The page picks which of the corner's two edges you meant (from neighbouring corners in the picture, else the camera's floor); an edge it had to guess is re-checked after every new point, and two lines out of one corner are also tried the other way round. **แยกเป็นจุด** turns a line back into its two corners.
19. **Any number of cameras**: **+ เพิ่มกล้อง** adds a camera (each has its own tracker on the server and its own colour; 8 fixed colours, then generated). **ชุดวิดีโอ** loads a recording folder from `tests/videos/<set>/` (one `.webm` = one camera), adding cameras as needed; it only loads videos (no references are placed). Tested with 4 EPFL cameras at once: ~14 detection rounds/s on this PC. The server loads 4 camera models in the background at start and clears a tracker on ⏮/reload instead of loading the model again. Every user action is recorded in order in `window.usageLog` (buttons, settings, camera/map presses, wheel zoom, keys) for test logs.
20. **Camera fit = a real camera first** (after test B1-01 failed): every camera is fitted as a real camera above the floor (6 unknowns when level), with a weak "usual CCTV camera" prior (focal ≈ 0.9 × picture width, ~3 m up). A free 8-value floor fit matches any 4 corners exactly (even wrong ones) and extrapolates badly, so it is only the fallback when no real camera fits; the card then says so (⚠ จุดที่คลิกไม่เข้ากับกล้องจริง) and names the worst-fitting point. "แก้ให้" (corner numbering) is only offered when there are values to spare; for a symmetric object (a rectangle turned 180°) both answers are offered. On the tester's B1-01 clicks: 1.49 m → 0.31 m across 4 cameras vs truth.
21. **People tracked on the floor, across all cameras** (geometry.js `trackRound`): each map person is one track; every round each camera's sightings are given to tracks by optimal assignment (Hungarian) using predicted position, the camera-track number the track held in that view, and appearance. Appearance = an OpenVINO re-ID vector (`person-reidentification-retail-0286`, Apache-2.0, ~6 ms per person, at most every 0.3 s per tracked person) with clothing colour as fallback. A person whose feet are hidden behind someone nearer is placed from their head (1.7 m) through the fitted camera and can only join an existing track (on B1-01 such boxes were up to 4.5 m off). New people get a number after 4 rounds; two numbered tracks on one spot that no camera sees at the same time are folded into the older one; lost people coast 3 s and can be re-found by appearance for 30 s. B1-01 (4 cameras, 6 people, two recorded runs replayed and scored against truth): map ids per person 19.7 → 1.25, about 2 id switches per 40 s clip.
22. **A badly tied camera is tied from people** (after B1-01 run 2: a camera seeing only 2 rug corners, the other 2 guessed outside the picture). A camera whose clicks do not fit a real camera (or fit it worse than 0.45 m) is "weak": its sightings may not add new people where a well-tied camera sees the floor, and count little in positions. While the video plays, its clear views are matched to people the well-tied cameras see by **appearance** (re-ID vector, only clear one-to-one matches); RANSAC keeps the matches that agree, and a real camera is fitted to them alone. The card then offers **ปรับจากคนเดิน → ใช้ค่านี้** (recommended) and lists the clicked corners that disagree (usually wrong numbering). On the tester's run-2 clicks: that camera 3.48 → 0.28 m against the people; whole scenario vs truth: alignment 1.52 → 0.35 m, found 26 → 87 %, false people 5.3 → 0.6 per frame, ids per person 5.5 → 1.33 (every person kept their main id ≥ 95 % of the time). **ยกเลิกการปรับ** undoes it. The same button is offered for any camera whose people sit > 0.35 m from the other cameras' (as long as its clicked corners still fit); on B1-01 run 3 this took alignment 0.37 → 0.32 m and ids per person 1.67 → 1.17. With perfect calibration the tracker scores 1.0 ids per person on B1-01, so what is left is click accuracy.
24. **ตรวจทุก 1/8 วิ (คงที่)** (steady mode, on by default next to ▶): all cameras step through their videos together, 1/8 s of video per round, waiting for detection each time, so results do not depend on how fast the computer or browser runs (a throttled page had given different results from the same clicks). Still causal: each round only uses frames up to that moment. The server's re-ID throttle follows video time in this mode, so two runs give identical results. About 3 rounds per second with 4 cameras (a 40 s clip takes ~110 s). Off = real-time playback, detecting as often as it can.
25. **Type plan positions** (reference panel under the map): a rectangle reference has "กลาง x / y" (centre, metres) next to length/depth/turn, and "หรือตำแหน่งมุม (ม.)" to type its 4 real corners when it is not a true rectangle (it then becomes that shape); a polygon reference has "ตำแหน่งมุม (ม.)", where you type each corner from the floor plan as `x,y; x,y; …`. Undo works; camera ties refit.
26. **Tie a camera from people alone**: a camera with no usable floor reference (corners hidden or too soft) can now be tied by "ปรับจากคนเดิน" too. Play the video; once the tied cameras have seen people that this camera also sees, its card offers the tie (shown as "(ยังไม่ผูก) → x m"). It is offered only when the matched people agree within 0.35 m. Needs some overlap with a tied camera.
27. **Hidden feet placed with a learned head height**: for a person whose feet are hidden behind someone nearer, the page uses the head instead. The head height is now learned per camera from people standing alone with their feet in view: the height that puts their head over their feet through the camera fit, as a median of up to 200. Until 15 are seen it uses 1.7 m. It starts again when the camera ties change. This fixes cropped views and estimated plan scales (B3-16 and B1-01 learn about 2.8–3.0).
28. **Time shift found from people**: if a camera's video runs ahead of or behind the others, "ปรับจากคนเดิน" also tries shifts of −2…+2 s (0.25 s steps) when tying a camera from people. It uses a shift only when that one makes clearly more people agree (≥ 1.3× and +8 pairs), and shows it on the offer ("เลื่อนเวลา x วิ"). Clicking ใช้ค่านี้ sets the camera's เลื่อนเวลา field and the tie together; Ctrl+Z undoes both.
29. **⇄ ซิงค์คนอัตโนมัติ: เปิด/ปิด** (one toggle in the top bar; replaces the per-camera sync button): while the videos play, about every 7.5 s of video the page matches the people that several cameras see at the same moment and ties or corrects every camera that is not tied from clicks.
    - It applies a result only when two rounds in a row agree (error within 0.1 m, camera height within 10 %), so one round of wrong matches can't move a camera.
    - Cameras tied from clicked points are the anchors and never change; at least one is needed.
    - A camera is steady after 3 rounds with nothing to change. When all are steady, the status bar says so and names any camera that still can't be synced (too few shared people: click 2-3 floor points in it).
    - Each card shows `⇄ ซิงค์คน: n/need pairs` and its state: collecting, found and waiting for confirmation, steady, can't sync, or anchor.
    - All the earlier guards still apply (height 1.2-8 m, first tie ≤ 0.35 m, refit needs 0.7× error, ≥ 60 and 1.5× pairs, height change ≤ 35 %). Undo: "ยกเลิกการปรับ" or Ctrl+Z.
23. **จัดให้ตรงกับกล้องอื่น** (align with the other cameras): when a camera's floor has the right shape but is turned or shifted against the others (people from it sit consistently off), the card offers turning/shifting its whole floor (4 values, robust fit to the people the other cameras see). Offered only for a turn ≥ 6° or shift ≥ 0.5 m that brings people within 0.35 m (well-tied cameras differ by box-bottom bias only, < 2°). **ยกเลิกการจัด** undoes it; Ctrl+Z too. B1-01 run-4 setup (one camera turned 17°), clicking only what the cards offered: alignment 0.39 → 0.34 m, ids per person 1.33 → 1.17. The people-based re-fit (ปรับจากคนเดิน) for a well-tied-but-imprecise camera is now allowed when its clicked corners get at most 0.15 m worse.
EPFL samples now put both rugs on the map as floor-plan references; each camera is tied by numbered corners only.
Everything except the videos is kept in the browser (reload-safe).

Outside-the-picture corner and drag-to-place (EPFL full views, camera 2 vs truth, median / 90%):

| Test | Error |
| --- | --- |
| Rug corners 1, 2 + corner 3 clicked **outside the picture where it really is** (10 px past the edge) | 0.07 / 0.35 m |
| Same, but corner 3 squeezed onto the picture edge | 0.26 / 0.46 m |
| New reference made in unlinked camera 2 from 4 carpet corners (one outside), dragged + turned into place on the map | 0.09 / 0.14 m (exact placement; by eye adds your placing error) |

Fewer clicks / people (EPFL full views, truth comparison of camera 2, median / 90%):

| Camera 2 has | Values (needed) | Error |
| --- | --- | --- |
| all visible corners and edges | 16 (6) | 0.06 / 0.16 m |
| 3 corners only | 6 (6) | 0.06 / 0.18 m |
| 2 corners + 1 edge + typed height 4.0 m | 6 (5) | 0.08 / 0.20 m |
| case ข: 2 corners + 2 short edges | 6 (6) | 0.18 / 0.30 m (before: could not tie) |
| case ข + typed height | 6 (5) | 0.15 / 0.23 m |
| 2 corners + people heights (80 people) | 4 (4) | 0.78 / 1.78 m: rough |

- Tuning a camera to the other camera's people (feet) was tested and **not offered**: with sloppy clicks it made people agree better between cameras (0.67 → 0.32 m apart) but the camera worse against truth (0.17 → 0.27 m, worst 10% 0.44 → 1.93 m). Box bottoms are different parts of a person from different directions, and all matches sit in the shared floor. Switch: `OFFER_FOOT_TUNE` in `index.html`.
- People heights are rough here partly because EPFL gives no real sizes (the map scale may be ~20% off, so "1.7 m tall" does not match) and box tops on 360×288 video are not exactly heads. **+ เพิ่มกล้อง** for more cameras.

Measured (EPFL, camera 1 tied by clicking the 4 rug corners, camera 2 by numbered corners/edges of the rug and the floor-plan carpet it can see; truth + ±2 px clicks):

| Sample | Camera 2 values | Camera 2 vs truth (median / 90%) | Same floor spot from both cameras | Camera 1 map shape (after scale/turn) |
| --- | --- | --- | --- | --- |
| Full views | 16 | 0.06 / 0.16 m | 0.17 / 0.53 m | 0.06 / 0.11 m |
| ก all shared | 12 | 0.06 / 0.13 m | 0.15 / 0.55 m | 0.06 / 0.11 m |
| ข nothing shared | 6 | not tied: page asks for more | – | 0.05 / 0.10 m |
| ค half shared | 12 | 0.08 / 0.10 m | 0.12 / 0.22 m | 0.05 / 0.10 m |

- Case ข: the 2 short carpet edges start at clicked corners, so they only add their direction (6 independent values). The old auto-matching "solved" it only through click noise; the page now says what is missing. In a real store: one more reference corner or edge in that view.
- Wrong numbering test: carpet numbers shifted by one → 3.88 m, flagged, **แก้ให้** → 0.06 m.
- Playback (full views, 30 s): 4 people on the map, 2 of them seen by both cameras, ~13 detection rounds/s for 2 cameras; total seen 6 (ids still break when someone is hidden from both cameras).

**Fit a Reference to the layout:** select it on the map, then drag any corner square; only that corner moves (the rectangle becomes a 4-corner shape and the panel shows each side's length). Shift+drag still resizes it as a rectangle. Ctrl+Z undoes.

**Map editing speed:** while a Reference is dragged, cameras keep their last floor fit and refit once on release; the camera solver starts from its last answer (the 144-start search runs only if that answer is clearly worse or above 8 px), and the "corners misnumbered?" check runs 0.4 s after drawing. B3-20: 190-1800 ms per mouse move and ~2 s on release before; about 2-5 ms per move and 0.1-0.2 s on release after. Warm and full-search fits gave the same floor (0.000 m apart) on B2-11, B2-14, B3-17 and B3-20.

**Camera picture editing speed and guessed sizes (2026-11-16):** dragging a corner in a camera picture also keeps the last fit; it refits when the mouse rests 0.2 s and on release. The 144-start search now gives every start 6 steps and finishes only the best 8: on 13 tied cameras from 6 scenarios it is 4-7x faster (e.g. 196 -> 37 ms) with the same floor on 12 (the 13th, B3-19 cam3, is a 4.5 m misfit either way). A Reference made from a camera that is not tied yet starts at the typed size only as a guess (`sizeGuess`), so its length and depth are refitted from that camera's 4 corners, at creation and after each corner drag, until the size is typed or resized on the map. B2-11 cam0 rug: corners 0.18 m off with the kept 1.6 x 0.6 guess, 0.03 m with the refitted 1.55 x 0.78. The server now sends `Cache-Control: no-store`, so a browser never runs an old copy of the page. Every corner drawn in a camera picture can be dragged: a dashed circle or a corner number of a Reference this camera has not clicked becomes a clicked corner where it is dropped. While a guessed-size Reference ties the camera, corners of real-size References added in the same picture do not untie it (the camera keeps the guessed Reference's fit, about 0.7 s faster than a failing combined fit); once they tie the camera alone (3 corners), the guessed Reference takes its real size and place from them. B2-11 cam0: after dragging 3 corners of the other rug, the guessed rug came out 0.07-0.30 m from its true corners and the camera floor 0.003 m from the original fit.

## How to use (earlier page, /v1)

1. Pick a picture: **ใช้ภาพตัวอย่าง** (3 shelves + 2 people, high camera), a file (image or video), the repo demo video, or a webcam snapshot. Calibrate when **no people stand in front of the shelves** (a person in front of the reference shelf spoils its outline).
2. **▭ Shelf**: drag a box around a shelf (MobileSAM by default). Make the first (reference) shelf one where the camera sees a **side** of it. Type its real **length × depth** (default 1.6 × 0.6 m); **สลับด้าน** if its long side does not face the camera. Later shelves are placed on the map automatically.
   **✚ Shelf: คลิก 4 มุม** creates a shelf by hand when automatic detection gets it wrong: click the 4 points where the legs/base touch the floor, in any order (Esc cancels). It works for the reference shelf too. Corners are always put into one order automatically; the front is the flatter edge at the corner nearest the camera (tested: clicked true corners give spacing 2.00 / 2.00 / 4.00 m and 1.60 × 0.60 exactly).
3. **Shop area and zones** (pick "พื้นที่ร้าน" or "โซน" + a name first), three ways:
   - **⬠ คลิกมุมในกล้อง**: click the floor corners on the camera picture, any number;
   - **⬠ คลิกมุมบนแผนที่**: click corners on the map;
   - **▭ ลากกรอบวัตถุ**: drag a box around an object (counter, fridge); its floor outline becomes the area.
   Close a shape by clicking its first point, double-click, or Enter; Esc cancels. Every area shows on both sides.
4. **👤 ตรวจจับคน**: YOLO finds people; each person's feet are mapped to the floor. People **outside the shop area are not counted** (grey, dashed); people inside are counted and get their zone name.
5. **Everything drags from any corner**:
   - camera: the **selection box** (8 handles; let go and the shelf/object is found again), the **4 floor corners of every shelf** (white dots; **hollow rings** are estimated back corners — drag them onto where the legs/base touch the floor, and that shelf then uses your 4 corners instead of the standard depth; drop the dots on the legs **in any order** — they are put back into front-left, front-right, back-right, back-left automatically, so a crossed "bow-tie" cannot happen), **area corners**;
   - map (**recommended way to fix shapes**: drag boxes on the camera first so the map builds itself, then fix shapes here; the camera outlines follow): click any shelf to **move** it, drag a **corner** to resize, drag the **round handle** to turn; drag **area corners**.
   - **Reference shelf on the map**: resizing it **sets its real size** (the length/depth boxes update and the whole map rescales); moving/turning it moves/turns the whole camera-built map (useful to line it up with areas or an old map drawn on the map).
   - With **ทุก Shelf ขนาดเท่า Shelf อ้างอิง** ticked, a shelf you resize on the map keeps its own size.
   - **คำนวณร่วมทุก Shelf** (on by default): the camera→floor conversion is fitted to **all shelves' corners together** (least squares, every shelf is a rectangle), instead of trusting the reference shelf's 4 corners exactly. One badly placed corner is outvoted by the others. Each shelf shows how far its corners are from the fitted rectangle in px (green < 4, amber < 10, red above) to point at a bad corner. Best together with **ทุก Shelf ขนาดเท่า Shelf อ้างอิง** when the shelves are the same model.
   On the map every shelf is drawn as its **best-fitting rectangle** (shelves are rectangles; hand-placed corners and lens bending otherwise make slanted shapes), and the orange outline on the camera follows that rectangle. Tick **ทุก Shelf ขนาดเท่า Shelf อ้างอิง** when all shelves are the same model: each keeps its own position and angle but uses the reference size exactly.
   Editing the **reference shelf** recalculates the whole map; editing any other shelf changes only that shelf.
6. **Tracking options** (next to ▶): **ตรวจจับเร็ว (OpenVINO)** uses the OpenVINO export of YOLO11n (~3× faster on Intel CPUs; falls back to normal YOLO if the export is missing — set up once with `pip install openvino` in the venv, then `YOLO("yolo11n.pt").export(format="openvino")`, which writes `NTT_Prototype/data/vision/yolo11n_openvino_model/`, git-ignored); **ตัวติดตามสำหรับภาพช้า** uses `tracker_lowfps.yaml` (ByteTrack tuned for 3–12 detections/s instead of 30); **เชื่อมคนบนแผนที่ + ทำนายตำแหน่ง** joins a new id to someone who vanished within 1 m / 2 s (moved along their recent direction), smooths positions, and shows a briefly hidden person as a dashed circle at the predicted spot. The people line shows tracker ids → people after re-link.
7. **Test with a video**: load a video (file, or **ใช้คลิปคนเดิน (ของจริง)** = the repo's real recorded clip). Its **first frame** is shown for mapping: tables, real size, shop area. Then **▶ เล่นวิดีโอ**: YOLO + ByteTrack follow people while it plays; each person gets an id, is shown inside (green, counted) or outside (grey), and leaves a trail on the map. **⏸** pauses, **⏮ เฟรมแรก** goes back to adjust the mapping. "เห็นในร้านทั้งหมด" counts ids seen inside at least 3 times.
   Tested on the real clip (2 people, 44 s): both counted inside, total 2 with the default options (see Findings).
8. **Camera 2 (same area, other angle)**: panel under the camera. Load its video (or **ใช้ชุด EPFL (2 กล้อง)**). Link it to the map by **point pairs**: click a floor spot in camera 2, then the same spot in camera 1 (rug/table corners, floor marks), at least 4, spread out. Each pair shows how far off it is in metres (with 5+ pairs a wrongly matched pair stands out). **ใช้กล้อง**: both (people joined) / camera 1 only / camera 2 only. **เลื่อนเวลา** lines the videos up if they did not start together. **⬠ พื้นที่: คลิกมุมในกล้อง 2** draws a shop area or zone on the floor in camera 2 (close with the first point, double-click or Enter; drag its corners in camera 2 later); it appears on the map and in camera 1 (dashed), and areas drawn in camera 1 or on the map appear in camera 2 the same way. Tested on EPFL: a zone drawn in camera 1 lands within 4–11 px of EPFL's true spot in camera 2 (360 px wide picture). Each camera has its own tracker on the server; the same person seen by both (within 1.2 m on the map) becomes one person; once joined they stay one even if the two views drift apart, and two ids found to be one person are combined (the count is corrected).
9. **🎯 ตรวจตำแหน่ง**, **✏️ แผนที่เดิม → จัดแผนที่เดิมให้ตรงกล้อง**, **Ctrl+Z** as before; lists have **ลบ** buttons.

**Same number across cameras and behind things (2026-11-16):** a person who walks into the next camera, or comes out from behind someone, keeps their number when the clothes match (re-ID) and the distance is walkable, even when the two cameras do not overlap or the new sighting starts a moment before the old one ends. A camera's own tracker number is ignored when the clothes clearly differ, because that tracker swaps numbers when people cross. Measured on recorded tests: B3-17 1.50 -> 1.00 numbers per person, B3-20 7 -> 3 number switches. Limits: two people who look alike, or walk ~1.5 m apart for a long time, can still trade numbers; someone gone for more than 30 s gets a new number.

## How it works

- `server.py`: box → shelf mask (**GrabCut** by default, no download; **MobileSAM** via Ultralytics if `mobile_sam.pt` is here) → convex hull simplified to ~6 corners → floor corners:
  - front **and a side** visible: the 3 lowest neighbouring corners are on the floor (upright shelf edges are told apart because they look almost vertical); the hidden back corner comes from **perspective (vanishing points)**: the shelf's top edges run parallel to its floor edges, so where those lines meet in the picture tells where the hidden floor lines go. If the outline is not a clean 6-sided shape it falls back to a parallelogram;
  - only the **front** visible: just the front floor edge; the page gives it the reference shelf's depth, going away from the camera.
- `index.html`: reference shelf corners ↔ L × W rectangle in metres → homography (camera → floor). Every other shelf is projected with it. A later shelf's 4 corners are trusted only if, on the floor, its corner is square (±25°) and its depth is within 50% of the reference depth (**assumption: shelves in one store share a standard depth**); otherwise only its front edge is used, with the reference depth. Rough-map alignment is a similarity fit (Procrustes) on shelf centres.

## Findings (2026-11-13)

Live people tracking (real clip `customer-detection.webm`: 2 people, 44 s; one of them leaves the view and comes back; played in real time, frames skipped when detection is busy; 3 tables + shop area mapped on the first frame):

| Setting | Detection rate | Tracker ids | People after map re-link | Counted inside |
| --- | --- | --- | --- | --- |
| Standard ByteTrack (baseline) | ~7/s | 4 | – | 4 |
| Tuned tracker (`tracker_lowfps.yaml`) | ~7–11/s | 2 | – | 2 |
| Tuned tracker + map re-link/prediction | ~7–8/s | 4 (varies run to run) | **2** | **2** |
| Stress: clip at 3× speed (≈ a third of the frames), baseline | – | 6 by mid-clip | – | 4 by mid-clip |
| Stress 3×, tuned tracker | ~4/s | 4 | – | 3 |
| Stress 3×, tuned + re-link | ~8/s | 6 | 5 | 4 |
| **OpenVINO** + tuned + re-link | **~25–27/s** | 6–8 (2 runs) | 6–8 | **2** |
| **OpenVINO**, stress 3× | ~23/s | **2** | **2** | **2** |

OpenVINO = the same YOLO11n exported for Intel CPUs: 273 → 91 ms per frame on this PC in a direct test (3.7 → 11 fps on full video frames; the page reported ~25/s, measured on the frames it sends); on 60 frames, 57 had the same people count as PyTorch, boxes within 12 px. At normal speed the extra tracker ids are short blips (seen < 3 times), which the "seen inside at least 3 times" rule already drops, so the count is right.

What this says:
- At this PC's normal live rate, **tuned tracker + re-link gives the right count (2)**; the re-link layer repairs the runs where the tracker still splits someone.
- When detection gets much slower (stress test), ids still split. Remaining causes: people move too far between detections, two people crossing, and a person who **leaves the camera view and comes back** gets a new id (nothing in position alone can tell it is the same person; that needs appearance re-identification).
- **With OpenVINO the detection rate goes up about 3×, and even the stress test counts correctly (2).** Remaining limit: a person who leaves the view and returns can still get a new id; appearance re-identification (BoT-SORT + ReID) is the next step if that matters.

Camera 2 from partial views, any layout (EPFL cases, `epfl_cases.py`):

How camera 2 is tied to the map now: **คลิกในกล้อง 2 =** corners (1-4 visible corners of a shelf or of an area already on the map, e.g. a floor-plan counter), edge (2 points anywhere along one visible edge; its ends may be hidden), or a point shared with camera 1. Then click the item on the map. Nothing says which corner is which: every consistent matching is tried (clue by clue, keeping the best 96 once there are spare values), mirror images and points behind the camera are rejected, and camera 2 is fitted as a **real camera** (focal length, position incl. height, direction: 7 unknowns) started from a straight 8-unknown fit. Needs 8 values (corner = 2, edge point = 1, shared point = 2). The user never says how the cameras overlap: the same steps work whether camera 2 shares all, none or part of camera 1's floor. **วิดีโอตัวอย่าง ก/ข/ค** only loads the three EPFL sample pairs. To check a link by eye: **🎯 ตรวจตำแหน่ง**, then click on the map, camera 1 or camera 2; the pink 60 cm square shows the same floor spot in all three. The page shows the fit in metres, flags near-ties (**↻ แบบอื่น**), and marks on the map what each clue matched.

Test: cropped EPFL views (60 s clips), rug clicked in camera 1 as the reference, blue carpet put on the map as a floor-plan item (from EPFL's calibration). Camera 2's clues = whatever rug/carpet corners and edges are visible in its crop, positions from EPFL truth + ±2 px click noise; the matching was not given. Error = camera 2's map position vs truth over its whole floor view.

| Case | Camera 2 shares with camera 1 | What camera 2 could use | Values | Error median / 90% | Matching |
| --- | --- | --- | --- | --- | --- |
| 1 | all of its floor | 3 corners + 5 partial edges | 16 | **0.04 / 0.12 m** | right, clear |
| 2 | nothing | 2 carpet corners + 2 short partial edges | 8 (minimum) | **0.37 / 0.69 m** | right, flagged "near-tie" |
| 3 | half | 3 corners + 5 partial edges | 16 | **0.04 / 0.09 m** | right, clear |
| 3 | half | 6 shared floor points only | 12 | 0.04 / 0.13 m | – |

- Before the camera model, case 2 gave four "perfect" fits that were all 4-8 m wrong; with it, the best is 0.37 m and impossible views are gone.
- Edge points are scored against the edge itself, not its extension; that removed wrong answers that slid points past the edge ends.
- Limits: with exactly 8 values the answer is only just determined, so the page says so; add one more corner, edge or shared point. The camera model assumes the lens centre is the picture centre (set per camera; the EPFL crops move it). Fitting runs in the page and takes up to ~2 s after a click with many clues.

Two cameras (EPFL CVLab "laboratory" sequence, research use: 4 people, 156 s, cameras 0 and 1 at neighbouring corners, 360×288; downloaded to `epfl_lab/`, not in any repo). Reference = the patterned rug clicked as a 4-corner "shelf" (3.6 × 2.2 m, estimated: EPFL gives no units, scale from walking speed ≈ ±20%). Camera 2 linked with 4 point pairs (2 rug corners, a floor box, a carpet corner). EPFL's own calibration was used as ground truth.

| | Detection rate | Tracker ids | People after linking | Counted over the clip (truth 4) |
| --- | --- | --- | --- | --- |
| Camera 1 only | ~10/s | 30 | 28 | 25 |
| Camera 2 only | ~9/s | 38 | 35 | 26 |
| **Both, joined on the map** | ~8/s per camera | 53 | 19 | **13** (people on the map at the end: **4**) |

- Camera 2 calibration vs EPFL truth: median **0.30 m**, 90% within 1.25 m (worst at the far edge of the view). Same person from the two cameras: median 0.58 m apart (calibration + box-bottom feet).
- **Lesson: matching the wrong corner breaks it.** First try paired the rug's corners in the wrong order (the views are rotated ~90°): error 3.5 m median. With exactly 4 pairs the page cannot notice; use 5+ pairs so a bad one shows a large number.
- First joining version made it worse (13 counted by 45 s): when the two views of one person drifted > 1 m apart, a new person was created each time. Fixed by keeping joined people joined and combining ids (57 combines in the run).
- Joining halves the over-count, but this footage is hard (low resolution, people constantly hide each other, walk out of both views): ids still break when someone is hidden from both cameras for > 2 s. Next: re-identification by appearance, and refining camera 2 automatically from people walking through both views.

Joint fit (sample; one reference corner pushed 12 px off on purpose; true spacing 2.00 / 2.00 m, true size 1.60 × 0.60):

| | Spacing | Other shelf sizes |
| --- | --- | --- |
| Reference only | 2.62 / 1.63 m | 2.70 × 0.77, 1.01 × 0.60 |
| All shelves together | 2.11 / 1.85 m | 1.86 × 0.66, 1.33 × 0.60 |
| All together + same size | 1.95 / 2.04 m | 1.60 × 0.60, 1.60 × 0.60 |

With clean corners the joint fit gives the same result as before (1.99 / 2.00 m).

Shop area / people / dragging (sample with 2 people pasted at known floor spots):

- 5-corner shop area drawn on the map + cashier zone drawn on the camera: inside person **counted, in "แคชเชียร์"**, mapped to (4.37, 1.97) m vs true (4.40, 2.30); outside person **not counted**, (6.22, −0.69) vs true (6.30, −0.80). The person's foot point is the bottom of the YOLO box, so it can be ~0.3 m short.
- Selection-box resize re-found the shelf; floor-corner drag, map move (+0.50 m), turn (46°) and corner resize (+0.57 m) all worked; Ctrl+Z restored them.
- Lesson: a person standing in front of the **reference** shelf during calibration made MobileSAM include the person and threw every later shelf off by metres. Calibrate on a clear view.

Shelf corners (earlier):

| Test | Result |
| --- | --- |
| Synthetic self-check (angled box, front-only box) | Pass: 3 visible floor corners within 12 px; hidden corner within 25 px |
| Angled sample, 3 shelves 1.6 × 0.6 m, 2 m apart (`sample.png`, true positions in `sample_truth.json`), first version (parallelogram) | Order and row correct. Centre spacing 2.23 / 1.67 / 3.90 m vs true 2.00 / 2.00 / 4.00 m (off 0.1–0.33 m) |
| Same sample, **vanishing-point corner + square/depth check** (`evaluate.py`) | GrabCut: spacing 1.97 / 2.00 / 3.97 m; MobileSAM: 2.00 / 2.03 / 4.02 m (**within 0.03 m**). Sizes within 0.11 m. Reference shelf hidden corner 1.9 px off (was 11.9 px). The page gives the same numbers |
| Repo demo video (flat cartoon, shelves seen straight on) | Fails: no floor depth is visible, so the reference cannot be set; the page now says so instead of producing a wrong map |
| GrabCut vs MobileSAM | Same corners on these pictures; MobileSAM first call ≈ model load, then similar speed |

What this means:

- **The idea works when the camera looks down at the shelves at an angle** (front + a side visible). That is the normal mount for a store camera, but it must be checked on a real picture of the real shelves.
- **The hidden back corner now uses perspective** (from the research note, `NTT_Prototype/docs/research/camera-map-calibration.md` §4.2) and positions are within a few centimetres on the sample. The sample is a clean rendering; a real photo will have shadows, products and baskets, so expect more error and keep the ✋ corner fix as a fallback.
- A wrong "side" reading (seen once with MobileSAM on a front-only shelf, 0.8 m off) is now caught by the square-corner and standard-depth checks.
- **Front-only views cannot give floor depth** from one picture. Those shelves still get placed using the reference shelf's depth, which is fine for shelves in a row.

## Files

`index.html` (store map page) · `geometry.js` (maths shared with it: homographies, camera model, linking) · `index-v1.html` (earlier page, `/v1`) · `server.py` (routes `/segment`, `/people`, `/epfl/*`) · `epfl_cases.py` (EPFL test cases: carpet from 4 cameras, crops, clips, `epfl_lab/cases.json`) · `index.html` · `make_sample.py` (writes `sample.png`, `sample_truth.json`, `sample_people.json`) · `evaluate.py` (measures accuracy on the sample: `... evaluate.py grabcut|sam`) · `mobile_sam.pt` (downloaded weights, optional)
