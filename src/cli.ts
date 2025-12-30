import { writeFileSync } from "node:fs";
import { ApiClient, getAllPatientsWithMeta } from "./api";
import { buildAlertLists } from "./alerts";
import { computePatientRisk } from "./scoring";

const DEFAULT_BASE_URL = "https://assessment.ksensetech.com/api";

function getArgValue(flag: string): string | null {
  const idx = process.argv.findIndex(
    (a) => a === flag || a.startsWith(`${flag}=`)
  );
  if (idx === -1) return null;
  const a = process.argv[idx];
  if (a.includes("=")) return a.split("=").slice(1).join("=");
  const next = process.argv[idx + 1];
  return next && !next.startsWith("--") ? next : null;
}

function hasFlag(flag: string): boolean {
  return process.argv.some((a) => a === flag || a.startsWith(`${flag}=`));
}

function getPositionalNumberArg(index: number): number | null {
  const v = process.argv[index];
  if (!v) return null;
  if (v.startsWith("--")) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export async function runCli(): Promise<void> {
  const apiKey = process.env.DEMOMED_API_KEY || getArgValue("--apiKey");
  const baseUrl =
    process.env.DEMOMED_BASE_URL ||
    getArgValue("--baseUrl") ||
    DEFAULT_BASE_URL;
  const positionalLimit = getPositionalNumberArg(2);
  const limit = Number.parseInt(
    process.env.DEMOMED_LIMIT ||
      getArgValue("--limit") ||
      String(positionalLimit ?? 20),
    10
  );
  const outPath = getArgValue("--out") || "alert-lists.json";
  const shouldSubmit = hasFlag("--submit");
  const requireComplete = hasFlag("--requireComplete") || hasFlag("--verify");

  if (!apiKey) {
    console.error("Missing API key. Set DEMOMED_API_KEY or pass --apiKey.");
    process.exit(1);
  }

  const client = new ApiClient({ baseUrl, apiKey });

  console.log(`Fetching patients from ${baseUrl} ...`);
  const { patients, meta } = await getAllPatientsWithMeta(
    client,
    Math.min(Math.max(limit, 1), 20)
  );

  const expected = meta.expectedTotal;
  const totalPages = meta.totalPages;
  const pagingInfo =
    expected !== null
      ? `unique patient_ids: ${meta.uniquePatientIds}/${expected}`
      : `unique patient_ids: ${meta.uniquePatientIds}`;

  const pagesInfo = totalPages !== null ? `, totalPages: ${totalPages}` : "";
  const completeInfo = `, complete: ${meta.complete ? "yes" : "no"}`;

  console.log(
    `Fetched ${patients.length} patient records (${pagingInfo}${pagesInfo}${completeInfo}).`
  );

  if (meta.missingPages.length > 0) {
    console.warn(
      `Warning: some pages returned empty after retries: ${meta.missingPages.join(
        ", "
      )}`
    );
  }

  if ((shouldSubmit || requireComplete) && !meta.complete) {
    const msg =
      expected !== null
        ? `Fetch incomplete: collected ${meta.uniquePatientIds}/${expected} unique patient_ids (complete=${meta.complete}). Re-run to fetch all data.`
        : `Fetch incomplete: cannot confirm completeness from API metadata (complete=${meta.complete}). Re-run to fetch all data.`;
    console.error(shouldSubmit ? `Refusing to submit: ${msg}` : msg);
    process.exit(1);
  }

  const computed = [];
  let dropped = 0;

  for (const p of patients) {
    const c = computePatientRisk(p);
    if (!c) {
      dropped += 1;
      continue;
    }
    computed.push(c);
  }

  if (dropped > 0)
    console.warn(`Dropped ${dropped} records due to missing patient_id.`);

  const alerts = buildAlertLists(computed);

  writeFileSync(outPath, JSON.stringify(alerts, null, 2), "utf8");
  console.log(`\nWrote ${outPath}`);
  console.log(`High-risk (>=4): ${alerts.high_risk_patients.length}`);
  console.log(`Fever (>=99.6°F): ${alerts.fever_patients.length}`);
  console.log(`Data-quality issues: ${alerts.data_quality_issues.length}`);

  if (shouldSubmit) {
    console.log("\nSubmitting assessment payload...");
    const res = await client.submitAssessment(alerts);
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log("\nRun with --submit to POST results to /submit-assessment.");
  }
}

runCli().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
