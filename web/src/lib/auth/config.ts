// Public development switch, never an AWS credential or a production auth bypass.
export const mockAuthEnabled =
  process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_ENABLE_MOCK_AUTH === "true";

export const mockAccount = { email: "admin@basketly.test", password: "BasketlyDemo123!" };
export const mockSessionKey = "basketly.mock-admin-session.v1";
export const mockSessionDuration = 30 * 60 * 1000;
