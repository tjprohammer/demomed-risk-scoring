import express from "express";
import next from "next";
import { ApiClient, getAllPatientsWithMeta } from "./api";
import { buildAlertLists } from "./alerts";
import { computePatientRisk, computePatientRiskDetails } from "./scoring";
import type { AlertLists, ComputedPatientRiskDetails } from "./types";

const DEFAULT_BASE_URL = "https://assessment.ksensetech.com/api";

function getApiKey(req: express.Request): string | null {
  const headerKey = req.header("x-api-key");
  if (headerKey && headerKey.trim()) return headerKey.trim();

  const envKey = process.env.DEMOMED_API_KEY;
  if (envKey && envKey.trim()) return envKey.trim();

  return null;
}

function getBaseUrl(req: express.Request): string {
  const headerBase = req.header("x-base-url");
  if (headerBase && headerBase.trim())
    return headerBase.trim().replace(/\/$/, "");

  return (process.env.DEMOMED_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

async function computeAlerts(
  apiKey: string,
  baseUrl: string,
  limit = 20,
  opts: { requireComplete?: boolean } = {}
): Promise<AlertLists> {
  const client = new ApiClient({ baseUrl, apiKey });
  const { patients, meta } = await getAllPatientsWithMeta(
    client,
    Math.min(Math.max(limit, 1), 20)
  );

  if (
    opts.requireComplete &&
    meta.expectedTotal !== null &&
    meta.uniquePatientIds > 0 &&
    meta.uniquePatientIds < meta.expectedTotal
  ) {
    throw new Error(
      `Incomplete fetch: collected ${meta.uniquePatientIds}/${meta.expectedTotal} unique patient_ids. Try again.`
    );
  }

  const computed = [];
  for (const p of patients) {
    const c = computePatientRisk(p);
    if (c) computed.push(c);
  }

  return buildAlertLists(computed);
}

async function computeScoredPatients(
  apiKey: string,
  baseUrl: string,
  limit = 20
): Promise<ComputedPatientRiskDetails[]> {
  const client = new ApiClient({ baseUrl, apiKey });
  const { patients } = await getAllPatientsWithMeta(
    client,
    Math.min(Math.max(limit, 1), 20)
  );

  const computed: ComputedPatientRiskDetails[] = [];
  for (const p of patients) {
    const c = computePatientRiskDetails(p);
    if (c) computed.push(c);
  }

  computed.sort((a, b) => a.patientId.localeCompare(b.patientId));
  return computed;
}

async function main(): Promise<void> {
  const dev = process.env.NODE_ENV !== "production";
  const app = next({ dev });
  const handle = app.getRequestHandler();

  await app.prepare();

  const server = express();
  server.use(express.json());

  // GET /alerts -> compute lists
  server.get("/alerts", async (req, res) => {
    const apiKey = getApiKey(req);
    if (!apiKey)
      return res.status(400).json({
        error: "Missing x-api-key header (or DEMOMED_API_KEY env var).",
      });

    const baseUrl = getBaseUrl(req);
    const limit = Number.parseInt(
      String(req.query.limit ?? process.env.DEMOMED_LIMIT ?? "20"),
      10
    );

    try {
      const alerts = await computeAlerts(apiKey, baseUrl, limit);
      return res.json(alerts);
    } catch (err: any) {
      return res
        .status(502)
        .json({ error: err?.message || "Failed to compute alerts" });
    }
  });

  // GET /scored -> per-patient scores/flags (debug/verification UI)
  server.get("/scored", async (req, res) => {
    const apiKey = getApiKey(req);
    if (!apiKey)
      return res.status(400).json({
        error: "Missing x-api-key header (or DEMOMED_API_KEY env var).",
      });

    const baseUrl = getBaseUrl(req);
    const limit = Number.parseInt(
      String(req.query.limit ?? process.env.DEMOMED_LIMIT ?? "20"),
      10
    );

    try {
      const scored = await computeScoredPatients(apiKey, baseUrl, limit);
      return res.json({ data: scored });
    } catch (err: any) {
      return res
        .status(502)
        .json({ error: err?.message || "Failed to compute scored patients" });
    }
  });

  // POST /submit -> compute lists then submit
  server.post("/submit", async (req, res) => {
    const apiKey = getApiKey(req);
    if (!apiKey)
      return res.status(400).json({
        error: "Missing x-api-key header (or DEMOMED_API_KEY env var).",
      });

    const baseUrl = getBaseUrl(req);
    const limit = Number.parseInt(
      String(req.query.limit ?? process.env.DEMOMED_LIMIT ?? "20"),
      10
    );

    try {
      const alerts = await computeAlerts(apiKey, baseUrl, limit, {
        requireComplete: true,
      });
      const client = new ApiClient({ baseUrl, apiKey });
      const result = await client.submitAssessment(alerts);
      return res.json(result);
    } catch (err: any) {
      return res
        .status(502)
        .json({ error: err?.message || "Failed to submit assessment" });
    }
  });

  // Let Next handle everything else
  server.all("*", (req, res) => handle(req, res));

  const port = Number.parseInt(process.env.PORT || "3000", 10);
  server.listen(port, () => {
    console.log(`Server ready on http://localhost:${port} (dev=${dev})`);
  });
}

main().catch((err) => {
  console.error("Fatal server error:", err);
  process.exit(1);
});
