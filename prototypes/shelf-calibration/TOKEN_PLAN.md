# Token plan (Token Optimizer session, 2026-11-14)

Rules of AUTOPLAN stay: user-level actions only, no computed coordinates, truth only for scoring. Nothing below changes the app or what a test does; it changes how much each step costs.

## 1. Where the tokens went (measured from transcripts)
| Session | Context now | Tool calls | What dominates |
|---|---|---|---|
| Testing System | 582k (525k messages) | 1 000+: browser `computer` 523 (181 clicks, 121 screenshots, 65 key, 65 wait, 33 scroll_to, 19 zoom), Bash 136, javascript 118, `find` 73, batch 57, SendMessage 34 | round trips × a big context |
| Finding Video | 398k | 161 Bash, 50 Read (48 images, ~930 px each), 18 SendMessage | same |
| Main | 569k | 515 Bash, 385 javascript, 55 update_plan, 36 wrap_up, 46 Read+46 Write | same |
| Scheduler | 80k | tiny | fine |
| Research | idle | – | fine |

Key finding: **text output is not the cost** (all Bash/JS results of Testing together ≈ 130 KB; images ≈ 190 × ~600 tokens ≈ 0.1 M). The cost is that **every tool call re-reads the whole context** (cached, but it still counts against the 5-hour limit). 1 000 calls × ~300 k average context ≈ 300 M tokens read. So the two levers are: (a) fewer round trips, (b) a smaller context per round trip. Skills that shrink *output text* (Caveman, RTK, terse-reply rules) attack a small term.
Also seen: Testing padded dumps with `'x'.repeat(130000)` to force a result file, and re-read refs/state with many tiny JS calls (`refs.length`, `playing`, `scrollTop=0` …).

## 2. Savings (estimate = share of a Testing scenario's cost)
| # | Change | Est. saving | Rule-safe? |
|---|---|---|---|
| 1 | **Batch the clicking.** One `browser_batch` per camera: click corner 1…n by eye, then ONE small zoom at the end, instead of click→screenshot per corner. Verify with `th.state()` (text), not images. | 40–50 % of calls (~25 of ~60/scenario) | yes – clicks still chosen by eye from a screenshot taken before the batch |
| 2 | **`th.state()`** (new, `tests/harness/th.js`): one 400-char line replaces screenshots/`find`/tiny JS calls for ties, rms, people, playing, status text. | ~15 calls and ~15 images/scenario | yes – read only |
| 3 | **`await th.run(name)`**: rewind + press Play + sample + POST to `/devlog/<name>`, returns ~200 chars. Kills the polling loop, the 130 KB padding and the separate dump call. | ~8 calls, ~130 KB junk | yes – presses the user's own Play |
| 4 | **`python tests/harness/score_dev.py <scn> <name> <limit>`**: one call scores (extract+metrics+id_eval) from the saved file and prints one line. | ~4 calls | yes – scoring only |
| 5 | **Images**: screenshots `scale` 0.4–0.5 for orientation; `zoom` on a region (e.g. 300×200) only when placing a corner; never full-size 800×600 twice in a row (74 of 194 were 800×600). Prefer `read_page`/`find` text over screenshots for buttons. | ~50 % of image tokens | yes |
| 6 | **Context hygiene (biggest)**: a session that passes ~250 k tokens finishes its current scenario, writes `tests/HANDOVER_<role>.md` (state, next scenario, learned tricks, ≤1 page) and is replaced/compacted. Context 580 k → ≤250 k roughly halves cost per call. Done at scenario boundaries only, so no work is lost. | ~35–50 % of all later calls | yes |
| 7 | **Model/effort**: Testing & Finding Video: Sonnet 5.5 *low* for routine clicking/scoring steps, *medium* only when diagnosing a fail; Scheduler: Haiku 5.5 low (it only reads state and sends one message); Research: Sonnet medium, idle otherwise; Main: Opus stays for fixes but use Sonnet for log reading/summaries. | 20–30 % per session | yes |
| 8 | **Messages between sessions ≤ 5 lines**, details in a file in the shared notes folder; reports in `tests/STATUS.md` only (one row per run). Main sent/received ~80 messages and 55 `update_plan` + 36 `wrap_up` calls: update the plan only at phase changes. | ~5–10 % | yes |
| 9 | **Finding Video**: contact sheets at 640 px (was ~940) and one sheet per scenario, text-first checks (`verify.py` output) before looking at any image; stop re-reading plans already in `tests/tools/plans`. | ~30 % of its images | yes |
| 10 | **Don't poll**: Testing waits with one `th.run` instead of repeated `wait`+`javascript` (65 waits, 8 "t:…" polls). Scheduler: heartbeat message is fixed text, no reading of logs. | ~5 % | yes |

Combined realistic target for a Testing scenario: ~60 → ~25 UI/tool calls, and each call ~40–50 % cheaper if context is kept ≤250 k → roughly **3–4× cheaper per scenario**. These are estimates, not measured.

## 3. The skills you listed (all already evaluated in `SKILLS_EVAL.md`; re-checked against the measurement above)
| Item | Verdict now | Why / how to use |
|---|---|---|
| ponytail | **use** (already) | Short replies + smallest change; helps item 8. Testing: lite. |
| Karpathy rules | **use as 4 written rules** (no install) | "goal-driven": define pass/fail first; "surgical": no side work. Tiny standing cost. |
| systematic-debugging | **use `diagnosing-bugs`** (equivalent, installed) | Fewer blind retries on a failed run = fewer scenarios re-run. |
| Context-handoff / session summary | **use manually at item 6** | Our `HANDOVER_<role>.md` is the same idea without installing a skill. This is the one that attacks the real cost. |
| token-saving / token-efficiency | **practices only** | Instruction files add input tokens to every call; the practices in section 2 are what count. |
| Caveman | skip | Saves ~8 % of the small output term; terse text hurts fail reports; CLI telemetry. |
| RTK | skip | Compresses shell output, which is already small here; hook could hide test detail. |
| mksglu = context-mode | skip (maybe later for Main only) | It also keeps big tool output out of context, but denies large reads/curl/WebFetch, needs Node ≥ 24.15, Elastic licence; image and call counts are not helped. |
| Context7 | skip | Docs lookup, not a saver. |
| Superpowers | skip | Hook forces skill loading each start/compact: more tokens, clashes with autonomous flow. |

## 4. How to use the new helpers (Testing)
```
python tests/harness/install_th.py                 # once (and after editing th.js)
// in the page console, once per page load:
eval((await (await fetch('/devlog/th')).json()).src)
th.state()                                         // text status, replaces screenshot checks
await th.run('B1-04-run1')                         // play whole clip, saves dump to server
python tests/harness/score_dev.py B1-04 B1-04-run1 0.30
```
`th.js` only reads state and presses #rewind/#play; it cannot place or move any corner, tie or point. `th.state()` was checked on the live page; `th.run` / `score_dev.py` follow the format already used by `extract.py`/`score_run.py` but have **not** been run end-to-end (that needs a scenario test, which this session must not run). Testing should try them on its next scenario and fall back to the old path if the dump differs.

## 5. Audit after the resume (Testing, B1-05 2nd try, 2026-11-14 08:28–08:31Z; `token-audit` on that slice)
| Metric | Before (whole old run) | This try |
|---|---|---|
| Model calls | 433 (~60/scenario) | **32** for one scenario attempt (no run: data issue) |
| Median context | 335K | **603K** (start 583K, peak 620K) |
| Total input | 144M | **19.3M** for this one attempt |
| Images | 180 | 15 (8 of 9 screenshots scaled, 1 zoom) |
| Batches | 56 for the whole run | 5 batches of 4–14 actions |

- Call habits improved: ~half the calls, `th.state()` used, clicks batched, small screenshots.
- Cost per call went **up**: the old 600K context was kept instead of a fresh session from `HANDOVER_testing.md`. The same 32 calls in a fresh session (~80–150K) would cost ~3–5M, i.e. **4–6× less**. This is now the single biggest remaining waste.
- `th.run` / `score_dev.py` are still unused (no scored run yet).
- Rule question for main (not a token issue): the map corners of the carpet and rug were placed by computing map-pixel positions in JS from `floorplan.json` metres. The data is plan knowledge, not truth, but AUTOPLAN says "no computed coordinates". Main should decide: allow it, or add a user-level way to type plan positions into the page.
- Resolved (main): page now takes typed plan metres (README item 25), JS pixel placement is banned, and the B1-05 retry is unscored. Fresh Testing/Finding Video sessions are still pending: a message-triggered turn cannot start sessions, so the user must ask main.

## 6. Check 2026-11-15 ~22:30Z (`tests/harness/ctx_watch.py`, zero model tokens; table in `tests/CONTEXT.md`)
- **Weekly limit 93 % used, 5.5 days left.** 5-hour window 41 %.
- Over 250K: Testing 2 556K, Finding Video 2 358K, Testing 3 349K, Testing 4 251K (old Testing 774K, idle). The handover rule is not being followed.
- Two Testing sessions run in parallel (ports 8090/8091), so the cost is doubled.
- Heartbeat relay task: every hour, ~64K start context per run.
- Actions: (1) run one Testing session at a time; (2) archive idle T1/T2/T3 and old Finding Video; (3) run `ctx_watch.py` on every heartbeat, and main hands over anything flagged OVER; (4) relay task every 5 h instead of hourly; (5) Token Optimizer itself hands over at ~250K (`tests/HANDOVER_tokenopt.md`).

## 7. Check 2026-11-16 ~07:50Z (token-audit per transcript)
| Chat | Calls | Median / peak ctx | Total input |
|---|---|---|---|
| **Main** (Opus) | 1,419 | 300K / **968K**, 8 compactions | **494M** |
| Testing 7 | 168 | 162K / 264K | 27.3M |
| Testing 8 | 141 | 184K / 268K | 25.7M |
| Testing 9 | 42 | 137K / 174K | 5.5M |
| Cam redesign (Fable) | 40 | 227K / 255K | 8.0M |
- Testing now hands over near 260K and its median is ~160K (was 335–600K). OK.
- Main is ~85 % of the measured input. It compacts only at 97 % of the 1M window, so it runs at 300–968K. Its calls are mostly Bash 691 + page JS 460 (replays and evals).
- Fix applied: `env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = "30"` in both project settings, so every session here auto-compacts at ~300K. It takes effect on the next session start; verify with `get_usage` (`autoCompactsAtPercent` should read 30).
- Main also: run replay/eval loops as one script call each (e.g. a node/python batch that loads all variants and prints one table), not one JS call per variant.
