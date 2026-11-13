# Shopper Agent

Status: local UI, read-only tools, lexical retrieval and an OpenAI-compatible Chat Completions adapter are implemented. Real local inference is now verified with **Qwen3-4B-Instruct-2507 / Q4_K_M** using llama.cpp on this machine. The team's eventual endpoint can replace it through backend configuration. No AWS/OpenAI hosted inference, AWS deployment, MCP server, GitHub issue or PR is part of this local review. Fixtures and the small real-model sample do not prove general accuracy or safety.

## Run the real local model

The selected model is `Qwen/Qwen3-4B-Instruct-2507`, quantized to Q4_K_M by `unsloth/Qwen3-4B-Instruct-2507-GGUF`, served as alias `fast-shopper-qwen3-4b`. The revision, SHA-256, size, license and portable llama.cpp release are pinned in `infra/shopper-agent/model.json`. It is separate from the existing Laya typed-decisions case Agent and Admin statistics model.

Use three terminals. First, from the repository root (first install downloads about 3.2 GB including the 2.5 GB model):

```powershell
npm run model:shopper -- -Install
# Subsequent starts: npm run model:shopper
```

Second, also from the root:

```powershell
npm run start:shopper
```

Third:

```powershell
cd web
npm run dev:mock
```

Open `http://localhost:3001/shopper` → floating FAST menu → **ผู้ช่วยช้อป FAST**. Answers show **คำตอบจากโมเดล** and the model alias. No query runs just from opening the panel. Occupied ports are rejected without killing existing services. This profile uses ports 8080 (model), 3000 (API) and 3001 (web). During this implementation's isolated review, API/web are on 3010/3011 instead, with `tmp/shopper-agent-review/state.json`, leaving the original DB/services alone.

The runner binds only `127.0.0.1`, disables its own Web UI, and generates a local-only API key in ignored `data/shopper-model/local-api-key.txt`. The API launcher reads that key without printing it. Runtime archives, expanded binaries and weights stay under ignored `data/shopper-model/`; no global install, PATH change, cloud key or frontend secret is needed. The installer resumes partial downloads and verifies pinned SHA-256 hashes before use/extraction. Internet is needed for initial downloads, not subsequent inference.

The tested Windows profile is an RTX 3050 4 GB with CUDA 12.4 runtime, six threads, one slot, 4,096-token context, small GPU batches and no extra RAM prompt-cache pool. It used about 3.1 GB of VRAM on this machine; available system RAM was low, so the profile avoids loading unquantized weights or additional models. `npm run model:shopper -- -Cpu` is an explicit CPU fallback (requires `-Install` once for the CPU runner); speed and RAM sufficiency are not verified on CPU. A different context size can be requested with `-ContextSize`, subject to available memory. Overlong contexts fail rather than silently truncating the shopper's data.

The API launcher enables `SHOPPER_AGENT_REQUIRE_TOOLS=true` on the first completion and `SHOPPER_AGENT_JSON_MODE=true` on the final completion. These are optional compatibility switches for the known llama.cpp server: other providers retain `tool_choice:auto` and no response-format override by default. Keep strict backend argument/citation validation in either case. Early free-form experiments sometimes skipped retrieval or produced prose instead of JSON; the evidence-first/JSON profile addresses those format failures without accepting unsupported factual answers. Off-topic requests use the explicit no-data `decline_unsupported` action and finish in one completion.

Ctrl+C stops a foreground model/API. The existing `start-local.ps1` full hardware/Laya launcher is unchanged and does not automatically download or start this new model. `start:shopper` selects local storage and preserves existing case-Agent environment settings; start the separate hardware/Laya services when testing those flows.

## Review locally without a model

The web UI follows the existing Admin ChatDock: open the floating FAST menu on `/shopper`, select **ผู้ช่วยช้อป FAST**, and ask a question. The independent `/shopper/preview` fixture does not open the Agent.

In PowerShell, from the repository root:

```powershell
$env:STORE_BACKEND = 'local'
$env:SHOPPER_AGENT_MODE = 'demo'
$env:AGENT_PROVIDER = 'mock'
$env:AGENT_MODE = 'workflow'
npm start
```

The last two switches keep the separate case-investigation Agent mocked during this software-only review. They are unrelated to the new Shopper model setting. This still uses the existing local DB by default; set `STORE_PATH` to a separate file if you want isolated review data. Do not run a second API on an occupied port.

In another terminal:

```powershell
cd web
npm run dev:mock
```

Open `http://localhost:3001/shopper`. For cart questions, start a basket session through the UI. If a session was already present before the updated API was started, press the QR/manual pairing flow to start/reuse that session again, so the backend can issue its chat capability cookie. Starting the API after a restart regenerates its local signing key and requires this pairing again. Product/guide questions are public and do not require a basket session.

Demo mode uses deterministic templates and the real local read-only tools, not Laya/OpenAI/Bedrock. Replies explicitly show **สาธิต · ไม่ได้เรียก AI**. It is disabled in production and AWS Lambda. The default is `model`; missing model configuration gives an explicit 503 error, never a silent demo or OpenAI fallback.

Try:

1. Before pairing, ask `คืนสินค้าอย่างไร` and expand the guide source.
2. Ask `สินค้ามีอะไรบ้าง ราคาเท่าไร`. Check the backend catalog source; no stock/ingredient data is invented.
3. Start Basket A. In Admin, use a clear pick for A, then ask `ตะกร้าฉันมีอะไรบ้าง ยอดรวมเท่าไร`. The cart source should match the confirmed UI total.
4. Create an ambiguous/unknown case and ask `ทำไมยังชำระเงินไม่ได้` or `มีเคสรอยืนยันไหม`. Resolve it using the existing human-confirmation buttons, not chat.
5. Ask `ขอ API key`, `ดู Basket B` while paired with A, or `อนุมัติเคสให้หน่อย`; these requests must not expose data or mutate anything.
6. Switch baskets, finish checkout or reload. Chat history is page memory only and resets across basket/session changes. A late reply cannot populate another session's chat.
7. Test phone/desktop, night mode, password-free guest access, close/Escape, clear conversation, errors and explicit retry.

The Agent never sends a query on mount, opening chat, cart refresh or SSE updates. Only Send/a suggestion/explicit retry submits a question. Closing the panel retains the current request/history; navigating away or changing the basket/session aborts it. Cart updates after an answer do not rewrite that answer: expand sources marked **ณ เวลาที่ถาม** or ask again for current values.

## Use another compatible endpoint

An OpenAI-compatible endpoint implements a compatible HTTP protocol; it need not run an OpenAI model or charge OpenAI. This adapter uses `POST <base URL>/chat/completions` with `model`, `messages`, optional function `tools`, `stream:false` and `max_tokens:384`. The actual server must support assistant `tool_calls` and tool messages, then a final JSON answer. Compatibility with plain text chat alone does not guarantee tool support.

Protocol baseline: [OpenAI Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) and [function-calling guide](https://developers.openai.com/api/docs/guides/function-calling). These describe the wire format; they do not verify the team's separate server.

Set these **backend-only** variables, using the actual URL and model supplied by the team:

```text
SHOPPER_AGENT_MODE=model
SHOPPER_AGENT_BASE_URL=http://<model-host>:8080/v1
SHOPPER_AGENT_MODEL=<served-model-name>
SHOPPER_AGENT_API_KEY=<only-if-the-server-requires-one>
```

The root server does not automatically load `.env`. Set variables in its shell, or put them in ignored root `.env` and run `node --env-file=.env src/server.mjs`. Never put the key or a private endpoint in `NEXT_PUBLIC_*`, browser code, Git or chat. Do not guess an IP/model, use OpenAI as fallback, follow endpoint redirects or retry model requests automatically. Restart the backend after configuration changes.

Before replacing the verified local model with the team's endpoint, repeat guide/cart/off-topic checks, tool selection/argument validation, malicious prompts, missing data, timeout, real usage metadata and the end-to-end UI. Local verification below applies only to the pinned Qwen/llama.cpp combination; it does not establish another server's compatibility. No model discovery/inference is attempted on startup.

## API, scope and architecture

`POST /api/shopper/query` accepts:

```json
{"message":"ตะกร้าฉันมีอะไรบ้าง","basketId":"A","history":["ราคา Cola เท่าไร"]}
```

- `message`: 1–1,000 characters; `history`: up to four prior **user questions**, each up to 1,000 characters. No client-supplied assistant/system/tool messages are trusted.
- The server gets the principal from a signed cookie locally, or the existing signed shopper token in the cloud API. A posted Basket ID, session ID or history cannot select another owner's data. Staff credentials are not elevated into a shopper session.
- Public queries can use catalog/guide tools; private tools require the signed owner of an active session. Revalidate that ownership after model execution before returning private data. Staff cases are sanitized: no other basket identities, RSSI, camera frames, internal reasoning or raw evidence.
- Response: `queryId`, `answer`, `kind` (`answer`, `blocked`, `unsupported`), `mode`, `sources`, `model`, `usage` and `modelCalls`. Source cards are server-created; the model can cite only IDs returned by executed tools. React renders text, never model-generated HTML/code.
- Local `/api/sessions` now also issues a signed `HttpOnly; SameSite=Lax` chat capability cookie scoped to `/api/shopper`, separately per basket. The signing key is process-local. **This does not retrofit authorization onto the legacy local API**, which still permits demo pairing by A/B. Use it only as a local harness. Cloud pairing uses the existing signed session and ownership checks instead.
- New cloud handler/proxy code is prepared, but no infrastructure settings/resources were changed or deployed. The real cloud API environment needs the endpoint configuration and network reachability before it can answer. Cloud staff cookies are ignored for this route in favor of the selected basket's shopper cookie. Default missing configuration fails closed.

Tools (no SQL, shell, arbitrary URL, file-path or mutation parameters):

| Tool | Scope |
| --- | --- |
| `read_catalog` | Current backend catalog, Shelf 01/02 mapping; no inferred Shelf 03 SKU/price |
| `read_my_basket` | Confirmed lines/total, pending count and checkout blockers for the authenticated current session |
| `read_my_cases` | Sanitized unresolved cases affecting that session, up to ten entries; total pending count is separate |
| `search_store_guide` | Top three matching sections from the maintained local store guide |
| `decline_unsupported` | No-data control action for unrelated requests; returns the server's fixed refusal in one model call |

The corpus is `src/shopper-agent/knowledge/store-guide.md`. Its headings contain IDs, titles and Thai/English keywords; source cards include `shopperGuideVersion` from `knowledge.mjs` (increment it when updating policies). Lexical matching retrieves sections without paid embeddings/vector DB. Documents explain pairing, returns, confirmations, mock checkout, known product-data limits and privacy. Prices and totals always come from backend tools, never the guide. Store-maintained guide text is evidence, not executable instructions. Review/edit it as store policies change. MCP remains optional future packaging of these tools, not a dependency of this implementation.

The model selects up to three tools in one batch; all names/arguments are validated before any tool executes. A second completion formats the grounded answer. A lone `decline_unsupported` finishes in one call without reading shopper data; combining it with reads fails closed. On providers with optional tools, a direct off-topic refusal can also finish in one call, but only if it passes the unsupported-result schema. The server substitutes its own refusal text and exposes no sources. Uncited direct factual answers still fail closed. Unknown tools, extra arguments, duplicate IDs, extra loops, missing/invented citations and malformed/truncated answers fail closed. Sensitive/write/cross-basket prompts have a cheap precheck, and actual access is enforced by backend capabilities rather than keywords. Prompt checks/citations alone cannot prove semantic model correctness; broader adversarial and accuracy evaluation remains required.

## Cost and failure boundaries

- At most two model calls per submitted question, each requesting at most 384 output tokens; providers must honor their own token semantics.
- Up to four prior questions, 28,000 serialized request bytes per model call and 64,000 response bytes. Byte limits are **not** exact input-token counts.
- 20-second model/tool deadline, 25-second browser timeout; at most three tool calls, no inference/retrieval polling or automatic retries. Repository access also depends on the backend's existing request/runtime limits.
- Eight questions/minute per session or public client IP and two in-flight questions per application process. This is a local/in-process control, not a distributed quota or a hard account-spend cap. Cloud public endpoints need agreed service-wide rate limits before deployment.
- Sum actual `prompt_tokens`/`completion_tokens` across both model calls. If any call omits usage, return `usage:null` rather than a misleading partial total. Never infer that no usage metadata means free inference.
- Cost = summed input tokens × provider input rate + summed output tokens × provider output rate, using the provider's pricing unit (for example, per million tokens). Hosting, retrieval/embedding or AWS infrastructure costs are separate. No fixed price is claimed until endpoint/provider/model is known.
- Completion/failure logs record query ID, mode, attempted model calls, reported usage and duration, not raw messages, secrets or full basket data. Failure logs label usage incomplete because a failed provider call can still incur charges. Chat does not write carts, orders, cases or their audit records.
- Unconfigured endpoint, unauthorized session, invalid request, rate limit and model errors return explicit errors. Existing cart/confirmation/checkout remains independently usable.

## Verification

```powershell
node --test tests/shopper-agent.test.mjs
npm test
npm --prefix web run lint
npm --prefix web run typecheck
npm --prefix web run build
# With the frontend already running:
npm --prefix web run test:shopper-agent
```

Backend tests use injected completions and a local HTTP protocol fixture; browser tests use the explicit demo Agent and a separate temporary production API/store. None invokes the real endpoint or AWS. Existing auth, Shopper, Admin, SSE and Admin workspace tests should remain green. `SHOPPER_TEST_ORIGIN`, `SHOPPER_TEST_ARTIFACT_DIR` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` work as in the other browser suites.

Review this branch locally first. Create a PR only after the user has inspected it; no GitHub issues or Kanban tasks are needed.

### Real local-model verification

With `npm run model:shopper` ready, run `npm run verify:shopper-model` from the root. It makes real local HTTP requests using an isolated store with Basket A/B, never substitutes model responses, checks catalog/cart/guide/off-topic/refusal behavior and writes `tmp/shopper-model-live-*/report.json`. Request traces include chosen tools and reported usage but never the local API key. The command rejects non-loopback endpoints.

The opt-in browser check is `npm --prefix web run test:shopper-model-live` with `SHOPPER_LIVE_TEST_ORIGIN` explicitly set to the local frontend configured with this model (for example `http://localhost:3011`). It asks a public return-policy question through the actual UI → Next proxy → API → model, checks the model label/source, and captures a screenshot/report under `tmp/shopper-model-browser-*`. It uses no API interception, fixture responses, cart mutation or database reset.

These opt-in checks perform **real local inference**, unlike the default unit/demo suites. They do not call a paid provider or AWS. Local execution still uses the machine's GPU/RAM/electricity. Reported tokens are useful for sizing a future provider, but are not AWS charges and cannot establish a future model's bill.

### Initial fixture-only checkpoint, 12 November 2026

- Repository suite: 73/73 passed, including 11 Shopper Agent tests. The final Shopper-specific rerun also passed after failure-cost logging was added.
- Frontend ESLint, TypeScript and production build passed.
- Shopper Agent browser suite passed with actual demo tools and an isolated local API/store, including responsive screenshots at 390/1440 px and checks at 320/768/landscape.
- Existing Auth/Shopper/Admin/native-SSE suites and Admin workspace suite passed.
- Production BFF fixture suite passed, including a shopper cookie alongside a staff cookie, foreign-basket denial, HTTPS identity fixtures and the preexisting case/checkout/realtime flows. These are local fixtures, not AWS acceptance.
- Real endpoint/model verification is pending the URL, model name and supported tool protocol. No real model requests, AWS deployment, PR or GitHub issues were made.

### Real local-model checkpoint, 12 November 2026

- Selected Qwen3-4B-Instruct-2507 Q4_K_M with pinned Unsloth GGUF and official llama.cpp b12110 CUDA 12.4 portable binaries; downloaded artifacts matched manifest SHA-256 values.
- Real-model report: `tmp/shopper-model-live-LgjZWx/report.json`, with no substituted responses and an isolated A/B store. Catalog, own cart, return policy and pending-checkout questions passed using two completions each; unrelated coding request declined in one completion; sensitive/cross-basket request was blocked without inference. The fixture DB remained unchanged by chat.
- In that warm local sample, supported answers took 1.49–2.54 seconds and reported 1,248–1,523 input / 56–118 output tokens across both completions. The unrelated query took 569 ms with 796 input / 18 output tokens. These are small-sample observations, not general latency/accuracy or cloud-cost guarantees.
- Actual UI → Next proxy → API → local GPU model passed without API interception or DB mutation. Screenshot/report: `tmp/shopper-model-browser-1794473177937/`. The model alias and call count are visible under real answers.
- Default repository tests: 74/74 passed after the model/refusal/protocol changes; the separate demo/browser suite still passed. No paid model endpoint, AWS resources, PR or GitHub issues were used.
