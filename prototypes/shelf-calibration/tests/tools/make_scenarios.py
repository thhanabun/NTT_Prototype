"""Scenario definitions + builder.   python make_scenarios.py [ids...]   (default: all defined)"""
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import *
from build_wt import build_wt, LICENCE_WT
LAB = ("Blue carpet with straight edges and sharp corners (large, irregular outline - use its corners), a fringed rectangular patterned rug (4 clear corners), "
       "small star/cross-shaped stickers on the grey floor, wall-floor corners of the room, table and chair legs on the floor.")
TERR = "Roof terrace with square grey floor tiles in a regular grid (joint intersections make good corners), glass facade base line (panel seam feet) and the railing base (post feet) along the edges; use the seam/post feet, not tile joints."
PASS = "Underground passage: a long yellow lane line on the dark floor, painted bike symbol and arrow marking, wall-floor base line, bicycles standing at the wall, stairs/landing at the far end."
CAMP = "(B3-18 cam2: middle arcade pillar base, dark bin and big right-hand pillar base only - all within ~1 m depth, so tie it from overlap/people.) Large rectangular paving slabs in a regular grid (joint intersections), square pillar bases of the arcade (floor-contact corners, see floorplan), glass entrance door threshold, building facade base line, bins and a bike rack at the edge."
WTH = "Distinctive static ground features (see floorplan; paving joints are identical and sheared, do not use them): slotted drain grates and a steel manhole cover in the gutter by the stair edge, concrete planter bases, bin/post feet, white painted kerb line."
E = "CVLab-EPFL research use"
S = {}
def add(**k): S[k["id"]] = k
N = None
cams4 = lambda *cr: [{"c": i, "crop": c} for i, c in enumerate(cr)]
# ---------------- Batch 1
add(id="B1-01", batch=1, ds="lab6p", title="Lab, 4 cameras, six people, one room", start_s=69, dur_s=40, cams=[{"c": i} for i in range(4)], overlap_target="full",
    edge=["heavy_occlusion_crowd", "crossing_paths"], hints=LAB, label="EPFL Laboratory 6p")
add(id="B1-02", batch=1, ds="lab4p", title="Lab, 4 cameras, four people", start_s=113, dur_s=40, cams=[{"c": i} for i in range(4)], overlap_target="full",
    edge=["crossing_paths", "occlusion"], hints=LAB, label="EPFL Laboratory 4p")
add(id="B1-03", batch=1, ds="lab4p", title="Lab, 2 cameras cropped to the same floor", start_s=60, dur_s=40, overlap_target="full",
    cams=[{"c": 0, "crop": [40, 80, 330, 230]}, {"c": 1, "crop": [0, 0, 330, 270]}], edge=["people_leaving_reentering", "crossing_paths"], hints=LAB, label="EPFL Laboratory 4p")
add(id="B1-04", batch=1, ds="lab4p", title="Lab (4p), 2 cameras on disjoint floor areas (rug side vs carpet side), people walk between them", start_s=0, dur_s=40, overlap_target="none",
    cams=[{"c": 0, "crop": [0, 0, 200, 188]}, {"c": 2, "crop": [0, 60, 150, 288]}], edge=["people_leaving_reentering", "crossing_paths"], hints=LAB, label="EPFL Laboratory 4p")
add(id="B1-05", batch=1, ds="lab4p", title="Lab, 2 cameras cropped to half-shared floor", start_s=0, dur_s=40, overlap_target="partial",
    cams=[{"c": 0, "crop": [0, 0, 240, 260]}, {"c": 1, "crop": [60, 0, 360, 200]}], edge=["people_leaving_reentering", "crossing_paths"], hints=LAB, label="EPFL Laboratory 4p")
add(id="B1-06", batch=1, ds="terrace1", title="Roof terrace, 4 cameras, seven people", start_s=105, dur_s=40, cams=[{"c": i} for i in range(4)], overlap_target="partial",
    edge=["heavy_occlusion_crowd", "crossing_paths"], hints=TERR, label="EPFL Terrace 1")
add(id="B1-07", batch=1, ds="passageway", title="Underground passage, 4 cameras, poor light", start_s=52, dur_s=40, cams=[{"c": i} for i in range(4)], overlap_target="partial",
    edge=["low_light_uneven_lighting", "crossing_paths", "people_leaving_reentering"], hints=PASS, label="EPFL Passageway 1")
add(id="B1-09", batch=1, ds="lab6p", title="Lab, 3 cameras, partial overlap, lights fade", start_s=45, dur_s=40, overlap_target="partial",
    cams=[{"c": 0, "crop": [0, 0, 330, 150], "bright": [12, 28, 0.4]}, {"c": 2, "crop": [40, 0, 330, 270], "bright": [12, 28, 0.4]}, {"c": 3, "crop": [40, 0, 290, 270], "bright": [12, 28, 0.4]}],
    edge=["lighting_change_synthetic", "heavy_occlusion_crowd"], hints=LAB, label="EPFL Laboratory 6p")
add(id="B1-10", batch=1, ds="campus4", title="Courtyard, 3 cameras, low resolution, 1 s offset", start_s=17, dur_s=30, overlap_target="partial",
    cams=[{"c": 0, "crop": [0, 0, 290, 190], "scale": 1.0}, {"c": 1, "crop": [0, 0, 290, 190], "scale": 1.0, "offset_s": 1.0}, {"c": 2, "crop": [0, 0, 290, 270], "scale": 1.0}], edge=["low_resolution", "time_offset", "crossing_paths"], hints=CAMP, label="EPFL Campus 4")

add(id="B1-08", batch=1, ds="terrace1", title="Roof terrace, 4 cameras, crowd of ~6 people at once, partial overlap (2nd window)", start_s=14, dur_s=40, cams=[{"c": 0, "crop": [0, 0, 200, 288]}, {"c": 1, "crop": [160, 0, 360, 288]}, {"c": 2}, {"c": 3, "crop": [0, 0, 360, 288]}], overlap_target="partial",
    edge=["heavy_occlusion_crowd", "crossing_paths"], hints=TERR, label="EPFL Terrace 1")
# ---------------- Batch 2
add(id="B2-11", batch=2, ds="lab6p", title="Lab, 2 cameras on disjoint floor areas (rug side vs far carpet corner), people walk between them", start_s=0, dur_s=40, overlap_target="none",
    cams=[{"c": 0, "crop": [0, 0, 210, 190]}, {"c": 1, "crop": [40, 20, 360, 150]}], edge=["people_leaving_reentering", "crossing_paths", "heavy_occlusion_crowd"], hints=LAB, label="EPFL Laboratory 6p")
add(id="B2-12", batch=2, ds="wildtrack", title="Public square, 3 HD cameras seeing the same floor, crowd (2 fps)", a=20, n=40, overlap_target="full", cams=[{"c": c, "scale": 0.5} for c in (2, 3, 6)],
    edge=["heavy_occlusion_crowd", "crossing_paths", "low_frame_rate"], hints=WTH, label="WILDTRACK")
add(id="B2-13", batch=2, ds="terrace2", title="Roof terrace (sequence 2), 4 cameras, six people", start_s=20, dur_s=40, cams=[{"c": i} for i in range(4)], overlap_target="partial",
    edge=["heavy_occlusion_crowd", "crossing_paths"], hints=TERR, label="EPFL Terrace 2")
add(id="B2-14", batch=2, ds="campus4", title="Courtyard, 2 cameras, people walk out of view and come back, 0.5 s offset", start_s=26, dur_s=30, overlap_target="partial",
    cams=[{"c": 0, "crop": [40, 0, 330, 190]}, {"c": 2, "crop": [0, 0, 250, 270], "offset_s": 0.5}], edge=["people_leaving_reentering", "time_offset", "crossing_paths"], hints=CAMP, label="EPFL Campus 4")
add(id="B2-15", batch=2, ds="lab4p", title="Lab, 3 cameras, low resolution, one camera dims", start_s=0, dur_s=40, overlap_target="partial",
    cams=[{"c": 0, "crop": [0, 0, 230, 210], "scale": 1.0}, {"c": 2, "crop": [0, 90, 300, 288], "scale": 1.0, "bright": [10, 25, 0.35]}, {"c": 3, "crop": [130, 60, 360, 250], "scale": 1.0}],
    edge=["low_resolution", "lighting_change_synthetic", "people_leaving_reentering"], hints=LAB, label="EPFL Laboratory 4p")
# ---------------- Batch 3
add(id="B3-16", batch=3, ds="lab6p", title="Lab, 2 cameras on the same floor, low resolution, lights switch off", start_s=51, dur_s=40, overlap_target="full",
    cams=[{"c": 0, "crop": [120, 0, 330, 270], "scale": 0.75, "bright": [20, 21, 0.45]}, {"c": 1, "crop": [0, 0, 330, 270], "scale": 0.75, "bright": [20, 21, 0.45]}],
    edge=["low_resolution", "lighting_change_synthetic", "heavy_occlusion_crowd"], hints=LAB, label="EPFL Laboratory 6p")
add(id="B3-17", batch=3, ds="lab6p", title="Lab (6p), 2 cameras on nearly disjoint floor areas (rug side vs carpet), people walk between them", start_s=0, dur_s=40, overlap_target="none",
    cams=[{"c": 0, "crop": [0, 0, 200, 185]}, {"c": 2, "crop": [0, 0, 200, 288]}], edge=["people_leaving_reentering", "crossing_paths"], hints=LAB, label="EPFL Laboratory 6p")
add(id="B3-18", batch=3, ds="campus4", title="Courtyard, 3 cameras, partial overlap, people leave and return", start_s=15, dur_s=30, overlap_target="partial",
    cams=[{"c": 0, "crop": [20, 0, 300, 230]}, {"c": 1, "crop": [40, 0, 330, 190]}, {"c": 2, "crop": [0, 0, 330, 230]}], edge=["people_leaving_reentering", "crossing_paths"], hints=CAMP, label="EPFL Campus 4")
add(id="B3-19", batch=3, ds="wildtrack", title="Public square, all 7 HD cameras, dense crowd (2 fps)", a=20, n=40, overlap_target="partial", cams=[{"c": c, "scale": 0.5} for c in range(1, 8)],
    edge=["heavy_occlusion_crowd", "crossing_paths", "low_frame_rate"], hints=WTH, label="WILDTRACK")
add(id="B3-20", batch=3, ds="lab6p", title="Lab, 4 cameras on partly shared floor, six people, 1 s offset on one camera", start_s=45, dur_s=40, overlap_target="partial",
    cams=[{"c": 0, "crop": [0, 0, 210, 270]}, {"c": 1, "crop": [0, 0, 210, 270]}, {"c": 2, "crop": [0, 0, 210, 270], "offset_s": 1.0}, {"c": 3, "crop": [0, 0, 300, 270]}],
    edge=["heavy_occlusion_crowd", "crossing_paths", "time_offset", "people_leaving_reentering"], hints=LAB, label="EPFL Laboratory 6p")

def main(ids):
    for i in ids or list(S):
        sp = S[i]
        if sp["ds"] == "wildtrack": t = build_wt(sp)
        else: t = build(sp)
        print(i, t["overlap_measured"], "target", sp["overlap_target"], [[round(x, 2) for x in r] for r in t["overlap_matrix_shared_fraction_of_smaller_view"]], flush=True)
if __name__ == "__main__": main(sys.argv[1:])
