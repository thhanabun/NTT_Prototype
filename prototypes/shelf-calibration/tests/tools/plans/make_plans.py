"""floorplan.json + floorplan.png for every built scenario (references in floor metres, same frame as truth.json)"""
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1])); sys.path.insert(0, str(Path(__file__).parent))
from calib import *
from make_scenarios import S
from build_wt import wt_H
T = Path(__file__).resolve().parents[2]; VID = T / "videos"
LAB = json.load(open(Path(__file__).parent / "lab_refs.json")); Q = json.load(open(Path(__file__).parent / "quads_all.json"))
# hand-annotated floor-contact corners (source px, 360x288 videos) of pillars: (camera) -> list of (name, [(x,y),(x,y)])
CAMPUS = {0: [("pillar L front base", [(32, 141), (72, 141)]), ("glass door threshold (frame base, left and right end)", [(141, 128), (222, 128)]), ("pillar R front base", [(254, 139), (293, 139)]), ("blue sports bag lying on the paving (centre of its footprint; it stays put all clip)", [(59, 151)]), ("dark bin at the left pillar (centre of its foot)", [(39, 141)]), ("dark bin at the right pillar (centre of its foot)", [(266, 138)])],
          1: [("arcade pillar 1 base", [(29, 115), (46, 115)]), ("arcade pillar 2 base", [(57, 115), (75, 115)])],
          2: [("middle arcade pillar, left/right end of its front base (the pillar right of the standing man in frame 0 of B3-18)", [(113, 99), (142, 99)]),
              ("dark bin standing against the big right-hand pillar (centre of its foot)", [(250, 116)]),
              ("big right-hand pillar with the yellow sign: left/right end of its front base", [(259, 119), (297, 119)])]}
TERR_ANCHORS = {0: [("glass-wall panel seam foot 1", (60, 116)), ("glass-wall panel seam foot 2", (111, 104)), ("wall base line left end (frame edge)", (5, 132)), ("wall-panel / door-post foot (far end)", (150, 95))],
                1: [("railing post foot 1", (158, 78)), ("railing post foot 2", (200, 87)), ("railing post foot 3", (250, 98)), ("railing post foot 4", (315, 111))],
                3: [("parapet/railing corner foot", (155, 81)), ("railing post foot A", (74, 102)), ("railing post foot B", (117, 89)), ("railing post foot C (left)", (14, 116)), ("railing end-post foot", (148, 82)), ("parapet wall base, far end (right edge)", (345, 93))]}
TERR_MANUAL = {}   # polyline removed: its wall points duplicated the point anchors and hid the 2-D spread of cam3 (railing posts vs wall far end)
PASS_MANUAL = {0: [("yellow lane stripe (centre line, visible part)", [(6, 131), (188, 84)])],
               1: [("yellow lane stripe (centre line, visible part)", [(6, 137), (306, 284)]), ("yellow bike symbol (centre)", [(13, 168)])],
               2: [("yellow lane stripe (centre line, visible part)", [(39, 285), (353, 74)]), ("yellow arrow (head)", [(320, 122)])],
               3: [("yellow lane stripe (centre line, visible part)", [(200, 103), (358, 150)])]}
def yellow(ds, c, H, u):
    bg = cv2.imread(f"tools/scratch/bg_{ds}_{c}.png"); hsv = cv2.cvtColor(bg, cv2.COLOR_BGR2HSV)
    m = ((hsv[..., 0] > 18) & (hsv[..., 0] < 36) & (hsv[..., 1] > 90) & (hsv[..., 2] > 90)).astype(np.uint8); m[:150] = 0
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)); out = []
    for cnt in cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]:
        if cv2.contourArea(cnt) < 60: continue
        ap = cv2.approxPolyDP(cnt, 2.5, True).reshape(-1, 2)
        if len(ap) < 3: continue
        out.append((ap.astype(float), apply_H(H, ap) * u))
    return out
def source_refs(ds, c):
    """list of dict(kind,name,px(Nx2 source px),pts_m(Nx2),desc,src)"""
    ci = cam_info(ds, c); H, u = ci["H"], ci["unit_m"]; refs = []
    if ds in ("lab4p", "lab6p"):
        L = LAB[ds]; ip = lambda P: apply_H(np.linalg.inv(H), np.array(P) / u)
        refs.append(dict(kind="rectangle", name="rug", pts_m=L["rug"], desc="fringed rectangular patterned rug, 4 corners", src="clicked corners (EPFL calibration)", conf="high"))
        refs.append(dict(kind="polygon", name="blue carpet", pts_m=L["carpet"], desc="blue carpet outline; its straight edges and corners (outline simplified from blue floor pixels)", src="blue-pixel segmentation of all 4 cameras", conf="medium"))
        for r in refs: r["px"] = ip(r["pts_m"])
    elif ds == "passageway":
        for name, seg in PASS_MANUAL[c]: refs.append(dict(kind="segment" if len(seg) > 1 else "point", name=name, pts_m=(apply_H(H, seg) * u).tolist(), px=np.array(seg, float), desc="painted marking; only its visible stretch / reference point, NOT surveyed corners", src="annotated by eye (+-4 px)", conf="low"))
    elif ds == "campus4":
        for name, seg in CAMPUS[c]: refs.append(dict(kind=("segment" if len(seg) > 1 else "point"), name=name, pts_m=(apply_H(H, seg) * u).tolist(), px=np.array(seg, float), desc="floor contact edge of a square arcade pillar (front face), 2 corners + edge", src="annotated by eye (+-3 px)", conf="low"))
    if ds in ("terrace1", "terrace2"):
        for name, seg in TERR_MANUAL.get(c, []): refs.append(dict(kind="polyline", name=name, pts_m=(apply_H(H, seg) * u).tolist(), px=np.array(seg, float), desc="wall/railing foot line on the floor; 2 end points + 1 corner", src="annotated by eye (+-3 px)", conf="low"))
    if ds in ("terrace1", "terrace2"):
        for name, pt in TERR_ANCHORS.get(c, []): refs.append(dict(kind="point", name=name, pts_m=(apply_H(H, [pt]) * u).tolist(), px=np.array([pt], float), desc="distinct floor-contact point (wall/railing foot) - find by looking at the facade/railing base", src="annotated by eye (+-4 px, ~0.1-0.3 m)", conf="low"))
    if ds in ("terrace1", "terrace2", "campus4"):
        q = Q.get(f"{ds}:{c}") or {}
        for qq, qp in list(zip(q.get("quads", []), q.get("quad_px", [])))[:8]:
            refs.append(dict(kind="polygon", name="tile cell", pts_m=qq, px=np.array(qp), desc="one paving tile bounded by 4 joint intersections", src="Harris corners + lattice fit", conf="medium"))
    return refs
# distinctive ground features (px in the 960x540 half-size frame of each source cam; cross-checked: the same grates/manhole land within ~0.2 m in cams 1, 3 and 7)
WT_POINTS = {1: [("drain grate A (gutter, centre of the slotted plate)", (882, 258)), ("drain grate B (gutter, centre)", (858, 368)), ("concrete planter cone 1 (leftmost; centre of its base)", (54, 122)), ("concrete planter cone 2 (front, middle; centre of base)", (111, 121)),
                 ("concrete planter cone 3 (directly behind cone 2, only its top/back is visible; footprint centre)", (118, 111)), ("concrete planter cone 4 (rightmost; centre of base)", (168, 118)), ("bin/post foot beside the tripod", (255, 107))],
             3: [("drain grate 1 (gutter, centre of the slotted plate)", (68, 198)), ("drain grate 2 (gutter, centre)", (80, 251)),
                 ("grey bin foot (far side of the square)", (716, 102)), ("concrete planter, front (centre of base)", (868, 120)), ("concrete planter, right (centre of base)", (908, 118)),
                 ("sunlit paving patch, lower-left corner (far field, +-1 m)", (94, 131)), ("sunlit paving patch, lower-right corner (far field, +-1 m)", (146, 128))],
             7: [("drain grate (gutter, centre)", (860, 520))]}
WT_POLY = {3: [("square manhole cover (4 corners)", [(90, 355), (126, 349), (125, 365), (92, 366)])]}
def wt_refs(c):
    out = []; H = wt_H(c) @ np.diag([2.0, 2.0, 1.0])
    for name, pt in WT_POINTS.get(c, []): out.append(dict(kind="point", name=name, pts_m=apply_H(H, [pt]).tolist(), px=np.array([pt], float), desc="distinctive static ground feature; find it on the picture (not a paving joint)", src="annotated by eye (+-3 px), cross-checked between cameras", conf="medium"))
    for name, seg in WT_POLY.get(c, []): out.append(dict(kind="polygon", name=name, pts_m=apply_H(H, seg).tolist(), px=np.array(seg, float), desc="steel manhole cover set in the paving, 4 corners", src="annotated by eye (+-3 px)", conf="medium"))
    return out
def project_in(Hout, pts_m, size):
    Hi = np.linalg.inv(Hout); h = Hi @ np.c_[pts_m, np.ones(len(pts_m))].T; w = h[2]; px = (h[:2] / np.where(w == 0, 1e-9, w)).T
    c = Hout @ [size[0] / 2, size[1] * 0.8, 1.0]; sg = np.sign((Hi @ [c[0] / c[2], c[1] / c[2], 1.0])[2])
    return px, (np.sign(w) == sg) & (px[:, 0] >= 3) & (px[:, 0] < size[0] - 3) & (px[:, 1] >= 3) & (px[:, 1] < size[1] - 3)
def build(sid):
    sp = S[sid]; tr = json.loads((VID / sid / "truth.json").read_text()); ds = sp["ds"]; report = []; plan_refs = []; seen = []
    for k, cam in enumerate(tr["cameras"]):
        if ds == "wildtrack": refs = wt_refs(int(cam["source_cam"].split()[0][1:]))
        else: refs = source_refs(ds, cam["source_cam"])
        Ho = np.array(cam["H_img_to_floor_m"]); vis_pts = 0; names = []
        for r in refs:
            px, ok = project_in(Ho, np.array(r["pts_m"]), cam["size"])
            if ok.sum() >= (1 if r["kind"] == "point" else 2):
                vis_pts += int(ok.sum()); names.append(r["name"])
                cen = np.mean(r["pts_m"], 0); dup = next((p for p in plan_refs if p["name"].split(" (cam")[0] == r["name"].split(" (cam")[0] and np.linalg.norm(np.mean(p["points_m"], 0) - cen) < (0.5 if r["name"] in ("rug", "blue carpet") else 0.6)), None)
                if dup: dup["visible_in_cameras"] = sorted(set(dup["visible_in_cameras"]) | {k}); continue
                plan_refs.append({"name": r["name"], "kind": r["kind"], "points_m": np.round(r["pts_m"], 3).tolist(), "description": r["desc"], "source": r["src"], "confidence": r["conf"], "visible_in_cameras": [k]})
        lineonly = all(n.startswith(("yellow", "parapet")) for n in names) and vis_pts < 4
        report.append({"camera": k, "visible_reference_points": vis_pts, "references": names, "status": ("ok" if (vis_pts >= 2 and not lineonly) else ("weak (painted/wall line only, no surveyed corners)" if vis_pts >= 2 else "NONE: no usable reference in this view"))})
    return tr, plan_refs, report
def _check():
    for sid in sorted(S):
        tr, refs, rep = build(sid); print(sid, [(r["camera"], r["visible_reference_points"], r["status"][:4]) for r in rep], "refs", len(refs))

def draw(sid, refs, tr, rep, outline, path):
    allp = np.vstack([np.array(r["points_m"]) for r in refs] + [np.array(outline)]); lo, hi = allp.min(0) - 0.5, allp.max(0) + 0.5; sc = min(900 / (hi[0] - lo[0]), 700 / (hi[1] - lo[1]))
    W, Hh = int((hi[0] - lo[0]) * sc) + 20, int((hi[1] - lo[1]) * sc) + 60; im = np.full((Hh, W, 3), 255, np.uint8); P = lambda p: (int((p[0] - lo[0]) * sc) + 10, int((p[1] - lo[1]) * sc) + 40)
    cv2.polylines(im, [np.int32([P(p) for p in outline])], True, (150, 150, 150), 2)
    for i, r in enumerate(refs):
        pts = np.int32([P(p) for p in r["points_m"]]); col = (200, 90, 20) if r["confidence"] != "low" else (30, 120, 220)
        if r["kind"] in ("rectangle", "polygon"): cv2.polylines(im, [pts], True, col, 2); cv2.fillPoly(im, [pts], tuple(int(0.4 * c + 153) for c in col)) if False else None
        else: cv2.polylines(im, [pts], False, col, 2)
        for q in pts: cv2.circle(im, tuple(q), 3, (0, 0, 200), -1)
        cv2.putText(im, f"{i+1}", tuple(pts[0] + 4), 0, .5, (0, 0, 0), 1)
    cv2.putText(im, f"{sid}: floor plan (m)  scale bar = 1 m", (10, 18), 0, .55, (0, 0, 0), 1); cv2.line(im, (10, 28), (10 + int(sc), 28), (0, 0, 0), 3)
    y = 40
    cv2.imwrite(str(path), im)
def write_all():
    summary = {}
    for sid in sorted(S):
        tr, refs, rep = build(sid); ds = S[sid]["ds"]
        pts = np.vstack([np.array(r["points_m"]) for r in refs]) if refs else np.zeros((1, 2))
        hull = cv2.convexHull(np.float32(pts)).reshape(-1, 2) if len(pts) >= 3 else pts
        cen = hull.mean(0); outline = (cen + (hull - cen) * 1.15).tolist()
        plan = {"id": sid, "units": "metres", "frame": "same floor frame as truth.json (dataset floor coordinates; x right, y down on the plan image; origin is the dataset's own)",
                "room_outline_m": np.round(outline, 3).tolist(), "room_outline_note": "APPROXIMATE: hull of the listed references plus margin, not a surveyed wall outline",
                "references": [{"id": f"R{i+1}", **r, **({"side_lengths_m": [round(float(np.linalg.norm(np.array(r["points_m"][(j+1) % len(r["points_m"])]) - np.array(r["points_m"][j]))), 2) for j in range(len(r["points_m"]))]} if r["kind"] in ("rectangle", "polygon") else {})} for i, r in enumerate(refs)], "camera_reference_coverage": rep,
                "metric_scale_note": tr["scale_source"], "tile_size_note": ("detected tile cells have median side ~0.33 m (terrace 1) / ~0.5 m (terrace 2) in this frame; unit scale is an estimate (+-30 %), so tile size is NOT reliable" if ds.startswith("terrace") else ""), "how_to_use": "Each reference is a real floor feature; click its corners in the camera view and enter the listed point coordinates (metres, list order = outline order) at its place on the map."}
        (VID / sid / "floorplan.json").write_text(json.dumps(plan, indent=1)); draw(sid, plan["references"], tr, rep, outline, VID / sid / "floorplan.png")
        summary[sid] = rep; print(sid, [(r["camera"], r["status"][:4]) for r in rep], flush=True)
    json.dump(summary, open(Path(__file__).parent / "coverage.json", "w"), indent=1)

if __name__ == "__main__":
    write_all() if "--write" in sys.argv else _check()
