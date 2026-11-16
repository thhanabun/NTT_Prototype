# Handover: Basket detection main (2026-11-14 afternoon)

**Role:** main dev for nttauto (`C:\Users\User\OneDrive\Desktop\nttauto.md`). Fix root causes from Testing reports; never relax pass criteria without writing it in `AUTOPLAN.md`. Don't push anything. The user is away; decide alone.

## Where things are
- **Plan, rules, progress log:** `AUTOPLAN.md`. Read its progress log first.
- **Board:** `tests/STATUS.md`.
- **Features:** README items 19–24.
- **Skills:** `SKILLS_EVAL.md`.
- **Token habits:** `TOKEN_PLAN.md` and the root `CLAUDE.md`.
- **Server:** `../NTT_Prototype/.venv-vision/Scripts/python.exe -I server.py`, run in the background from `shelf-calibration-prototype/`, on :8090. It loads the re-ID model at start; never load OpenVINO models from request threads, it deadlocks.

## Scenario state
| Scenario | State |
| --- | --- |
| B1-02, B1-03 | PASS |
| B1-01 | PARKED after 6 runs. Steady live run: 0.32 m, 1.67 ids/person. Remaining problem: one take-over between look-alike people. |
| B1-04 | WILDTRACK, no overlap. Plan references are weak, so it can't be tied. Data issue, waiting on Finding Video. |
| B1-05 | Rebuilt, partial. cam0 tied at 0.04 m. cam1 needs the plan's carpet polygon. |
| B1-06, B1-07 | Weak plans (tiles, passage). |
| B1-09 | By-eye rug corners 0.4 m off. |
| B1-08, B1-10, batches 2–3 | Not run. |

## System changes made today (all in README / AUTOPLAN)
- **Camera fit:** real-camera fit with a prior is preferred over the free 8-value fit.
- **Tracker:** floor tracker `trackRound` in `geometry.js`, using per-camera Hungarian assignment, binding and re-ID (OpenVINO retail-0286, re-ID throttle follows video time).
- **Hidden feet:** placed from the head ("rough" sightings).
- **Weak cameras:** they can't spawn people. "ปรับจากคนเดิน" uses an appearance RANSAC re-tie. It is also offered when a camera disagrees by more than 0.35 m and its clicks fit worse than 0.25 m.
- **Alignment:** "จัดให้ตรงกับกล้องอื่น" (similarity alignment).
- **Steady mode** (1/8 s video steps, deterministic).
- **Set loader** resets ties.
- **Dev tools (main only):** `tests/tools/` contains `id_eval` (blip-filtered), `foot_error`, `track_purity`, `reid_eval`, `dev_helpers.js` (devLoadState / steadyRun / devRecord / variant), and `/devlog/<name>` POST/GET.
- **Tried and rejected:** swap repair, relabelling, frozen gallery, colour+re-ID mix, corner snap.

## Open items / next steps
1. **Heartbeat:** the script was stopped at 14:09 (Scheduler, not by main). The relay task `ntt-heartbeat-relay` never relayed trigger 1, probably stuck on a permission prompt. When the user says continue: restart the heartbeat and fix the relay; the user may need to "Run now" it once in the app.
2. **After the 5-hour reset:** new Testing and Finding Video sessions from `tests/HANDOVER_testing.md` and `tests/HANDOVER_findvideo.md` plus `TOKEN_PLAN.md` §4. Archive the old two only with the user's OK.
3. **Biggest system lever left:** by-eye corner precision on low-res views. Ideas not yet tried:
   - people-based tie as the primary path for hard views;
   - better plan references.
4. **Finally:** all 20 passes, a streak of 5 distinct scenarios, consolidated function log, stop the heartbeat, final report (see nttauto Step 7).
