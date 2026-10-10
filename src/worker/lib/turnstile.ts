import { ApiError } from "./core";

type SiteverifyResponse = {
  success: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

export async function verifyTurnstile(
  env: Env,
  token: string,
  remoteIp: string | undefined
): Promise<void> {
  if (env.ENVIRONMENT !== "production" && token === "") {
    return;
  }
  if (!token) {
    throw new ApiError(422, "turnstile_required", "Please complete the anti-bot verification");
  }

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: env.TURNSTILE_SECRET_KEY,
      response: token,
      remoteip: remoteIp,
      idempotency_key: crypto.randomUUID()
    })
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new ApiError(503, "turnstile_unavailable", "Anti-bot verification is temporarily unavailable");
  }
  const result: SiteverifyResponse = await response.json();
  if (!result.success) {
    throw new ApiError(422, "turnstile_failed", "Anti-bot verification failed", result["error-codes"]);
  }
}
