import { BASKET_DECISION_QUESTION, basketDecisionState } from "./decision-contract.mjs";

export async function requestLayaChoices({
  state, questions, label = "choice", signal,
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
      state,
      questions,
      max_len: 1024,
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("Laya API returned HTTP " + response.status);

  const payload = await response.json();
  const selections = {};
  for (const [answerKey, question] of Object.entries(questions)) {
    const answer = payload?.answers?.[answerKey];
    const probabilities = answer?.probabilities;
    const choices = Object.keys(question.criteria);
    if (answer?.type !== "choice" || !choices.includes(answer.choice) ||
      !probabilities || !choices.every((key) =>
        Number.isFinite(probabilities[key]) && probabilities[key] >= 0 && probabilities[key] <= 1) ||
      Math.abs(choices.reduce((sum, key) => sum + probabilities[key], 0) - 1) > 0.01) {
      throw new Error(`Laya API returned an invalid ${label} probability distribution`);
    }
    selections[answerKey] = { choice: answer.choice, confidence: probabilities[answer.choice],
      probabilities: Object.fromEntries(choices.map(key => [key, probabilities[key]])) };
  }

  // Laya confidence is normalized entropy; policy uses the selected option probability.
  return {
    selections,
    confidenceSource: "selected_option_probability",
    model: payload.model || model,
    requestDurationMs: Math.round(performance.now() - started),
    ...(payload.routing ? { routing: payload.routing } : {}),
    ...(payload.usage ? { usage: payload.usage } : {}),
  };
}

async function requestChoice({ question, answerKey, ...options }) {
  const { selections, ...metadata } = await requestLayaChoices({ ...options, questions: { [answerKey]: question } });
  return { ...selections[answerKey], ...metadata };
}

export async function requestLayaBasketDecision({ context, ...options }) {
  const { choice, ...assessment } = await requestChoice({ ...options, state: basketDecisionState(context), question: BASKET_DECISION_QUESTION, answerKey: "basket", label: "basket" });
  return { candidate: choice === "NONE" ? null : choice, ...assessment };
}

export async function requestLayaToolDecision({ context, actions, ...options }) {
  const question = {
    type: "choice",
    instructions: "Choose ONE useful next investigation action from the current observations. Gather missing evidence, analyze contradictions, or DECIDE when enough evidence is available. STOP_STAFF if evidence is inadequate. Do not repeat completed actions. Read-only actions cannot change a cart.",
    criteria: Object.fromEntries(actions.map(action => [action.id, action.description])),
  };
  const { choice, ...assessment } = await requestChoice({ ...options, state: context, question, answerKey: "next_action", label: "tool" });
  return { action: choice, ...assessment };
}
