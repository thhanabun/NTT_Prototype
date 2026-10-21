const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export async function requestJevBasketDecision({
  context,
  apiKey = process.env.TYPESAFE_API_KEY,
  model = process.env.TYPESAFE_MODEL || "jev-latest",
  endpoint = ENDPOINT,
  fetchImpl = fetch,
}) {
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is required when AGENT_PROVIDER=jev");

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      state: context,
      questions: {
        basket: {
          type: "choice",
          instructions: "Select the basket supported by the shelf event and proximity evidence. RSSI indicates proximity only, not who picked the product. Prefer NONE when evidence is tied, delayed, missing, conflicting, or insufficient. Cart history may only support the event evidence; it must not override contradictory RSSI.",
          criteria: {
            A: "Basket A is the likely basket and is consistent with the event's RSSI evidence.",
            B: "Basket B is the likely basket and is consistent with the event's RSSI evidence.",
            NONE: "The evidence is insufficient, stale, missing, or conflicting; a person must review it.",
          },
        },
      },
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Jev API returned HTTP ${response.status}`);

  const payload = await response.json();
  const answer = payload?.answers?.basket;
  if (answer?.type !== "choice" || !["A", "B", "NONE"].includes(answer.choice) ||
    !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) {
    throw new Error("Jev API returned an invalid basket decision");
  }

  return {
    candidate: answer.choice === "NONE" ? null : answer.choice,
    confidence: answer.confidence,
    model: payload.model || model,
    ...(payload.usage ? { usage: payload.usage } : {}),
  };
}
