# Candidate skills: evaluation (2026-11-14)

Rule used: adopt only what is already installed or verifiable here, works with the tools, and does not lower quality. No third-party code was downloaded or installed (installing plugins/hooks changes the user's Claude setup and runs unreviewed code while the user is away).

| Skill | Available here? | Verdict | Why |
| --- | --- | --- | --- |
| ponytail | yes (`~/.claude/skills/ponytail`) | **adopt** – main (full), Testing (lite) | Smallest change that fixes the root cause; short reports. Matches "fix root cause, no patching around". |
| systematic-debugging | equivalent installed: `diagnosing-bugs`, `engineering:debug` | **adopt `diagnosing-bugs`** – main | Same loop (reproduce → hypothesise → instrument → fix → regression check). Used for every failed scenario. |
| Karpathy rules | no skill file; known guidelines (think before coding, simplicity first, surgical changes, goal-driven verification) | **adopt as written rules** – all sessions | Pure guidance, no install; overlaps ponytail. `llm-council` (Karpathy's council) not adopted: 5 advisor agents per decision costs a lot for little gain here. |
| Context-handoff / session summary | `handoff`, `claude-handoff` installed | **adopt `handoff` only on demand** – main, Testing | The app already compacts long chats automatically; handoff is used only if a session must be replaced. `claude-handoff` launches CLI background jobs outside the app — rejected. |
| Context7 | not installed (MCP server) | **skip** | Would need adding an MCP server to the user's config. Library docs (ultralytics, OpenCV, torchreid) go through the Research session instead. |
| Superpowers (obra) | not installed | **skip** | Large plugin with its own hooks/workflow (brainstorm → plan → subagent TDD); would override this plan's flow and needs a plugin install. Its debugging + TDD parts are covered by `diagnosing-bugs` / `tdd`. |
| RTK | not installed | **skip** | CLI proxy that rewrites shell output to save tokens; changes tool behaviour (risk of hiding errors in test output). |
| Caveman | not installed | **skip** | Compresses replies into terse "caveman" text: saves tokens but makes failure reports harder to read. Fails the quality rule. |
| mksglu | not installed, not verifiable | **skip** | Could not verify what it is/does safely offline; not installed. |
| token-saving / token-efficiency | no specific skill installed | **adopt as practice** | Practices used instead: read files by range/grep, keep logs in files not chat, Sonnet 5.5 medium for helper sessions, short messages between sessions. |
| tdd | installed | **Testing: partial** | Scenario tests are the red/green signal; no unit framework in the prototype, so not used as a workflow. |
| research | installed | **Research session** | Captures findings as Markdown in the repo. |

## Research check of uninstalled skills (Research session, 2026-11-14)
Primary sources (GitHub repos, SKILL.md and hook files). Full notes: `C:\Users\User\AppData\Local\Claude-Data\claude_pzs8sxrjxfjjc\side-session-notes\local_998bd983-4953-4f01-be63-7141ce06cec2\skills-research.md`. **Nothing installed**:
- **Superpowers:** a SessionStart hook forces skill use at every start/compact; it clashes with autonomous sessions and with the installed tdd/diagnosing-bugs.
- **systematic-debugging:** redundant with `diagnosing-bugs`.
- **Karpathy skills repo:** no licence, and its "ask rather than guess" rule conflicts with no-questions mode. The principles stay as written guidance only.
- **Context7:** needs an MCP server plus an account; it doesn't save tokens.
- **mksglu/context-mode:** hooks deny large reads, curl/wget and WebFetch, which would break downloads and verbatim test logs. Elastic licence; needs Node ≥ 24.15.
- **RTK:** a binary plus a hook that rewrites Bash output; it could hide test detail.
- **Caveman:** CLI telemetry is on by default; skill-only mode saves ~8.5% of output and makes reports terse.
- **Token-efficiency instruction files:** add input tokens every turn and can cost more than they save.
- **Handoff skills:** duplicate the app's own hand-off, notes and memory.

Token habits used instead: read by range, search narrowly, keep logs in files, short messages between sessions, Sonnet medium for helpers.

## Per session
- **Basket detection main:** ponytail (full), diagnosing-bugs, Karpathy rules, handoff on demand.
- **Testing System:** ponytail (lite) for reports, Karpathy "goal-driven verification", handoff on demand.
- **Finding Video:** Karpathy rules, token practices.
- **Research:** research skill, Karpathy rules.
- **Scheduler:** none (notification only).

## Update 2026-11-14: re-check after the user installed more (Token Optimizer)
Measured on the Testing transcript (`token-audit`): 433 model calls, median context 335K, **total input 144M vs output 212K** (text replies 20 KB). Input is about 700× output. A skill only pays off if it cuts calls or context, not reply length.

| Installed item | Decision (this project only) | Reason |
|---|---|---|
| superpowers 7.0.2 (plugin, MIT) | **off** in `.claude/settings.json` | Its SessionStart hook injects `using-superpowers` on every start and compaction, and that skill says to "invoke a skill if 1 % chance". It also adds 15 skill descriptions to every call, and its brainstorm/worktree/TDD rules add calls. Its useful rules are kept as one line in `CLAUDE.md` ("evidence before claims"); `diagnosing-bugs` covers systematic-debugging. |
| context7 (plugin, remote MCP) | **on**, but it needs `/mcp` sign-in to work | Tools are deferred (near-zero standing cost). Main may use it for OpenVINO/ultralytics API questions. It sends only library-name queries. |
| context-mode / mksglu (plugin, ELv2) | **off** (was already off) | Its hooks intercept Bash/Read/Grep/WebFetch/mcp__*. Here those results are small (Testing Bash 63K chars total), so the gain is small and it risks hiding verbatim test output. Node 24.22 now satisfies its engine requirement, so it could be tried later on Main only. |
| caveman / ultracave / megacave | not used | Would cut the 0.15 % output term. Reports to the user get harder to read. |
| karpathy-guidelines (MIT) | **use** | Main before code changes; Finding Video and Research. In autonomous runs, "ask" becomes "write the assumption down". |
| ponytail | **use** | Main full, Testing lite. |
| token-audit | **use** on demand | Measures calls × context from transcripts; this table came from it. |
| handoff | **manual equivalent** | It is user-only (`disable-model-invocation`) and writes to the OS temp folder. Sessions write `tests/HANDOVER_<role>.md` instead when context passes ~250K. |
| claude-handoff | not used | Starts `claude --bg` agents outside the app's linked sessions. |
| research, diagnosing-bugs, tdd, prototype, code-review | keep (on demand) | No standing cost beyond their description. |
| other personal skills (writing-*, teach, triage, to-*, wayfinder, scaffold-exercises, setup-*, migrate-to-shoehorn, …) | unused here | See `CLAUDE.md` / `.claude/settings.json` for what is hidden in this project. |
| RTK 1.2.0 (installed at ~/.local/bin, no hook) | **off** (user decision 2026-11-14) | `rtk discover`: 528 of 2,221 commands handled, ~180K output tokens saveable in 30 days. Our own Python scripts pass through unchanged. The installer only hooks globally, and `rtk read` would filter the code and logs main debugs with. |
