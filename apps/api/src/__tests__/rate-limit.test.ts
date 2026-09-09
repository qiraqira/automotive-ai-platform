import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { rateLimit } from "../rate-limit.js";

function mockReq(ip: string): Request {
  return { ip } as Request;
}

function mockRes(): Response & { statusCode?: number; body?: unknown; headers: Record<string, unknown> } {
  const headers: Record<string, unknown> = {};
  const res = {
    headers,
    setHeader: vi.fn((name: string, value: unknown) => {
      headers[name] = value;
    }),
    status: vi.fn(function (this: unknown, code: number) {
      (res as unknown as { statusCode: number }).statusCode = code;
      return res as unknown as Response;
    }),
    json: vi.fn(function (this: unknown, body: unknown) {
      (res as unknown as { body: unknown }).body = body;
      return res as unknown as Response;
    }),
  };
  return res as unknown as Response & { statusCode?: number; body?: unknown; headers: Record<string, unknown> };
}

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests up to the limit, then blocks with 429", () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 3 });
    const next = vi.fn();

    for (let i = 0; i < 3; i++) {
      limiter(mockReq("1.2.3.4"), mockRes(), next);
    }
    expect(next).toHaveBeenCalledTimes(3);

    const blockedRes = mockRes();
    limiter(mockReq("1.2.3.4"), blockedRes, next);
    expect(next).toHaveBeenCalledTimes(3); // not called a 4th time
    expect(blockedRes.status).toHaveBeenCalledWith(429);
    expect(blockedRes.body).toEqual({ error: "rate_limited" });
    // Real test-coverage gap found and fixed 2026-09-08: this only ever
    // checked the header was PRESENT, not its actual value — a
    // regression that set it to e.g. NaN, a negative number, or an
    // unrelated string would still have passed. This test already uses
    // fake timers with a frozen system clock, so the expected value is
    // fully deterministic, not just "some positive number": the window
    // starts and the blocked request both happen at the same frozen
    // instant, so the real computed value is exactly the full window
    // length in seconds (60_000ms / 1000).
    expect(blockedRes.headers["Retry-After"]).toBe(60);
  });

  it("tracks each IP independently", () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1 });
    const next = vi.fn();

    limiter(mockReq("1.1.1.1"), mockRes(), next);
    limiter(mockReq("2.2.2.2"), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(2); // both allowed — different IPs, independent windows

    const blockedRes = mockRes();
    limiter(mockReq("1.1.1.1"), blockedRes, next);
    expect(blockedRes.status).toHaveBeenCalledWith(429);
  });

  it("resets the window after windowMs elapses", () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1 });
    const next = vi.fn();

    limiter(mockReq("1.2.3.4"), mockRes(), next);
    const blockedRes = mockRes();
    limiter(mockReq("1.2.3.4"), blockedRes, next);
    expect(blockedRes.status).toHaveBeenCalledWith(429);

    vi.advanceTimersByTime(60_001);

    const allowedAfterReset = mockRes();
    limiter(mockReq("1.2.3.4"), allowedAfterReset, next);
    expect(next).toHaveBeenCalledTimes(2); // the 1st call + this one, not the blocked one
  });
});
