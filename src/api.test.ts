import { describe, expect, test } from "vitest";
import { ApiClient } from "./api";

describe("ApiClient retry behavior", () => {
  test("retries on 429 then succeeds", async () => {
    let calls = 0;

    const fetchImpl = async (): Promise<Response> => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: "rate limited" }), {
          status: 429,
          headers: {
            "retry-after": "0",
          },
        });
      }

      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };

    const sleepCalls: number[] = [];
    const sleepImpl = async (ms: number) => {
      sleepCalls.push(ms);
    };

    const client = new ApiClient({
      baseUrl: "https://example.test/api",
      apiKey: "ak_test",
      fetchImpl,
      sleepImpl,
      maxRetries: 2,
      minDelayMs: 1,
    });

    const res = await client.requestJson("/patients?page=1&limit=5");
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    expect(sleepCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("retries on 503 then succeeds", async () => {
    let calls = 0;

    const fetchImpl = async (): Promise<Response> => {
      calls += 1;
      if (calls < 3) {
        return new Response("temporary", { status: 503 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const client = new ApiClient({
      baseUrl: "https://example.test/api",
      apiKey: "ak_test",
      fetchImpl,
      sleepImpl: async () => {},
      maxRetries: 5,
      minDelayMs: 1,
    });

    const res = await client.requestJson("/anything");
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
  });
});
