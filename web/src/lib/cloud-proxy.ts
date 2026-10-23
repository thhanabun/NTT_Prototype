import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const cookieOptions = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };
function config() {
  const api = process.env.CLOUD_API_ORIGIN, issuer = process.env.COGNITO_DOMAIN, clientId = process.env.COGNITO_CLIENT_ID, origin = process.env.WEB_ORIGIN;
  if (!api?.startsWith("https://") || !issuer?.startsWith("https://") || !clientId || !origin || (!origin.startsWith("https://") && !/^http:\/\/localhost:\d+$/.test(origin))) throw new Error("Cloud web configuration is incomplete");
  return { api, issuer, clientId, origin, callback: origin + "/api/auth/callback" };
}
function same(a: string, b: string) { return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b)); }

export async function cloudProxy(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_CLOUD_MODE !== "true") return NextResponse.json({ error: "Cloud API is disabled" }, { status: 404 });
  try {
    const cfg = config(), path = request.nextUrl.pathname;
    if (request.method !== "GET" && request.headers.get("origin") !== cfg.origin) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    if (path === "/api/config" && request.method === "GET") return NextResponse.json({ websocketUrl: process.env.CLOUD_WEBSOCKET_URL }, { headers: { "cache-control": "no-store" } });
    if (path === "/api/auth/login" && request.method === "GET") {
      const state = randomBytes(24).toString("base64url"), verifier = randomBytes(32).toString("base64url");
      const url = new URL(cfg.issuer + "/oauth2/authorize");
      url.search = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: cfg.callback, response_type: "code", scope: "openid email", state, code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") }).toString();
      const response = NextResponse.redirect(url);
      response.cookies.set("basketly-oauth", JSON.stringify({ state, verifier }), { ...cookieOptions, maxAge: 300 });
      return response;
    }
    if (path === "/api/auth/callback" && request.method === "GET") {
      const stored = JSON.parse(request.cookies.get("basketly-oauth")?.value || "null");
      const state = request.nextUrl.searchParams.get("state"), code = request.nextUrl.searchParams.get("code");
      if (!stored || !state || !code || !same(stored.state, state)) return NextResponse.json({ error: "Login state expired or invalid" }, { status: 400 });
      const result = await fetch(cfg.issuer + "/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: cfg.clientId, code, redirect_uri: cfg.callback, code_verifier: stored.verifier }), cache: "no-store", signal: AbortSignal.timeout(10000) });
      const tokens = await result.json();
      if (!result.ok || typeof tokens.access_token !== "string" || !Number.isFinite(tokens.expires_in)) throw new Error("Cognito token exchange failed");
      const identity = await fetch(cfg.api + "/api/auth/me", { headers: { authorization: "Bearer " + tokens.access_token }, cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!identity.ok) return NextResponse.json({ error: "This account is not authorized as staff" }, { status: 403 });
      const response = NextResponse.redirect(cfg.origin + "/admin");
      response.cookies.set("basketly-staff", tokens.access_token, { ...cookieOptions, maxAge: Math.min(tokens.expires_in, 3600) });
      response.cookies.delete("basketly-oauth");
      return response;
    }
    if (path === "/api/auth/logout" && request.method === "POST") {
      const logout = new URL(cfg.issuer + "/logout");
      logout.search = new URLSearchParams({ client_id: cfg.clientId, logout_uri: cfg.origin + "/admin/login" }).toString();
      const response = NextResponse.json({ ok: true, logoutUrl: logout.href });
      response.cookies.delete("basketly-staff");
      return response;
    }
    const target = path === "/api/auth/session" ? "/api/auth/me" : path;
    if (path === "/api/stream") return NextResponse.json({ error: "Cloud uses WebSocket realtime" }, { status: 404 });
    if (!/^\/api\/(state|audit|sessions|checkout|realtime-ticket|stats\/query|auth\/session|cases\/CASE-\d+\/(customer|staff))$/.test(path)) return NextResponse.json({ error: "Route unavailable" }, { status: 404 });
    const basket = request.headers.get("x-basket-id") || "A";
    if (!["A", "B"].includes(basket)) return NextResponse.json({ error: "Invalid basket" }, { status: 400 });
    const token = request.cookies.get("basketly-staff")?.value;
    const shopper = request.cookies.get("basketly-shopper-" + basket)?.value;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers.authorization = "Bearer " + token;
    else if (shopper) headers.authorization = "Basket " + shopper;
    const body = request.method === "GET" ? undefined : await request.text();
    if (body && Buffer.byteLength(body) > 64000) return NextResponse.json({ error: "Request too large" }, { status: 413 });
    const upstream = await fetch(cfg.api + target + request.nextUrl.search, { method: request.method, headers, body, cache: "no-store", signal: AbortSignal.timeout(29000) });
    const value = await upstream.json();
    const shopperToken = value.shopperToken;
    delete value.shopperToken;
    const response = NextResponse.json(value, { status: upstream.status, headers: { "cache-control": "no-store" } });
    if (upstream.ok && path === "/api/sessions" && shopperToken) response.cookies.set("basketly-shopper-" + value.session.basketId, shopperToken, { ...cookieOptions, maxAge: 3600 });
    if (upstream.status === 401) response.cookies.delete(token ? "basketly-staff" : "basketly-shopper-" + basket);
    return response;
  } catch {
    return NextResponse.json({ error: "Cloud service unavailable; refresh state before retrying" }, { status: 503 });
  }
}
