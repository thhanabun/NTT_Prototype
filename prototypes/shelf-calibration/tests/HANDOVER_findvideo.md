# Handover: Finding Video (written 2026-11-14 by Token Optimizer, from the old session's last reports + SCENARIOS.md)

Read first: `SCENARIOS.md` (table of the 20), `scenarios.json`, `tools/` (build.py, make_scenarios.py, verify.py, finalize.py, plans/). Don't re-read the old session.

## State
- All 20 scenarios have clips in `videos/<id>/` and a `floorplan.json`. Every plan has `side_lengths_m` per rug/tile polygon.
- B1-05 rebuilt: cam0 crop [0,0,210,270] (whole rug + 5 carpet corners), cam1 [40,0,330,190] (~6 carpet corners, partly hidden by people). Partial overlap 0.40. People in 100 % of sampled frames.
- B1-04 (WILDTRACK): old crops; plan has only low-confidence auto-detected slabs. The cam3+cam6 pair was tried and dropped (cam6 has too few people).
- Lab rug size (~2.2×3.7 m) comes from a 3 cm/unit estimate, ±30 %. Treat it as relative geometry.
- Weak (`reference_coverage`): terrace B1-06 / B2-13 (no true tile size, no distinctive anchors), passage B1-07 / B3-17 (only stripe / arrow / bike), WILDTRACK (2 hand-picked slabs, no slab grid).

## Open work (only if main asks)
1. B1-04: a better WILDTRACK pair with hand-checked slabs and enough people, or a slab grid.
2. Terrace and passage: distinctive per-camera anchors with metre positions in the plan.

## Cheap habits
- Text checks first (`verify.py` output). Look at images only to confirm, contact sheets ≤ 640 px, one sheet per scenario.
- Don't re-read plans already in `tools/plans`. Read files by range.
- Report to main in ≤ 5 lines; details go in this file or `SCENARIOS.md`.

## 2026-11-14 rebuild (Finding Video, new session) - all four now start at source t=0 (room empty for first ~3-6 s, so rug corners are unoccluded; people walk in later)
| id | cams (source cam: crop) | overlap | corners at t<2 s (checked on frames) |
|---|---|---|---|
| B1-05 | lab4p c0 [0,0,240,260], c1 [60,0,360,200] | partial 0.55 | cam0: 4 rug corners + carpet; cam1: carpet corners + part of rug |
| B2-11 | lab6p c0 [0,0,210,190], c1 [40,20,360,150] | none 0.04 | cam0: 4 rug corners; cam1: only ~2 clear carpet corners (far-left corner, far edge) - physical limit, any bigger crop shares floor with cam0 |
| B2-15 | lab4p c0 [0,0,230,210], c2 [0,90,300,288] (dims), c3 [130,60,360,250]; scale 1.0 (was 0.75) | partial | cam0: 4 rug corners; cam2: 3-4 carpet corners; cam3: 3 rug corners (4th at frame edge) |
| B3-17 | lab4p c0 [0,0,200,188], c2 [0,60,150,288] (was c2/c3) | none 0.02 | cam0: 4 rug corners; cam1: ~2-3 carpet corners (bottom corner, left edge cut, far-left bend) |
Residual: no-overlap cams on the carpet cannot show 4 clear corners without sharing floor. Few people in B3-17 (mean 0.7/cam, 7 % of samples with 2+). Tools: tools/scratch/{corners,g,s3,prev}.py (corner/occlusion/overlap search, run with NTT_Prototype/.venv-vision python).

## 2026-11-14 round 2 (main's decisions)
- B3-17 now lab6p c0 [0,0,200,185] + c2 [0,0,200,288], start 0: shared floor 0.14 -> SCENARIOS.md says "none, <=0.15" (override OVR in finalize.py). cam0: 4 rug corners; cam1: ~5 carpet corners + a bit of rug. People present in 57 %/66 % of samples (scan).
- Campus: cam0 floor anchors added to plans/make_plans.py CAMPUS (pillar L/R base corners, glass-door threshold ends; by eye +-3 px). B1-10 start 17 (4 unoccluded in crop), B3-18 start 15 (5), B2-14 start 21->26 (partial 0.44; start 9 was "full").
- B1-08 terrace: start 56->48; cam0 anchors = panel-seam feet (60,116),(111,104), wall-base left end (5,132), door-post foot (150,95) (not tile joints), all unoccluded in first 2 s, crowd mean 5.6 people on cam0. TERR_ANCHORS cam3 refined too.
- Occlusion check = YOLO person boxes in scan/*.json (tools/scratch/corners.py).

## 2026-11-14 round 3: WILDTRACK anchors (slab plan dropped)
- plans/make_plans.py WT_POINTS/WT_POLY: gutter drain grates (floor ~(8.7,1.8) and (8.7,5.95)), manhole cover (8.76,10.1), concrete planter bases, bin foot; px picked by eye on 960x540 frames; same grates land within ~0.2 m in src cams 1/3/7 (cross-check). Slab polygons removed from all WT plans (cams without anchors now report NONE in reference_coverage).
- B2-12: only cam1 (src3) has anchors (2 grates + manhole = 6 pts); first 2 s: a person walks past the manhole in frame 1 (0.5 s), visible in the other 3 frames.
- B3-19: cam0 (src1: 2 grates + 3 planters + bin foot), cam2 (src3: grates+manhole), cam6 (src7: 1 grate). Frame 0 checked with plan overlay: planter 1 hidden by a walker, the other 5 match.
- B1-04 rebuilt: src1 crop [0,150,720,720] (planters x3 + bin foot) + src3 crop [60,300,640,900] (2 grates + manhole), scale .75, none 0.01 shared; people mean 5.7 / 2.0 per frame. Old pair backup: scratchpad B1-04_bak (not in repo).

## 2026-11-14 round 4: counts for the 10 files with gt_positions=null
No EPFL GT is usable for them (lab4p: no GT file; terrace1 GT exists but its frame could not be reconciled with the homographies; terrace2/campus: none), so ALL 10 got `visible_count_per_s` [{t,n,n_min}] (+ `visible_count_per_camera`, `visible_count_note`) in truth.json, made by tools/count_visible.py (YOLO11n 1 Hz, border-cut boxes dropped, floor merge 1.5 m). Tuned on B1-01/B1-09/B3-16 vs GT: mean err ~0, MAE ~1 person. NOT hand-counted; 4-cam scenes over-count a bit (B1-02 max 9 for a 4-5 person clip) -> use n_min (max single camera) as lower bound.

## 2026-11-15 spread rule (tied cam needs a point >=2 m off the line through the others)
- Added to src3 anchors (WT_POINTS[3]): grey bin foot (-8.5,-1.7), planters front/right (-7.9,4.0)/(-8.8,4.3) on the far side of the square, 17 m from the gutter line; plus sunlit patch lower corners (far field +-1 m). Checked on frame overlay.
- Max off-line distance (PCA, plan points): B2-12 cam1 12.7 m OK; B3-19 cam0 3.5 m OK, cam2 12.7 m OK.
- B1-04 NOT met: cam0 (planters+bin, all along X~-8.5) 0.8 m, cam1 (gutter + patch, crop [60,150,640,900], none 0.006) 0.9 m. Reason: WILDTRACK features are along the two long edges of the square (X~-8.5 and X~+8.75); a no-overlap crop sees one edge only. Options: make B1-04 "partial" with a wide src1 crop (planters + gutter, 2D) + src3, or accept 1-D anchors there.

## 2026-11-15 round 6 (spread rule for terrace/campus, 4 planter cones)
- Rule check = max distance of one point from the line fitted to the others (per camera, plan points). Campus cam0: added "blue sports bag lying on the paving" (static all clip; footprint centre (59,151)); B1-10 3.4 m, B2-14 6.1 m, B3-18 3.7 m. Other campus cams stay collinear (pillar bases only) - tie them from people.
- B1-08: cam0 CANNOT reach 2 m (only a wall line + tripod/table foot within 1 m of it). Anchor camera = cam3: railing posts + wall far end (345,93), 2.3 m off the railing line (rule value with the wall polyline included: 1.4 m). Start 48 -> 14 so cam0 (4) and cam3 (6) anchors are unoccluded in the first 2 s; crowd is thinner (mean 3.0/2.6 per cam, was 5.6). Partial overlap kept.
- WILDTRACK src1: 4 planter cones now listed (cone 3 sits behind cone 2, footprint centre estimated, +-0.5 m). B3-19 cam0 4.4 m, cam2 14.4 m OK; B2-12 cam1 14.4 m OK.
- B1-04 still open: cam0 1.7 m (planters+bin only), cam1 1.6 m. Lower-half anchors for cam0 (grates, kerb) exist only on the gutter side, which cam1 also sees, so adding them makes it partial.

## 2026-11-15 round 7 (WILDTRACK mirrored frame)
- y FLIPPED in tools/build_wt.py (wt_H = diag(1,-1,1) @ H; gt_frames y negated) -> truth.json H, gt_positions and floorplan points of B1-04, B2-12, B3-19 all in the page frame (x right, y down). Rebuilt + regenerated.
- Check (solvePnP with dataset K on points projected through the new truth H): recovered camera = dataset extrinsic camera with y and z negated, exactly (src3 (9.0,-17.7,-2.6) vs dataset (9.0,17.7,2.6); src1 (9.1,5.8,-2.9) vs (9.1,-5.8,2.9)); i.e. a proper mirror, z<0 = above the floor in a y-down frame.
- NOT undistorted on purpose: the dataset README says Image_subsets are already undistorted and intrinsic_zero (zero distortion) is the right calibration for them; undistorting again with intrinsic_original would distort them twice. Cross-camera check: the same grates land within ~0.1-0.2 m from cams 1, 3 and 7 with the current H.
- B1-04 is now PARTIAL (0.38): cam0 src1 crop [0,150,1920,900] sc .5 (4 planter cones, bin foot, 2 gutter grates in the lower right; spread 4.3 m), cam1 src3 crop [60,150,640,900] (gutter + patch, 1.6 m). Old none-variant: scratchpad B1-04_none_variant.

## 2026-11-15 round 8
- B1-04 back to "none" (0.02), now EPFL lab4p: c0 [0,0,200,188] (rug + carpet) and c2 [0,60,150,288] (carpet), start 0; spread 4.2 m / 3.7 m (rug corners + carpet outline vertices; cam1 has only ~3 clearly visible carpet corners, rest are outline vertices). People >=1 in 45 %/57 % of samples. WILDTRACK old variants: scratchpad B1-04_none_variant (src1+src3), B1-04_bak. B1-04 loses crowd/low_fps edge cases (edge list updated).
- B3-19 truth: image->floor Jacobian det > 0 for all 7 cams in the current file (after the y flip in round 7); a det<0 reading means a stale copy. B1-04/B2-12 also > 0.
- Undistortion: not done (images are already undistorted, intrinsic_zero is their calibration; see round 7).
- Campus cam0 got 2 bin-foot anchors (spread 4.3/6.1/3.7 m for B1-10/B2-14/B3-18). Campus cam1 is structurally 1-D: pillar bases, bikes' wheel contacts, right-hand building base and the stand are all on the far edge of the paving (same depth); tie cam1/cam2 from people / cam0.

## 2026-11-15 round 9 (terrace)
- B2-13 start 115 -> 20: cam3's anchors free in the first 2 s (person-box check: 6/6), overlap still "full", crowd mean 3.3 (was higher). Counts recomputed for B2-13, B1-08 (their truth.json had been rebuilt after round 4 and lost visible_count_per_s) and B1-04 (now lab4p).
- B1-08 cam3 >=2 anchors >=1.5 m off the railing line: NOT possible with static features. Checked all 4 terrace1 cams: the empty terrace has only the railing/glass base, the parapet wall base, 1-2 camera tripods standing at the wall, and tile grout. The best off-line point is the wall far end (2.28 m); tripod right leg is 0.4 m, anything else on the wall base line is not distinct (x=300: 1.85 m). Tie B1-08 from people; or swap B1-08 to a source with floor objects.
- Not run: main's page "exact-point tie" check (the page is not available to this session).

## 2026-11-15 round 10: terrace scale x2.12
- calib.py terrace unit 0.0086 -> 0.018232 m/unit (basis: people measured 0.8 m on the page; 1.7/0.8 = 2.12). truth.json of B1-06, B1-08, B2-13 patched in place (H scaled by diag(2.12,2.12,1), floor_unit_m, scale_source, scale_rescaled_by=2.12; videos untouched), plans regenerated (B1-08 cam3 spread now 4.8 m), visible_count_per_s recomputed (merge now in real metres). SCENARIOS.md notes the basis. Lab stays at 3 cm/unit.
- Rebuilding these scenarios from make_scenarios.py now yields the new scale automatically.

## 2026-11-15 round 11: B3-18 cam2
- CAMPUS[2] anchors (src cam 2): middle arcade pillar base (2 pts), dark bin foot (1), big right pillar with the yellow sign (2 pts), pillar B removed (hidden behind the cafe furniture). Overlay checked on a frame. Depth spread is only 0.8 m (all objects stand on the far edge of the paving, y 99-119); nothing static lies nearer. Slab joints are identical (auto "tile cell" refs exist in the plan but are ambiguous).
- B3-18 cam2 crop [0,0,330,150] -> [0,0,330,230] so people's feet are no longer cut by the image bottom; partial overlap kept (0.52/0.79/0.66); visible counts recomputed (mean 4.1).

## 2026-11-15 round 12: B3-17 "mirrored" report - NOT applied
Checked the files: B3-17 truth H has det(image->floor Jacobian) > 0 for both cams (+2.7e-4, +1.0e-4), like B1-01, B2-11, B3-19 (after its y flip) and the terraces. Plan vs truth winding agrees (rug: plan +1 / image +1; carpet: -1 / -1), identical to B2-11 and B1-05. So plan and truth are NOT mirrored relative to each other; flipping y now would make B3-17 the only mirrored scenario. No file changed. If the scorer still needs a flip for B3-17 the cause is elsewhere (e.g. the scorer's rug-corner order or the cam0 crop [0,0,200,185]), not the file chirality. Waiting.
