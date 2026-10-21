import { BASKET_DECISION_QUESTION, basketDecisionState } from "./decision-contract.mjs";

export async function requestLayaBasketDecision({
  context,
  endpoint = process.env.LAYA_ENDPOINT || "http://127.0.0.1:8000/v1/systemone",
  apiKey = process.env.LAYA_API_KEY,
  model = process.env.LAYA_MODEL || "typed-decisions",
  fetchImpl = fetch,
}) {
  const started = performance.now();
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: "Bearer " + apiKey } : {}),
    },
    body: JSON.stringify({
      model,
      state: basketDecisionState(context),
      questions: { basket: BASKET_DECISION_QUESTION },
      max_len: 1024,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("Laya API returned HTTP " + response.status);

  const payload = await response.json();
  const answer = payload?.answers?.basket;
  const probabilities = answer?.probabilities;
  if (answer?.type !== "choice" || !["A", "B", "NONE"].includes(answer.choice) ||
      !probabilities || !["A", "B", "NONE"].every((key) =>
        Number.isFinite(probabilities[key]) && probabilities[key] >= 0 && probabilities[key] <= 1) ||
      Math.abs(probabilities.A + probabilities.B + probabilities.NONE - 1) > 0.01) {
    throw new Error("Laya API returned an invalid basket probability distribution");
  }

  // Laya confidence is normalized entropy; policy uses the selected option probability.
  return {
    candidate: answer.choice === "NONE" ? null : answer.choice,
    confidence: probabilities[answer.choice],
    confidenceSource: "selected_option_probability",
    probabilities: { A: probabilities.A, B: probabilities.B, NONE: probabilities.NONE },
    model: payload.model || model,
    requestDurationMs: Math.round(performance.now() - started),
    ...(payload.routing ? { routing: payload.routing } : {}),
    ...(payload.usage ? { usage: payload.usage } : {}),
  };
}
