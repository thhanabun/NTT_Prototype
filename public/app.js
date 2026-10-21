const byId = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));
let state = null;
let selectedBasket = new URLSearchParams(location.search).get("basket") === "B" ? "B" :
  (localStorage.getItem("basketly-basket") || "A");
let toastTimer;
let cameraStream = null;
let scannerTimer = null;
let lastSimulationPayload = null;

function money(value) {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(value || 0);
}

function timeAgo(value) {
  if (!value) return "Waiting for first event";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return seconds + " sec ago";
  if (seconds < 3600) return Math.floor(seconds / 60) + " min ago";
  return new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function toast(message) {
  const node = byId("toast");
  node.textContent = message;
  node.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("visible"), 2800);
}

async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function setView(name) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("hidden", view.id !== "view-" + name));
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
  byId("page-label").textContent = name === "staff" ? "Staff dashboard" : "Shopper app";
}

function selectBasket(basketId, bind = false) {
  selectedBasket = basketId;
  localStorage.setItem("basketly-basket", basketId);
  document.querySelectorAll(".basket-choice-button").forEach((button) => {
    button.classList.toggle("selected", button.dataset.basket === basketId);
  });
  byId("shop-basket-chip").textContent = basketId;
  const query = new URLSearchParams(location.search);
  query.set("basket", basketId);
  history.replaceState({}, "", location.pathname + "?" + query.toString());
  if (bind) startSession();
  else renderShopper();
}

async function startSession() {
  try {
    await api("/api/sessions", { basketId: selectedBasket });
    toast("Basket " + selectedBasket + " is ready. Happy shopping!");
    await refreshState();
  } catch (error) {
    toast(error.message);
  }
}

function renderShopper() {
  if (!state) return;
  const basket = state.baskets.find((item) => item.basketId === selectedBasket);
  const session = basket.session;
  const sessionNode = byId("shop-session-state");
  sessionNode.classList.toggle("active", Boolean(session));
  sessionNode.innerHTML = session
    ? "<i></i> Basket in use"
    : "<i></i> Session not started";
  byId("start-session").innerHTML = session
    ? "<span>Continue shopping <b>→</b></span>"
    : "<span>Start shopping <b>→</b></span>";
  byId("shop-cart-lines").innerHTML = basket.lines.length
    ? basket.lines.map((line) => {
      const color = line.sku === "COKE" ? "#d84f3f" : "#4e91ad";
      return '<div class="cart-line"><i class="line-dot" style="background:' + color + '"></i>' +
        '<div class="cart-line-info"><strong>' + esc(line.name) + '</strong><small>' + money(line.price) + ' each</small></div>' +
        '<span class="cart-quantity">× ' + line.quantity + '</span><span class="cart-line-price">' + money(line.subtotal) + '</span></div>';
    }).join("")
    : '<div class="empty-cart"><span class="empty-basket">⌑</span><strong>Your cart is ready</strong><span>Pick something from the shelf to see it here.</span></div>';
  byId("shop-subtotal").textContent = money(basket.total);
  byId("shop-total").textContent = money(basket.total);

  const waiting = state.cases.filter((item) => item.status === "WAITING_CUSTOMER" && item.candidate === selectedBasket);
  const prompt = byId("customer-confirmation");
  if (waiting.length) {
    const item = waiting[0];
    const product = state.products.find((productItem) => productItem.sku === item.sku);
    prompt.classList.remove("hidden");
    prompt.innerHTML = '<div class="confirm-heading">Quick check: did you pick up ' + esc(product.name) + '?</div>' +
      '<div class="confirm-copy">We think it belongs to Basket ' + esc(item.candidate) + '. Confirm to add it to your cart.</div>' +
      '<div class="confirm-actions"><button class="button confirm-yes" data-customer="YES" data-case="' + esc(item.caseId) + '">Yes, add it</button>' +
      '<button class="button confirm-no" data-customer="NO" data-case="' + esc(item.caseId) + '">No, ask staff</button></div>';
  } else if (state.cases.some((item) =>
    item.status === "OPEN_STAFF" && (!item.candidate || item.candidate === selectedBasket))) {
    prompt.classList.remove("hidden");
    prompt.innerHTML = '<div class="confirm-heading">A shelf event needs a quick review.</div>' +
      '<div class="confirm-copy">The item is being checked by the store team. It is not included in your payable total yet.</div>';
  } else {
    prompt.classList.add("hidden");
    prompt.innerHTML = "";
  }
  const canCheckout = Boolean(session && basket.lines.length && basket.payable);
  byId("checkout-button").disabled = !canCheckout;

  const order = !session && state.recentOrders.find((item) => item.basketId === selectedBasket);
  const receipt = byId("order-receipt");
  if (order) {
    receipt.classList.remove("hidden");
    receipt.innerHTML = "<strong>Mock checkout complete · " + esc(order.orderId) + "</strong>" +
      esc(order.lines.length) + " confirmed line(s) · " + money(order.total) + " · no payment processed";
  } else receipt.classList.add("hidden");
}

function rssiWidth(value) {
  if (!Number.isFinite(value)) return "0%";
  return Math.max(4, Math.min(100, (value + 100) * 1.45)) + "%";
}

function renderMonitor() {
  const shelf = state.shelf;
  byId("shelf-status").textContent = shelf.status === "ONLINE" ? "Online" : "Offline";
  byId("shelf-last-seen").textContent = "Last signal " + timeAgo(shelf.lastSeenAt);
  const event = state.recentEvents[0];
  const product = event && state.products.find((item) => item.sku === event.sku);
  byId("last-event").textContent = event ? event.eventType + " · " + product.name : "Waiting for a pick";
  byId("last-event-time").textContent = event ? timeAgo(event.receivedAt) + " · " + event.eventId : "No events received";
  byId("fsm-state").textContent = shelf.fsmState;
  byId("current-date").textContent = new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
  }).format(new Date());
  const openCount = state.cases.filter((item) => ["WAITING_CUSTOMER", "OPEN_STAFF"].includes(item.status)).length;
  byId("open-case-count").textContent = String(openCount);

  const rssi = shelf.rssi || {};
  const hasReading = Number.isFinite(rssi.A) || Number.isFinite(rssi.B);
  byId("rssi-chart").innerHTML = hasReading
    ? ["A", "B"].map((basketId) => {
      const value = rssi[basketId];
      return '<div class="signal-column"><span class="signal-label">' + basketId + '</span>' +
        '<div class="signal-track"><div class="signal-fill ' + basketId.toLowerCase() + '" style="width:' + rssiWidth(value) + '"></div></div>' +
        '<span class="signal-value">' + (Number.isFinite(value) ? value + " dBm" : "—") + '</span></div>';
    }).join("")
    : '<div class="signal-empty">Waiting for BLE evidence from the shelf</div>';

  byId("staff-baskets").innerHTML = state.baskets.map((basket) => {
    const itemCount = basket.lines.reduce((sum, line) => sum + line.quantity, 0);
    const basketState = !basket.session ? "SESSION REQUIRED"
      : basket.unresolvedCaseCount ? basket.unresolvedCaseCount + " PENDING"
      : basket.payable ? "PAYABLE" : "REVIEW";
    return '<div class="staff-basket"><div class="staff-basket-head"><span class="basket-avatar">' + basket.basketId + '</span>' +
      '<strong>Basket ' + basket.basketId + '</strong><span class="session-label">' + (basket.session ? "IN SESSION" : "IDLE") + '</span></div>' +
      '<div class="staff-basket-total">' + money(basket.total) + '</div><div class="staff-basket-meta"><span>' + itemCount + ' confirmed item(s)</span>' +
      '<span>' + basketState + '</span></div></div>';
  }).join("");
}

function renderCase(item) {
  const product = state.products.find((productItem) => productItem.sku === item.sku);
  const isCustomer = item.status === "WAITING_CUSTOMER";
  const isStaff = item.status === "OPEN_STAFF";
  const closed = !isCustomer && !isStaff;
  const rssi = item.evidence.rssi || {};
  const evidenceText = "RSSI A <strong>" + (Number.isFinite(rssi.A) ? rssi.A + " dBm" : "—") +
    "</strong> · B <strong>" + (Number.isFinite(rssi.B) ? rssi.B + " dBm" : "—") + "</strong>" +
    (Number.isFinite(item.evidence.marginDb) ? "<br>Signal margin <strong>" + item.evidence.marginDb + " dB</strong>" : "<br>Zone <strong>unknown</strong>");
  const calls = item.toolCalls || [];
  const toolChips = calls.length
    ? '<div class="case-tools">' + calls.map((tool) => '<span class="tool-chip' + (tool.status === "OK" ? "" : " tool-error") + '" title="' + esc(tool.summary || tool.status) + '">' +
      (tool.status === "OK" ? "✓ " : "× ") + esc(tool.name) + '</span>').join("") + "</div>"
    : '<div class="case-tools"><span class="tool-chip">Deterministic policy</span></div>';
  let actions = "";
  if (isStaff) {
    actions = '<div class="case-actions"><button class="button button-primary" data-staff="APPROVE" data-case="' + esc(item.caseId) + '" data-basket="' + esc(item.candidate || "") + '">Approve ' + (item.candidate ? "Basket " + item.candidate : "to basket…") + '</button>' +
      '<button class="button button-danger" data-staff="REJECT" data-case="' + esc(item.caseId) + '">Reject item</button></div>';
  } else if (isCustomer) {
    actions = '<div class="case-actions"><span class="case-status">◷ CUSTOMER CONFIRM</span><button class="button button-light" data-open-shopper="' + esc(item.candidate) + '">Open shopper view</button></div>';
  } else {
    actions = '<div class="case-actions"><span class="case-status closed-status">✓ CLOSED</span></div>';
  }
  const statusClass = isStaff ? " staff-status" : closed ? " closed-status" : "";
  const statusText = isStaff ? "STAFF REVIEW" : isCustomer ? "WAITING CUSTOMER" : "CLOSED";
  const resolution = item.resolution ? " · " + item.resolution.actor + " " + item.resolution.decision +
    (item.resolution.basketId ? " · Basket " + item.resolution.basketId : "") : "";
  const agentBadge = item.agent
    ? '<span class="agent-badge">' + esc(item.agent.provider) + ' AGENT · ' + esc(item.agent.status) + '</span>'
    : "";
  const timeline = item.timeline.map((entry) =>
    '<div class="timeline-entry"><span>' + timeAgo(entry.at) + '</span><strong>' + esc(entry.action.replaceAll("_", " ")) +
    '</strong>' + (entry.tool ? '<small>· ' + esc(entry.tool) + '</small>' : "") +
    (entry.nextAction ? '<small>→ ' + esc(entry.nextAction) + '</small>' : "") + '</div>',
  ).join("");
  return '<article class="case-item"><div class="case-main"><div class="case-ident"><span class="case-icon' + (isStaff ? " staff" : "") + '">' +
    (isStaff ? "!" : "✳") + '</span><div><strong>' + esc(item.type.replaceAll("_", " ")) + '</strong><small>' + esc(product.name) + ' · ' + item.eventType + '</small>' +
    '<div class="case-id">' + esc(item.caseId) + ' · ' + timeAgo(item.createdAt) + '</div></div></div>' +
    '<div class="case-evidence">' + evidenceText + '</div><div class="case-confidence"><div class="confidence-label"><span>Agent confidence</span><strong>' +
    Math.round(item.confidence * 100) + '%</strong></div><div class="confidence-bar"><i style="width:' + Math.round(item.confidence * 100) + '%"></i></div>' + toolChips +
    '</div>' + actions + '</div><div class="case-details"><span class="case-status' + statusClass + '">' + statusText +
    '</span><span>Suggestion <strong>' + esc(item.candidate ? "Basket " + item.candidate : "No basket") + " · " + esc(item.proposedAction) +
    '</strong></span><span>Next <strong>' + esc(item.nextAction) + '</strong></span>' + agentBadge + '<span>' + esc(item.reason) + esc(resolution) + '</span>' +
    '<details class="case-timeline"><summary>Case timeline · ' + item.timeline.length + '</summary><div class="timeline-list">' + timeline + '</div></details></div></article>';
}

function renderCases() {
  const list = state.cases;
  const openCases = list.filter((item) => ["WAITING_CUSTOMER", "OPEN_STAFF"].includes(item.status));
  byId("case-filter-label").textContent = openCases.length ? openCases.length + " open · " + list.length + " total" : "No cases open";
  byId("case-list").innerHTML = list.length
    ? list.map(renderCase).join("")
    : '<div class="no-cases">All clear. Ambiguous events and staff decisions will appear here.</div>';
}

function renderEvents() {
  const entries = (state.auditLog || []).slice(0, 8);
  byId("event-list").innerHTML = entries.length
    ? entries.map((entry) => {
      const details = entry.details || {};
      const summary = [
        details.eventType && details.sku ? details.eventType + " · " + details.sku : "",
        details.basketId ? "Basket " + details.basketId : "",
        details.tool ? details.tool + (details.summary ? " · " + details.summary : "") : "",
        details.confidence !== undefined ? "Confidence " + Math.round(details.confidence * 100) + "%" : "",
        details.caseId || details.eventId || details.orderId || "",
        details.decision || "",
      ].filter(Boolean).join(" · ") || entry.actor;
      return '<div class="event-row"><span class="event-sign audit-sign">' +
        (entry.action.includes("FAILED") ? "!" : entry.action.includes("AGENT") ? "✳" : "◉") +
        '</span><div class="event-copy"><strong>' + esc(entry.action.replaceAll("_", " ")) +
        '</strong><small>' + esc(summary) + '</small></div><span class="event-time">' + timeAgo(entry.at) + '</span></div>';
    }).join("")
    : '<div class="no-cases">No audit events yet. Start a session or send a shelf event.</div>';
}

function render() {
  if (!state) return;
  renderShopper();
  renderMonitor();
  renderCases();
  renderEvents();
}

async function refreshState() {
  state = await api("/api/state");
  render();
}

function newEventId() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : "evt-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function makeSimulation(kind) {
  const laneId = document.querySelector(".lane-select")?.value || "LANE-1";
  const productType = laneId === "LANE-2" ? "WATER" : "COKE";
  const payload = {
    eventId: newEventId(),
    shelfId: "SHELF-01",
    laneId,
    sku: productType,
    eventType: kind === "put-back" ? "PUT_BACK" : "PICK",
    timestamp: new Date().toISOString(),
  };
  if (kind === "ambiguous") payload.rssi = { A: -55, B: -57 };
  else if (kind === "low-confidence") payload.rssi = { A: -56, B: -56 };
  else if (kind === "unknown") payload.rssi = { A: null, B: null };
  else if (kind === "clear-b") payload.rssi = { A: -73, B: -51 };
  else payload.rssi = { A: -51, B: -72 };
  return payload;
}

async function simulate(kind) {
  try {
    const payload = kind === "duplicate" && lastSimulationPayload ? lastSimulationPayload : makeSimulation(kind);
    lastSimulationPayload = payload;
    const first = await api("/api/events", payload);
    if (kind === "duplicate") {
      const second = await api("/api/events", payload);
      toast(second.duplicate ? "Duplicate ignored. Cart was not changed." : "Duplicate event was processed.");
    } else {
      toast(first.disposition === "CONFIRMED"
        ? payload.eventType + " confirmed for Basket " + first.basketId
        : first.caseId + " created · " + payload.eventType.toLowerCase().replace("_", " ") + " pending");
    }
    await refreshState();
  } catch (error) {
    toast(error.message);
  }
}

async function answerCustomer(caseId, answer) {
  try {
    await api("/api/cases/" + encodeURIComponent(caseId) + "/customer", { answer });
    toast(answer === "YES" ? "Thanks. Item confirmed in your basket." : "Thanks. Staff will review this item.");
    await refreshState();
  } catch (error) { toast(error.message); }
}

async function answerStaff(caseId, decision, basketId) {
  let selected = basketId;
  if (decision === "APPROVE" && !selected) {
    selected = window.prompt("Approve this item to which basket? Enter A or B.", selectedBasket);
    if (!selected) return;
    selected = selected.trim().toUpperCase();
  }
  try {
    await api("/api/cases/" + encodeURIComponent(caseId) + "/staff", { decision, basketId: selected });
    toast(decision === "APPROVE" ? "Case approved. Cart was validated." : "Item rejected and case closed.");
    await refreshState();
  } catch (error) { toast(error.message); }
}

async function checkout() {
  try {
    const result = await api("/api/checkout", { basketId: selectedBasket });
    toast("Mock checkout complete · " + result.order.orderId);
    await refreshState();
  } catch (error) { toast(error.message); }
}

async function openScanner() {
  byId("scanner-modal").classList.remove("hidden");
  byId("scanner-error").textContent = "";
  if (!("BarcodeDetector" in window)) {
    byId("scanner-error").textContent = "This browser has no built-in QR scanner. Select Basket A or B below.";
    return;
  }
  try {
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const video = byId("scanner-video");
    video.srcObject = cameraStream;
    const scan = async () => {
      if (!cameraStream) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length) {
          const basketId = parseBasketQr(codes[0].rawValue);
          if (basketId) {
            closeScanner();
            selectBasket(basketId, true);
            return;
          }
          byId("scanner-error").textContent = "QR must contain ?basket=A or ?basket=B.";
        }
      } catch {}
      scannerTimer = requestAnimationFrame(scan);
    };
    scannerTimer = requestAnimationFrame(scan);
  } catch (error) {
    byId("scanner-error").textContent = "Camera could not start. Choose a basket below.";
  }
}

function parseBasketQr(value) {
  try {
    const url = new URL(value, location.origin);
    const basket = url.searchParams.get("basket");
    if (basket === "A" || basket === "B") return basket;
  } catch {}
  const match = String(value).trim().match(/(?:basket[:=/ -]*)?([AB])$/i);
  return match ? match[1].toUpperCase() : null;
}

function closeScanner() {
  byId("scanner-modal").classList.add("hidden");
  if (scannerTimer) cancelAnimationFrame(scannerTimer);
  scannerTimer = null;
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  byId("scanner-video").srcObject = null;
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});
document.querySelectorAll(".basket-choice-button").forEach((button) => {
  button.addEventListener("click", () => selectBasket(button.dataset.basket));
});
document.querySelectorAll(".sim-button").forEach((button) => {
  button.addEventListener("click", () => simulate(button.dataset.sim));
});
document.querySelectorAll(".text-button[data-basket]").forEach((button) => {
  button.addEventListener("click", () => {
    const basketId = button.dataset.basket;
    closeScanner();
    selectBasket(basketId, true);
  });
});
byId("start-session").addEventListener("click", startSession);
byId("scan-button").addEventListener("click", openScanner);
byId("close-scanner").addEventListener("click", closeScanner);
byId("checkout-button").addEventListener("click", checkout);
byId("refresh-button").addEventListener("click", () => refreshState().then(() => toast("Dashboard is up to date.")));
byId("reset-button").addEventListener("click", async () => {
  if (!window.confirm("Reset all local demo sessions, carts, cases and events?")) return;
  await api("/api/reset", {});
  await refreshState();
  toast("Demo data reset.");
});
byId("clear-filter").addEventListener("click", () => {
  document.querySelectorAll(".case-item").forEach((node) => { node.style.display = ""; });
});
document.addEventListener("click", (event) => {
  const customer = event.target.closest("[data-customer]");
  if (customer) answerCustomer(customer.dataset.case, customer.dataset.customer);
  const staff = event.target.closest("[data-staff]");
  if (staff) answerStaff(staff.dataset.case, staff.dataset.staff, staff.dataset.basket);
  const openShopper = event.target.closest("[data-open-shopper]");
  if (openShopper) {
    selectBasket(openShopper.dataset.openShopper);
    setView("shopper");
  }
});
byId("scanner-modal").addEventListener("click", (event) => {
  if (event.target === byId("scanner-modal")) closeScanner();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeScanner();
});

refreshState().then(() => {
  const basketFromUrl = new URLSearchParams(location.search).get("basket");
  if (basketFromUrl === "A" || basketFromUrl === "B") {
    selectedBasket = basketFromUrl;
    selectBasket(basketFromUrl);
    const basket = state.baskets.find((item) => item.basketId === basketFromUrl);
    if (!basket.session) startSession();
  }
}).catch((error) => toast(error.message));

if ("EventSource" in window) {
  const stream = new EventSource("/api/stream");
  stream.addEventListener("state", (event) => {
    try {
      state = JSON.parse(event.data);
      render();
    } catch {}
  });
  stream.onerror = () => document.querySelector(".live-chip").classList.add("disconnected");
  stream.onopen = () => document.querySelector(".live-chip").classList.remove("disconnected");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
