# Notes — DemoMed Risk Scoring Assessment

This document explains how the assessment was solved, what was implemented, and why.

## What Went Wrong (Why We Got 16.8/100)

The low score came from **submitting the wrong payload**, not from the fetch/scoring pipeline itself.

- The grader output you saw (e.g., “2 of 20 correct, 18 missed”) is consistent with a submission that only included **2 IDs** in each list.
- That happened because we were manually testing with a small `curl` payload (2 IDs per list), and/or running the CLI in a way that **did not actually submit** the computed lists.
- Running `verify` only generates `alert-lists.json` locally; it **does not** update the grader score.

Once we submitted the _computed_ payload (20/9/8 IDs) via the CLI, the grader returned **100% / PASS**.

## How We Fixed It (What Produced 100%)

1. **Made “verify” vs “submit” unambiguous**

- Added explicit scripts in `package.json`:
  - `npm run verify` → generate `alert-lists.json` (no submission)
  - `npm run submit` → generate + submit computed payload

2. **Prevented wasting attempts on incomplete fetches**

- The CLI refuses to submit unless it can confirm the fetch is complete.
- The fetch path returns metadata (expected totals/pages, missing pages) and sets `complete: yes/no`.

3. **Hardened rate-limit handling**

- The API sometimes communicates rate limiting via a JSON field (e.g., `retry_after`) instead of `Retry-After` headers.
- The client now honors both, with exponential backoff + jitter.

4. **Validated the output before submitting**

- We used `npm run verify` to confirm counts and inspect `alert-lists.json`.
- When verify showed:
  - High-risk: 20
  - Fever: 9
  - Data quality: 8
  - Fetch `complete: yes`
    …we ran `npm run submit`.

## Quick Runbook

- Verify locally (safe): `npm run verify`
- Submit computed results: `npm run submit`

If you ever see the grader reporting lots of “missed” with only “2 correct”, double-check you didn’t accidentally submit a tiny test payload.

## Goals & Constraints

- Fetch all patients from the DemoMed API reliably despite:
  - rate limiting (`429`)
  - intermittent server errors (`500`/`503`)
  - pagination
  - inconsistent response shapes / missing fields
- Compute the required outputs exactly:
  - `high_risk_patients` (total score ≥ 4)
  - `fever_patients` (valid temp ≥ 99.6°F)
  - `data_quality_issues` (any invalid BP/temp/age)
- Provide a safe workflow to verify results before consuming limited submission attempts.

## Architecture (What We Built)

This repo supports **two ways** to run the solution:

1. **CLI**

   - Fetches patients
   - Computes per-patient risk
   - Builds the three required lists
   - Writes `alert-lists.json`
   - Optionally submits (only when explicitly requested)

2. **Express + Next.js app**
   - A custom Express server serves:
     - `GET /alerts` → returns the three alert lists
     - `GET /scored` → returns per-patient scores + raw inputs (for human verification)
     - `POST /submit` → computes alert lists and submits them
   - A Next.js page (`/`) provides a simple UI to load:
     - the alert lists (for the required payload)
     - the per-patient debug table (to see _why_ someone landed in a list)

Key files:

- `src/api.ts`: resilient API client + pagination
- `src/scoring.ts`: parsing + scoring rules
- `src/alerts.ts`: builds alert lists (dedupe + sort)
- `src/cli.ts`: CLI entry for generating/submitting
- `src/server.ts`: Express server + Next integration
- `pages/index.tsx`: UI for loading `/alerts` and `/scored`

## Data Fetching Strategy

### 1) Resilient request wrapper

Implemented in `src/api.ts` as `ApiClient.requestJson()`.

Techniques used:

- **Timeouts** using `AbortController`
- **Retry with exponential backoff** (capped) + **jitter** to avoid synchronized retries
- **Special handling for rate limiting**:
  - If `429`, respect `Retry-After` when present, otherwise fall back to backoff delay
- **Transient failure retries**:
  - Retry `500` and `503` up to `maxRetries`

### 2) Response normalization

Implemented in `src/api.ts` as `normalizePatientsData()`.

The API sometimes returns data in different shapes. We normalize to a single internal representation:

- Prefer `resp.data` when it’s an array
- Also support nested shapes like `resp.data.patients`
- Also support `resp.patients`

Any non-object rows are filtered out.

### 3) Pagination that doesn’t stop too early

Implemented in `src/api.ts` as `getAllPatients()`.

We paginate primarily using:

- `pagination.hasNext` (when present)
- `pagination.totalPages` (when present)

Guardrails:

- Some pages may come back empty due to flakiness; we **don’t stop on one empty page**.
- We stop after **two empty pages in a row** (a pragmatic “probably done / probably broken” guard).
- There’s also a hard loop guard to prevent infinite loops.

## Scoring & Validation Algorithm

All rules are implemented in `src/scoring.ts`.

### Inputs used per patient

We only depend on three fields:

- `blood_pressure`
- `temperature`
- `age`

We treat other patient fields as irrelevant to scoring.

### 1) Blood pressure parsing and staging

The assessment describes BP in a `"systolic/diastolic"` string format, but the API can be inconsistent.

We accept multiple formats:

- String: `"120/80"`
- Object: `{ systolic: 120, diastolic: 80 }`
- Array/tuple: `[120, 80]`

Validation rules:

- Missing systolic or diastolic → invalid
- Non-numeric values → invalid

Staging rules (using the _higher risk_ stage if systolic/diastolic differ):

The final scoring weights used for the passing submission were:

- Normal: systolic < 120 AND diastolic < 80 → **0**
- Elevated: systolic 120–129 AND diastolic < 80 → **1**
- Stage 1: systolic 130–139 OR diastolic 80–89 → **2**
- Stage 2: systolic ≥ 140 OR diastolic ≥ 90 → **3**

### 2) Temperature scoring

Validation:

- Must be numeric (number or numeric string)

Scoring:

- ≤ 99.5°F → **0**
- 99.6–100.9°F → **1**
- ≥ 101.0°F → **2**

### 3) Age scoring

Validation:

- Must be numeric

Scoring:

- < 40 → **0**
- 40–65 (inclusive) → **1**
- > 65 → **2**

This keeps younger patients from getting an automatic baseline point.

### 4) Total risk score

$$\text{total} = \text{bpScore} + \text{tempScore} + \text{ageScore}$$

Invalid inputs contribute **0** for that category.

### 5) Alert list construction

Implemented in `src/alerts.ts`.

For each patient with a valid `patient_id`:

- **High risk**: `total >= 4`
- **Fever**: temperature is valid AND `temp >= 99.6`
- **Data quality issue**: any of BP/temp/age is invalid

Output list rules:

- Deduplicate IDs
- Sort IDs (stable, deterministic output)

## Verification Workflow (Avoid Wasting Submission Attempts)

The assessment limits submission attempts, so the repo supports verification first.

### CLI verification

- Run the CLI without `--submit` to generate `alert-lists.json` locally.
- Inspect the JSON payload, counts, and optionally compare against the UI outputs.

Recommended commands:

- `npm run verify`
- `npm run submit`

### UI verification

The UI is intentionally “inspection-first”:

- **Load alert lists** (`GET /alerts`) to see the exact required arrays.
- **Load scored patients** (`GET /scored`) to see, for each patient:
  - component scores (bp/temp/age)
  - total score
  - membership flags (fever/high-risk/data-quality)
  - raw inputs used

This makes it easier to catch:

- mis-parsed blood pressure formats
- missing/invalid temp/age handling
- off-by-one threshold errors (e.g., 99.5 vs 99.6)

## Techniques Used (Summary)

- Defensive parsing (accept common “wrong” shapes, but validate strictly)
- Idempotent deterministic outputs (sort + dedupe)
- Robust HTTP client behavior (timeouts, backoff, jitter, Retry-After)
- Pagination that tolerates transient empty pages
- Unit tests with Vitest for scoring boundaries + retry logic

## Notes on Secrets

- API keys should be provided via env var (`DEMOMED_API_KEY`) or request header.
- The code avoids hard-coding a default key.
- If sharing this repo publicly, ensure no keys are committed in docs or config files.

Also avoid pasting keys into terminal history/screenshots (e.g., in `curl` commands).
