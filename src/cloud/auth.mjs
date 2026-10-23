import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { createStore, snapshot } from "../domain.mjs";

export function httpError(status, message) { return Object.assign(new Error(message), { status }); }
export const basketId = value => { if (!["A", "B"].includes(value)) throw httpError(400, "basketId must be A or B"); return value; };
const mac = (key, value) => createHmac("sha256", key).update(value).digest("base64url");
function equal(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export const pairingCode = (key, basket) => mac(key, "basket-pairing:" + basketId(basket));
export function verifyPairing(key, basket, code) {
  if (!equal(code, pairingCode(key, basket))) throw httpError(403, "Scan the basket QR with its pairing code");
}
export function signShopper(key, { basket, sessionId }, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ typ: "shopper", basketId: basketId(basket), sessionId, nonce: randomUUID(), exp: Math.floor(now / 1000) + 3600 })).toString("base64url");
  return payload + "." + mac(key, "shopper:" + payload);
}
export function verifyShopper(key, token, now = Date.now()) {
  if (typeof token !== "string" || token.length > 2000) throw httpError(401, "Invalid basket session");
  const [payload, signature, extra] = token.split(".");
  if (extra || !equal(signature, mac(key, "shopper:" + payload))) throw httpError(401, "Invalid basket session");
  let claims;
  try { claims = JSON.parse(Buffer.from(payload, "base64url")); } catch { throw httpError(401, "Invalid basket session"); }
  if (claims.typ !== "shopper" || !["A", "B"].includes(claims.basketId) || !/^SES-[A-Z0-9]+$/.test(claims.sessionId) || !Number.isSafeInteger(claims.exp) || claims.exp <= now / 1000) throw httpError(401, "Basket session expired or invalid");
  return { role: "SHOPPER", ...claims };
}

export async function authenticate(headers, { key, verifyJwt }) {
  const authorization = headers.authorization || headers.Authorization || "";
  if (!authorization) return { role: "PUBLIC" };
  if (authorization.startsWith("Basket ")) return verifyShopper(key, authorization.slice(7));
  if (!authorization.startsWith("Bearer ")) throw httpError(401, "Invalid authorization");
  let claims;
  try { claims = await verifyJwt(authorization.slice(7)); } catch { throw httpError(401, "Staff session expired or invalid"); }
  if (!claims["cognito:groups"]?.includes("STAFF")) throw httpError(403, "Staff access required");
  return { role: "STAFF", sub: claims.sub, email: claims.username || claims.sub, exp: claims.exp };
}
export function requireStaff(principal) { if (principal.role !== "STAFF") throw httpError(403, "Staff access required"); }
export function requireOwner(principal, store, basket, { active = true } = {}) {
  basketId(basket);
  if (principal.role === "STAFF") return;
  const session = store.sessions.find(item => item.sessionId === principal.sessionId && item.basketId === basket);
  if (principal.role !== "SHOPPER" || principal.basketId !== basket || !session ||
      (active && store.activeSessions[basket] !== principal.sessionId) ||
      (store.activeSessions[basket] && store.activeSessions[basket] !== principal.sessionId)) throw httpError(403, "This basket belongs to another session");
}

export function scopedState(store, principal) {
  const pendingFirst = cases => [...cases.filter(item => item.status !== "CLOSED"), ...cases.filter(item => item.status === "CLOSED")].slice(0, 30);
  if (principal.role === "STAFF") return { ...snapshot(store), cases: pendingFirst(store.cases) };
  const empty = snapshot(createStore());
  empty.shelf.lastSeenAt = null; empty.shelf.fsmState = "IDLE";
  empty.baskets = empty.baskets.map(basket => ({ ...basket, payable: false }));
  if (principal.role !== "SHOPPER") return empty;
  requireOwner(principal, store, principal.basketId, { active: false });
  const state = snapshot(store), id = principal.basketId;
  const session = store.sessions.find(item => item.sessionId === principal.sessionId);
  return { ...empty,
    baskets: state.baskets.map(basket => basket.basketId === id ? basket : empty.baskets.find(item => item.basketId === basket.basketId)),
    cases: pendingFirst(store.cases.filter(item => !item.candidate || item.candidate === id)).map(item => ({ ...item, evidence: { zone: item.evidence.zone }, toolCalls: [], timeline: [], agent: undefined })),
    recentOrders: store.orders.filter(order => order.basketId === id && order.createdAt >= session.startedAt && (!session.closedAt || order.createdAt <= session.closedAt)).slice(0, 10),
  };
}
