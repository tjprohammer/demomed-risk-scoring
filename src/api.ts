/**
 * DemoMed API client with retries, backoff, and response normalization.
 * Requires Node 18+ (global fetch).
 */

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

type ApiClientOptions = {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  maxRetries?: number;
  minDelayMs?: number;
  fetchImpl?: FetchLike;
  sleepImpl?: (ms: number) => Promise<void>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms: number): number {
  const rand = Math.random() * 0.3 + 0.85; // 0.85..1.15
  return Math.round(ms * rand);
}

async function readJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly minDelayMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor({
    baseUrl,
    apiKey,
    timeoutMs = 15000,
    maxRetries = 6,
    minDelayMs = 200,
    fetchImpl = fetch,
    sleepImpl = sleep,
  }: ApiClientOptions) {
    this.baseUrl = String(baseUrl || "").replace(/\/$/, "");
    this.apiKey = String(apiKey || "");
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.minDelayMs = minDelayMs;
    this.fetchImpl = fetchImpl;
    this.sleepImpl = sleepImpl;
  }

  async requestJson(
    path: string,
    init: RequestInit = {}
  ): Promise<{ status: number; headers: Headers; body: unknown }> {
    const url = `${this.baseUrl}${path}`;

    let attempt = 0;
    let backoffMs = this.minDelayMs;

    while (true) {
      attempt += 1;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await this.fetchImpl(url, {
          ...init,
          signal: controller.signal,
          headers: {
            ...(init.headers || {}),
            "x-api-key": this.apiKey,
            accept: "application/json",
          },
        });

        const body = await readJsonResponse(res);

        if (res.ok) {
          clearTimeout(timer);
          return { status: res.status, headers: res.headers, body };
        }

        // 429 rate limiting
        if (res.status === 429 && attempt <= this.maxRetries) {
          const ra = res.headers.get("retry-after");
          const waitMs = ra ? Number.parseInt(ra, 10) * 1000 : backoffMs;
          clearTimeout(timer);
          await this.sleepImpl(jitter(Math.max(waitMs, backoffMs)));
          backoffMs = Math.min(backoffMs * 2, 8000);
          continue;
        }

        // transient server failures
        if (
          (res.status === 500 || res.status === 503) &&
          attempt <= this.maxRetries
        ) {
          clearTimeout(timer);
          await this.sleepImpl(jitter(backoffMs));
          backoffMs = Math.min(backoffMs * 2, 8000);
          continue;
        }

        clearTimeout(timer);
        const msg = typeof body === "string" ? body : JSON.stringify(body);
        throw new Error(`HTTP ${res.status} ${res.statusText}: ${msg}`);
      } catch (err) {
        clearTimeout(timer);
        if (attempt <= this.maxRetries) {
          await this.sleepImpl(jitter(backoffMs));
          backoffMs = Math.min(backoffMs * 2, 8000);
          continue;
        }
        throw err;
      }
    }
  }

  async getPatientsPage(page: number, limit: number): Promise<unknown> {
    const path = `/patients?page=${encodeURIComponent(
      String(page)
    )}&limit=${encodeURIComponent(String(limit))}`;
    const { body } = await this.requestJson(path, { method: "GET" });

    if (body && typeof body === "object") return body;
    if (Array.isArray(body)) return { data: body };
    return { data: [] };
  }

  async submitAssessment(payload: unknown): Promise<unknown> {
    const { body } = await this.requestJson("/submit-assessment", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return body;
  }
}

export function normalizePatientsData(
  resp: unknown
): Record<string, unknown>[] {
  const r = resp as any;
  const d = r && typeof r === "object" ? r.data : undefined;

  if (Array.isArray(d)) {
    return d.filter((x) => x && typeof x === "object");
  }

  const maybePatients =
    d && typeof d === "object" ? (d as any).patients : undefined;
  if (Array.isArray(maybePatients)) {
    return maybePatients.filter((x) => x && typeof x === "object");
  }

  const rootPatients =
    r && typeof r === "object" ? (r as any).patients : undefined;
  if (Array.isArray(rootPatients)) {
    return rootPatients.filter((x) => x && typeof x === "object");
  }

  return [];
}

export async function getAllPatients(
  client: ApiClient,
  limit = 20
): Promise<Record<string, unknown>[]> {
  let page = 1;
  const out: Record<string, unknown>[] = [];
  let emptyPagesInARow = 0;

  for (let guard = 0; guard < 200; guard += 1) {
    const resp: any = await client.getPatientsPage(page, limit);
    const patients = normalizePatientsData(resp);

    if (patients.length === 0) {
      emptyPagesInARow += 1;
    } else {
      emptyPagesInARow = 0;
      out.push(...patients);
    }

    const hasNext = resp?.pagination?.hasNext;
    const totalPages = resp?.pagination?.totalPages;

    if (hasNext === false) break;
    if (typeof totalPages === "number" && page >= totalPages) break;

    if (emptyPagesInARow >= 2) break;

    page += 1;
    await sleep(250);
  }

  return out;
}
