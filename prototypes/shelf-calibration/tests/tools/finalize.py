"""scenarios.json + SCENARIOS.md from the specs in make_scenarios.py and the truth.json/verification of every built scenario"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_scenarios import S, E, LICENCE_WT
T = Path(__file__).resolve().parents[1]
LIC = {"wildtrack": LICENCE_WT}
NOTES = {"passageway": "GT positions are only indicative (near-field offsets ~0.5-1 m seen on overlays); the homographies are the truth. Far field of the calibration is unreliable.",
         "terrace1": "Calibration homographies only: EPFL's terrace GT is in a Tsai world frame that could not be reconciled with the homographies, so it is not included.",
         "terrace2": "Calibration homographies only (no EPFL GT for this sequence).", "campus4": "Calibration homographies only (no GT). Source clip is ~68 s long.",
         "lab4p": "Calibration homographies only (no GT file for 4p). Same room as lab6p.", "lab6p": "GT = EPFL manual labels once per second (grid cell ~0.2 m).",
         "wildtrack": "GT = WILDTRACK annotations every 0.5 s (2 fps), 2.5 cm grid. Only 20 s per clip (frames extracted from the 6.8 GB zip by range requests)."}
OVR = {"B3-17": "none, <=0.15"}   # measured shared floor 0.14 (main accepted <=0.15 as none)
rows = []
for sid, sp in sorted(S.items()):
    tp = T / "videos" / sid / "truth.json"
    if not tp.exists(): continue
    tr = json.loads(tp.read_text()); ver = tr.get("verification", []); gtp = tr.get("gt_positions")
    ids = {p["id"] for f in gtp["frames"] for p in f["people"]} if gtp else None
    est = len(ids) if ids else max((v["people_per_sample_max"] for v in ver), default=None)
    ov = tr.get("overlap_measured") or sp["overlap_target"]
    ov = OVR.get(sid, ov)
    cams = tr["cameras"]
    rows.append({"id": sid, "batch": sp["batch"], "title": sp["title"], "dataset": sp["label"],
                 "licence": LIC.get(sp["ds"], "CVLab-EPFL research use only; (c) CVLab EPFL; https://www.epfl.ch/labs/cvlab/data-pom-index-php"),
                 "cameras": len(cams), "files": [f"videos/{sid}/{c['file']}" for c in cams], "truth_file": f"videos/{sid}/truth.json", "overlap": ov,
                 "overlap_design_target": sp["overlap_target"], "overlap_shared_fraction_matrix": tr.get("overlap_matrix_shared_fraction_of_smaller_view"),
                 "edge_cases": sp["edge"], "people_count_estimate": est, "people_count_basis": "ground-truth ids in clip" if ids else "max people seen in one camera sample (YOLO11n, lower bound)",
                 "truth": True, "truth_kind": ("calibration homographies + ground-truth floor positions" if gtp else "calibration homographies only (no per-frame positions)"),
                 "gt_positions": bool(gtp), "duration_s": (ver[0]["duration_s"] if ver else tr["duration_s"]), "fps": tr["fps"], "resolutions": [c["size"] for c in cams],
                 "time_offsets_s": [c["time_offset_s"] for c in cams], "floor_unit_m": tr["floor_unit_m"], "scale_source": tr["scale_source"],
                 "references_hint": sp["hints"], "floorplan": (T / "videos" / sid / "floorplan.json").exists(), "floorplan_files": [f"videos/{sid}/floorplan.json", f"videos/{sid}/floorplan.png"], "reference_coverage": json.loads((T / "videos" / sid / "floorplan.json").read_text())["camera_reference_coverage"] if (T / "videos" / sid / "floorplan.json").exists() else None, "notes": NOTES.get(sp["ds"], "") + (" time_offsets_s[k]: camera k video starts that many seconds LATER in source time than the base clip (an event at t in cam0 appears at t-offset in cam k)." if any(c["time_offset_s"] for c in cams) else "") + (" Brightness ramp is synthetic (applied by us), not from the dataset." if any(c.get("synthetic_lighting_change") for c in cams) else ""),
                 "verification": [{k: v[k] for k in ("file", "frames", "first_frame_ok", "last_frame_ok", "frac_samples_with_2plus", "people_per_sample_mean")} for v in ver]})
(T / "scenarios.json").write_text(json.dumps(rows, indent=1))
md = ["# Test scenarios for the store-map tracking page", "",
      "Source: public research datasets with published floor calibration (EPFL CVLab multi-camera pedestrians, WILDTRACK). All research-use only; see `licence`. Videos: `videos/<id>/cam<N>.webm`, truth: `videos/<id>/truth.json` (per camera image->floor homography in metres for the OUTPUT video pixels, time offsets, GT positions where the dataset has them). Full machinery: `tools/` (build.py, make_scenarios.py, verify.py, finalize.py). Floor-reference hints describe what is visible; no pixel coordinates.",
      "", "Metric scale caveat: EPFL gives no unit for most sequences; `floor_unit_m` is an estimate (+/-30 %), homography truth is exact up to that scale. WILDTRACK is exact metres.", "", "Terrace scale (B1-06, B1-08, B2-13; EPFL Terrace 1/2): 1 unit = 1.82 cm, i.e. the earlier 0.86 cm estimate x 2.12. Basis: people measured on the page came out 0.8 m tall, so the scale was set so that people are ~1.7 m. Treat metres there as +/-30 %. Lab scenarios keep 3 cm/unit (people come out ~2.8-3.0 m there: errors look larger, the safe side).", "",
      "| id | batch | cams | overlap | edge cases | people | dur s | res | GT pos | floorplan | refs ok per cam | dataset | title |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
for r in rows:
    md.append(f"| {r['id']} | {r['batch']} | {r['cameras']} | {r['overlap']} | {', '.join(r['edge_cases'])} | ~{r['people_count_estimate']} | {r['duration_s']:.0f} | {r['resolutions'][0][0]}x{r['resolutions'][0][1]} | {'yes' if r['gt_positions'] else 'no'} | {'yes' if r['floorplan'] else 'no'} | {' '.join(c['status'][:2] for c in (r['reference_coverage'] or []))} | {r['dataset']} | {r['title']} |")
md += ["", "## Floor references to click, per scenario", ""] + [f"- **{r['id']}**: {r['references_hint']}" for r in rows]
(T / "SCENARIOS.md").write_text("\n".join(md) + "\n"); print(len(rows), "scenarios written")
