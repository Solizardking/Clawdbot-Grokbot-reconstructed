import { applyOpenRouterAutoRouterPayload, isOpenRouterAutoRouter, type OpenRouterAutoRouterRequest } from "./inference-router.js";

const OPENROUTER_CHAT_COMPLETIONS = "https://openrouter.ai/api/v1/chat/completions";

/** OpenRouter permits at most three native candidates. Retry only this HTTP
 * inference request on capacity/model failures, never the surrounding tool turn.
 * `openrouter/auto` skips local `models[]` wrapping so Auto Router owns fallbacks. */
export function createOpenRouterModelFetch(fetchImpl: typeof fetch, models: readonly string[], autoRouter: OpenRouterAutoRouterRequest = {}): typeof fetch {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== OPENROUTER_CHAT_COMPLETIONS) return fetchImpl(input, init);
    const body = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    if (typeof body !== "string") return fetchImpl(input, init);
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const requested = typeof parsed.model === "string" ? parsed.model : models[0];
    if (isOpenRouterAutoRouter(requested) || isOpenRouterAutoRouter(models[0])) {
      return fetchImpl(input, { ...init, body: JSON.stringify(applyOpenRouterAutoRouterPayload(parsed, autoRouter)) });
    }
    if (models.length < 2) return fetchImpl(input, init);
    for (let offset = 0; offset < models.length; offset += 3) {
      const group = models.slice(offset, offset + 3);
      const response = await fetchImpl(input, { ...init, body: JSON.stringify({ ...parsed, model: group[0], models: group }) });
      if (offset + 3 >= models.length || ![404, 429, 500, 502, 503, 504].includes(response.status)) return response;
      await response.body?.cancel();
    }
    throw new Error("OpenRouter model roster is empty.");
  };
}
