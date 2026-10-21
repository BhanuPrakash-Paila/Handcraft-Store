import { timingSafeEqual } from "node:crypto";
import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

const RATE_WINDOW_MS = 60_000;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): HttpResponseInit {
  return {
    status,
    jsonBody: body,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      ...headers,
    },
  };
}

export function corsHeaders(request: HttpRequest): Record<string, string> {
  const origin = request.headers.get("origin");
  const allowed = process.env.STORE_ORIGIN;
  if (origin && allowed && origin === allowed) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "content-type, x-requested-with, idempotency-key",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      Vary: "Origin",
    };
  }
  return {};
}

export function isAllowedOrigin(request: HttpRequest): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === process.env.STORE_ORIGIN;
}

export function rateLimit(
  request: HttpRequest,
  context: InvocationContext,
  scope: string,
  limit = 20,
): boolean {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const key = `${scope}:${forwarded || "unknown"}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    if (rateBuckets.size > 10_000) {
      for (const [entry, value] of rateBuckets) {
        if (value.resetAt <= now) rateBuckets.delete(entry);
      }
    }
    return true;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    context.warn("Rate limit exceeded", { scope });
    return false;
  }
  return true;
}

export async function readJson<T>(request: HttpRequest): Promise<T | null> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 64_000) return null;
  try {
    const text = await request.text();
    if (text.length > 64_000) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function constantTimeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function secureCookie(name: string, value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearCookie(name: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function getCookie(request: HttpRequest, name: string): string | null {
  const value = request.headers.get("cookie");
  if (!value) return null;
  const entry = value.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}
