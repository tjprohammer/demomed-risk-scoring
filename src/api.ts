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
    maxRetries = 12,
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
        if (res.status === 429) {
          const retryAfterHeader = res.headers.get("retry-after");
          const retryAfterSecondsFromHeader = retryAfterHeader
            ? Number.parseInt(retryAfterHeader, 10)
            : NaN;

          const retryAfterSecondsFromBody =
            body && typeof body === "object"
              ? Number.parseInt(
                  String(
                    (body as any).retry_after ??
                      (body as any).retryAfter ??
                      (body as any).retryAfterSeconds ??
                      ""
                  ),
                  10
                )
              : NaN;

          const retryAfterSeconds = Number.isFinite(retryAfterSecondsFromHeader)
            ? retryAfterSecondsFromHeader
            : Number.isFinite(retryAfterSecondsFromBody)
              ? retryAfterSecondsFromBody
              : NaN;

          const waitMs = Number.isFinite(retryAfterSeconds)
            ? Math.max(retryAfterSeconds, 0) * 1000
            : backoffMs;

          if (attempt <= this.maxRetries) {
            clearTimeout(timer);
            await this.sleepImpl(jitter(Math.max(waitMs, backoffMs)));
            backoffMs = Math.min(backoffMs * 2, 8000);
            continue;
          }

          clearTimeout(timer);
          const msg = typeof body === "string" ? body : JSON.stringify(body);
          const extra = Number.isFinite(retryAfterSeconds)
            ? ` (suggested wait: ${retryAfterSeconds}s)`
            : "";
          throw new Error(`HTTP 429 Too Many Requests${extra}: ${msg}`);
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

function getPatientIdFromRecord(p: unknown): string | null {
  const obj = p as any;
  const candidates = [obj?.patient_id, obj?.patientId, obj?.id, obj?.patientID];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

function dedupeByPatientId(patients: Record<string, unknown>[]): {
  patients: Record<string, unknown>[];
  uniquePatientIds: number;
} {
  const byId = new Map<string, Record<string, unknown>>();
  const noId: Record<string, unknown>[] = [];

  for (const p of patients) {
    const id = getPatientIdFromRecord(p);
    if (!id) {
      noId.push(p);
      continue;
    }
    if (!byId.has(id)) byId.set(id, p);
  }

  const deduped = Array.from(byId.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);

  return { patients: [...deduped, ...noId], uniquePatientIds: byId.size };
}

export type PatientsFetchMeta = {
  expectedTotal: number | null;
  totalPages: number | null;
  missingPages: number[];
  uniquePatientIds: number;
  complete: boolean;
};

export async function getAllPatientsWithMeta(
  client: ApiClient,
  limit = 20,
  opts: {
    maxPageAttempts?: number;
    maxTotalPages?: number;
    sleepBetweenPagesMs?: number;
    sleepBetweenAttemptsMs?: number;
  } = {}
): Promise<{ patients: Record<string, unknown>[]; meta: PatientsFetchMeta }> {
  const maxPageAttempts = Math.min(Math.max(opts.maxPageAttempts ?? 5, 1), 12);
  const maxTotalPages = Math.min(Math.max(opts.maxTotalPages ?? 200, 1), 500);
  const sleepBetweenPagesMs = Math.min(
    Math.max(opts.sleepBetweenPagesMs ?? 250, 0),
    5000
  );
  const sleepBetweenAttemptsMs = Math.min(
    Math.max(opts.sleepBetweenAttemptsMs ?? 250, 0),
    5000
  );

  async function fetchNormalizedPage(page: number): Promise<{
    patients: Record<string, unknown>[];
    resp: any;
  }> {
    let lastResp: any = null;
    for (let attempt = 1; attempt <= maxPageAttempts; attempt += 1) {
      const resp: any = await client.getPatientsPage(page, limit);
      lastResp = resp;
      const patients = normalizePatientsData(resp);
      if (patients.length > 0) return { patients, resp };
      await sleep(sleepBetweenAttemptsMs * attempt);
    }

    return {
      patients: normalizePatientsData(lastResp),
      resp: lastResp,
    };
  }

  const out: Record<string, unknown>[] = [];
  const missingPages: number[] = [];
  const seenIds = new Set<string>();
  let completeByHeuristic = false;
  let maxPageFetched = 0;

  let expectedTotal: number | null = null;
  let totalPages: number | null = null;

  function parseFiniteInt(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === "string") {
      const n = Number.parseInt(value.trim(), 10);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  function learnPagination(resp: any): void {
    const expectedTotalRaw = resp?.pagination?.total;
    const expectedParsed = parseFiniteInt(expectedTotalRaw);
    if (expectedTotal === null && expectedParsed !== null) {
      expectedTotal = Math.max(expectedParsed, 0);
    }

    const totalPagesRaw = resp?.pagination?.totalPages;
    const pagesParsed = parseFiniteInt(totalPagesRaw);
    if (totalPages === null && pagesParsed !== null) {
      totalPages = Math.min(Math.max(pagesParsed, 1), maxTotalPages);
    }
  }

  function countNewIds(patients: Record<string, unknown>[]): number {
    let added = 0;
    for (const p of patients) {
      const id = getPatientIdFromRecord(p);
      if (!id) continue;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        added += 1;
      }
    }
    return added;
  }

  // First page read to determine totalPages/total.
  const first = await fetchNormalizedPage(1);
  maxPageFetched = Math.max(maxPageFetched, 1);
  if (first.patients.length === 0) missingPages.push(1);
  out.push(...first.patients);
  learnPagination(first.resp);
  countNewIds(first.patients);

  // Completion heuristic: stop after N pages that add 0 new unique IDs.
  // This helps when pagination metadata is missing or inconsistent.
  const maxNoNewIdPages = 5;
  let noNewIdPagesInARow = first.patients.length === 0 ? 1 : 0;
  let page = 2;

  for (let guard = 0; guard < maxTotalPages; guard += 1) {
    const { patients, resp } = await fetchNormalizedPage(page);
    maxPageFetched = Math.max(maxPageFetched, page);
    learnPagination(resp);

    if (patients.length === 0) missingPages.push(page);
    out.push(...patients);

    const newIds = countNewIds(patients);
    if (newIds === 0) noNewIdPagesInARow += 1;
    else noNewIdPagesInARow = 0;

    // If totalPages is available, use it as a hint for when to start applying
    // the "no new IDs" completion condition.
    const pastExpectedEnd =
      totalPages !== null ? page >= totalPages : page >= 10;

    if (noNewIdPagesInARow >= maxNoNewIdPages && pastExpectedEnd) {
      completeByHeuristic = true;
      break;
    }

    page += 1;
    await sleep(sleepBetweenPagesMs);
  }

  // If totalPages is known and we still have missing pages, do recovery passes.
  if (totalPages !== null && missingPages.length > 0) {
    for (let round = 0; round < 2 && missingPages.length > 0; round += 1) {
      const stillMissing: number[] = [];
      for (const missingPage of missingPages) {
        // Don't waste time recovering pages beyond totalPages.
        if (missingPage > totalPages) continue;
        const { patients } = await fetchNormalizedPage(missingPage);
        maxPageFetched = Math.max(maxPageFetched, missingPage);
        if (patients.length === 0) stillMissing.push(missingPage);
        else {
          out.push(...patients);
          countNewIds(patients);
        }
        await sleep(sleepBetweenPagesMs);
      }
      missingPages.splice(0, missingPages.length, ...stillMissing);
    }

    // If we expected a fixed number of pages and none are missing after retries,
    // we can consider the fetch complete (subject to the expectedTotal check below).
    if (missingPages.length === 0) completeByHeuristic = true;
  }

  const deduped = dedupeByPatientId(out);

  const missingWithinExpectedRange = (() => {
    const tp = totalPages;
    const uniqueMissing = Array.from(new Set(missingPages));
    if (tp === null) return uniqueMissing;
    return uniqueMissing.filter((p) => p >= 1 && p <= tp);
  })();

  // Final, conservative completeness:
  // - If expectedTotal is known, require uniquePatientIds >= expectedTotal.
  // - Else if totalPages is known, require we fetched at least through totalPages AND no missing pages within 1..totalPages.
  // - Else, we cannot confidently assert completeness.
  const complete =
    expectedTotal !== null
      ? deduped.uniquePatientIds >= expectedTotal
      : totalPages !== null
      ? maxPageFetched >= totalPages && missingWithinExpectedRange.length === 0
      : false;
  const meta: PatientsFetchMeta = {
    expectedTotal,
    totalPages,
    missingPages: missingWithinExpectedRange.sort((a, b) => a - b),
    uniquePatientIds: deduped.uniquePatientIds,
    complete,
  };

  return { patients: deduped.patients, meta };
}

export async function getAllPatients(
  client: ApiClient,
  limit = 20
): Promise<Record<string, unknown>[]> {
  const { patients } = await getAllPatientsWithMeta(client, limit);
  return patients;
}
