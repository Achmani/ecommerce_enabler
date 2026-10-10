import type { MiddlewareHandler } from "hono";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { ApiError, type AppBindings } from "./core";

function allowedAdmins(env: Env): Set<string> {
  return new Set(
    env.ADMIN_EMAILS.split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

export const requireAdmin: MiddlewareHandler<AppBindings> = async (c, next) => {
  const isLocal = c.env.ENVIRONMENT !== "production";
  const email = isLocal
    ? c.env.DEV_ADMIN_EMAIL.trim().toLowerCase()
    : await verifiedAccessEmail(c.req.raw, c.env);

  if (!email) {
    throw new ApiError(401, "admin_authentication_required", "Administrator authentication is required");
  }

  const admins = allowedAdmins(c.env);
  if (admins.size === 0 || !admins.has(email)) {
    throw new ApiError(403, "admin_not_authorized", "This identity is not allowed to administer the store");
  }

  c.set("adminEmail", email);
  await next();
};

async function verifiedAccessEmail(request: Request, env: Env): Promise<string> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    throw new ApiError(503, "admin_authentication_not_configured", "Administrator authentication is not configured");
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) {
    throw new ApiError(401, "admin_authentication_required", "Administrator authentication is required");
  }

  try {
    const issuer = env.ACCESS_TEAM_DOMAIN.replace(/\/$/, "");
    const jwks = await accessKeys(`${issuer}/cdn-cgi/access/certs`);
    const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
      issuer,
      audience: env.ACCESS_AUD
    });
    return typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  } catch {
    throw new ApiError(401, "admin_authentication_invalid", "Administrator authentication is invalid");
  }
}

async function accessKeys(url: string): Promise<JSONWebKeySet> {
  const cache = await caches.open("cloudflare-access-jwks");
  const cacheKey = new Request(url);
  let response = await cache.match(cacheKey);
  if (!response) {
    const upstream = await fetch(cacheKey);
    if (!upstream.ok) {
      await upstream.body?.cancel();
      throw new Error("Cloudflare Access keys are unavailable");
    }
    const headers = new Headers(upstream.headers);
    headers.set("Cache-Control", "public, max-age=3600");
    response = new Response(upstream.body, { status: upstream.status, headers });
    await cache.put(cacheKey, response.clone());
  }
  return response.json<JSONWebKeySet>();
}
