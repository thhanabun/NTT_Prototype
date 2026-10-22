# Admin Stat Query Chat

Open `/admin`, sign in with the existing development mock login, and use **Stat Query Chat** below the store metrics. Keep the local Laya service and Node API running from this branch. Restart the API after updating code; Next dev refreshes the UI automatically.

## Examples

- `ยอดขายรายวัน 1 สัปดาห์ plot เป็น bar graph`
- `สินค้า top 10 ตามยอดเงินย้อนหลัง 7 วัน`
- `สินค้า top 10 ตามจำนวนชิ้น 30 วัน เป็นตาราง`
- Follow-up: `เปลี่ยนเป็นกราฟเส้น`
- `ยอดขายรายวัน 2026-10-01 ถึง 2026-10-07 เป็นกราฟแท่ง`

Each answer shows the actual date range, Asia/Bangkok timezone, metric, chart and data source. Its table exposes exact values alongside an accessible SVG bar/line chart. There is no new chart dependency. Query details show the model's selected fields/probabilities and query ID. The chat keeps the last four exchanges in page memory; reloading clears it. Follow-ups reuse the last successful query from the selected source.

## Data sources

- **Orders in DB (Mock checkout)** reads the complete repository `orders` collection, including history beyond the ten recent orders in dashboard snapshots. Completed MOCK checkout orders contribute to sales; pending carts and unresolved cases do not. This prototype has no real payments.
- **Demo** uses a separately labelled, deterministic seven-day sample with Coke and Water. It never inserts orders into the DB. The sample totals ฿1,505, 77 units and seven orders; its time window moves with Bangkok's current date. Periods outside that sample remain empty.
- Top N returns only products actually sold in the selected period. With two products, Top 10 has two rows. Totals cover all matched orders in the period, not just the displayed Top N. Product order counts can overlap because one order can contain multiple products.

## Execution

`POST /api/stats/query` accepts `{message, source: "orders" | "demo", previousPlan?}`. The application:

1. Validates 1–1,000 characters, source, optional previous plan, Top 1–50 and periods of 1–366 days.
2. Extracts explicit Thai/English keywords, Thai/Arabic numerals and date/limit arguments. It preserves Thai characters with NFC. Rolling periods include today; weeks are seven days, numeric months are 30 days, `เดือนนี้` starts at the calendar month's first day, and `สัปดาห์นี้/ที่แล้ว` use Monday-based calendar weeks. Explicit dates use `YYYY-MM-DD`; future ranges are rejected.
3. Sends the request and compact normalized intent to **real Laya**, with three typed choices: `tool`, `metric`, `chart`. No order, shopper or session data is sent to the model. The existing Laya adapter now handles several choice questions in one request while preserving basket/evidence-tool contracts.
4. Validates all model choices/probability distributions and rejects disagreement with explicitly recognized user instructions. There is no mock planner fallback. Unrelated/unsupported requests, malformed responses, model errors and transport timeouts return an error.
5. Executes only allowlisted `query_daily_sales` or `query_top_products`, with revenue or quantity. Aggregation runs in backend code, uses Bangkok calendar dates, fills missing daily buckets with zero, and sums monetary values in integer cents. The model cannot provide SQL, code, file paths or database writes.
6. Persists `STAT_QUERY_COMPLETED` with query ID, plan, source, model and matched order count using the existing repository/audit log. It changes no orders, cart, cases or sessions. The answer returns typed data; React renders the requested visualization rather than executing generated chart code.

This is a bounded statistics query interface, not unrestricted SQL or a general chat assistant. Monthly/yearly/hourly grouping, profit/forecasting, arbitrary filtering, chart types beyond bar/line/table, persistent chat history and exports are outside this implementation. Source selection and fixed request validation are application controls, not model-generated reasoning.

## Run and checks

```powershell
npm run model:laya
# Another terminal: npm start
# Another terminal, web/: npm run dev:mock
```

`npm test` covers exact aggregation, date boundaries, zero-filled/empty results, metric-dependent ranking, full history, read-only behavior, audit persistence, invalid/model-conflicting responses and rejected parameters. `npm --prefix web run test:stats` uses actual local Laya, Chromium, an isolated production API and DB, and UI routing only to connect that browser to the isolated API. It checks daily bars, revenue ranking, unit ranking/table, line-chart follow-ups, explicit sources, failure/empty states and responsive widths. Start the existing development frontend before this command; reports/images are saved under ignored `data/stats-web-*`.

Cloud deployment and API authorization retain the prototype's existing boundaries. The local Admin login is a frontend development simulation, not server authorization. The DynamoDB adapter still uses an aggregate item with the same size limit as the rest of the prototype.

## Observed verification, 22 October 2026

- `npm test`: 49/49 passed, including six statistics checks. Web typecheck, lint and production build passed.
- All four existing Auth/Shopper/Admin/native-SSE browser suites passed with the new Chatbox present.
- Actual Laya + Chromium report: `data/stats-web-1792662882225/report.json`, with desktop/mobile images in the same directory. All five queries used real `laya-rl-agent` responses, with roughly 6.7–7.4 seconds of model time per query in this sample. No model response was injected.
- Fifteen actual isolated mock checkouts aggregated to ฿480 / 22 units / 15 orders, beyond the dashboard's ten-order snapshot. An unpaid ฿25 cart stayed out of those totals and remained unchanged. Revenue ranking put Coke first; quantity ranking put Water first; a follow-up preserved period/metric/ranking and changed table to line. Explicit demo labels, empty range, double submit, query-error recovery, 320/390/768/1440px overflow and five query-audit entries passed.
- Direct raw Thai prompts initially mis-selected some query fields. Compact normalized intent and preserving Thai text with NFC corrected the supported examples. Sending a separate stale previous-query object could also bias the model; only the resolved current intent is now sent. Explicit keyword disagreement is still rejected, so this is not a claim of general natural-language accuracy.
- The browser harness initially needed fixes for Node `fetch().ok` versus Playwright `response.ok()`, and for awaiting the actual query response instead of racing the prior idle UI. These failures were corrected before the passing run above.
