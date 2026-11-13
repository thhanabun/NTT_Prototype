import { randomBytes } from "node:crypto";
import { signShopper, verifyShopper } from "../cloud/auth.mjs";

export function createLocalShopperSession({ key = randomBytes(32).toString("hex") } = {}) {
  return {
    cookie(session) {
      const token = signShopper(key, { basket: session.basketId, sessionId: session.sessionId });
      return `fast-shopper-chat-${session.basketId}=${token}; Path=/api/shopper; HttpOnly; SameSite=Lax; Max-Age=3600`;
    },
    principal(request, basketId) {
      if (!["A", "B"].includes(basketId)) throw Object.assign(new Error("Invalid basket"), { status: 400 });
      // Local-only capability cookie. It scopes this new endpoint, not the legacy local API.
      const token = (request.headers.cookie || "").split(";").map(part => part.trim()).find(part => part.startsWith(`fast-shopper-chat-${basketId}=`))?.split("=")[1];
      return token ? verifyShopper(key, token) : { role: "PUBLIC" };
    },
  };
}
