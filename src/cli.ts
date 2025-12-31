import { writeFileSync } from "node:fs";
import { ApiClient, getAllPatientsWithMeta } from "./api";
import { buildAlertLists } from "./alerts";
import { computePatientRisk } from "./scoring";

const DEFAULT_BASE_URL = "https://assessment.ksensetech.com/api";

/**
 * Reads a flag value from argv.
 *
 * Supports both styles:
 * - `--limit 20`
 * - `--limit=20`
 *
 * Returns `null` if the flag is not present or has no value.
 */
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

/**
 * Checks whether argv includes a boolean flag.
 *
 * Supports both:
 * - `--submit`
 * - `--submit=true` (anything with `--submit=` counts as present)
 */
function hasFlag(flag: string): boolean {
  return process.argv.some((a) => a === flag || a.startsWith(`${flag}=`));
}

/**
 * Interprets environment variables as booleans.
 *
 * This exists because some shells / npm scripts can drop argv flags on Windows.
 * For example, `DEMOMED_SUBMIT=1 npm run submit` forces a submission even if
 * `--submit` is not forwarded.
 */
function envFlag(name: string): boolean {
  const v = process.env[name];
  if (!v) return false;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

/**
 * Reads a positional integer argument from argv.
 *
 * Used as a fallback when flags are not forwarded.
 * Example: `tsx src/cli.ts 20` will treat argv[2] as the limit.
 */
function getPositionalNumberArg(index: number): number | null {
  const v = process.argv[index];
  if (!v) return null;
  if (v.startsWith("--")) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * CLI entrypoint.
 *
 * Pipeline:
 * 1) Load configuration (API key, base URL, page size).
 * 2) Fetch all patients with pagination + robustness.
 * 3) Refuse to submit if the fetch is not complete.
 * 4) Compute per-patient scores/flags.
 * 5) Build the required alert lists (deduped + sorted IDs).
 * 6) Write `alert-lists.json`.
 * 7) Optionally submit to `/submit-assessment`.
 */
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

  /**
   * Submission is always opt-in.
   * - `--submit` on the CLI
   * - or `DEMOMED_SUBMIT=1`
   */
  const shouldSubmit = hasFlag("--submit") || envFlag("DEMOMED_SUBMIT");

  /**
   * "Require complete" is used for both `--verify` and submission.
   *
   * - Verify mode should fail fast if the dataset is incomplete.
   * - Submitting partial datasets wastes limited attempts.
   */
  const requireComplete =
    hasFlag("--requireComplete") ||
    hasFlag("--verify") ||
    envFlag("DEMOMED_VERIFY");

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

/**
 * Execute the CLI when this file is run directly.
 *
 * In tests, other modules can import and call `runCli()` instead.
 */
runCli().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
