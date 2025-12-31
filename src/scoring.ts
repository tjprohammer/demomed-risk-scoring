import type { ComputedPatientRisk, ComputedPatientRiskDetails } from "./types";

/**
 * Stringifies unknown values safely.
 *
 * This is used before parsing to normalize `null`/`undefined` into an empty
 * string and to avoid throwing when calling `.trim()`.
 */
function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * Attempts to parse a number from unknown input.
 * - Accepts numbers
 * - Accepts numeric strings (including values like "98.6F" -> 98.6)
 */
export function parseLooseNumber(value: unknown): {
  value: number | null;
  valid: boolean;
} {
  if (typeof value === "number" && Number.isFinite(value))
    return { value, valid: true };
  if (typeof value !== "string") return { value: null, valid: false };

  const s = value.trim();
  if (!s) return { value: null, valid: false };

  const match = s.match(/-?\d+(?:\.\d+)?/);
  if (!match) return { value: null, valid: false };

  const n = Number.parseFloat(match[0]);
  if (!Number.isFinite(n)) return { value: null, valid: false };
  return { value: n, valid: true };
}

/**
 * Parses a blood pressure reading from unknown input.
 *
 * Accepted formats (to tolerate inconsistent API shapes):
 * - String: "120/80" (any surrounding whitespace is ignored)
 * - Array/tuple: [120, 80]
 * - Object: { systolic: 120, diastolic: 80 } and common aliases (`sys`/`dia`)
 *
 * Returned values are integers (via truncation/parseInt).
 */
export function parseBloodPressure(value: unknown): {
  systolic: number | null;
  diastolic: number | null;
  valid: boolean;
} {
  // Handle inconsistent formats: { systolic, diastolic } or [s, d]
  if (value && typeof value === "object") {
    if (Array.isArray(value) && value.length >= 2) {
      const sParsed = parseLooseNumber(value[0]);
      const dParsed = parseLooseNumber(value[1]);
      if (sParsed.valid && dParsed.valid) {
        const systolic = Math.trunc(sParsed.value as number);
        const diastolic = Math.trunc(dParsed.value as number);
        if (Number.isFinite(systolic) && Number.isFinite(diastolic)) {
          return { systolic, diastolic, valid: true };
        }
      }
      return { systolic: null, diastolic: null, valid: false };
    }

    const v = value as any;
    const candidateSystolic = v.systolic ?? v.sys ?? v.s;
    const candidateDiastolic = v.diastolic ?? v.dia ?? v.d;
    if (candidateSystolic !== undefined || candidateDiastolic !== undefined) {
      const sParsed = parseLooseNumber(candidateSystolic);
      const dParsed = parseLooseNumber(candidateDiastolic);
      if (sParsed.valid && dParsed.valid) {
        const systolic = Math.trunc(sParsed.value as number);
        const diastolic = Math.trunc(dParsed.value as number);
        if (Number.isFinite(systolic) && Number.isFinite(diastolic)) {
          return { systolic, diastolic, valid: true };
        }
      }
      return { systolic: null, diastolic: null, valid: false };
    }
  }

  const s = asString(value).trim();
  if (!s) return { systolic: null, diastolic: null, valid: false };

  const parts = s.split("/");
  if (parts.length !== 2)
    return { systolic: null, diastolic: null, valid: false };

  const left = parts[0].trim();
  const right = parts[1].trim();
  if (!left || !right) return { systolic: null, diastolic: null, valid: false };

  const sMatch = left.match(/\d+/);
  const dMatch = right.match(/\d+/);
  if (!sMatch || !dMatch)
    return { systolic: null, diastolic: null, valid: false };

  const systolic = Number.parseInt(sMatch[0], 10);
  const diastolic = Number.parseInt(dMatch[0], 10);
  if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) {
    return { systolic: null, diastolic: null, valid: false };
  }

  return { systolic, diastolic, valid: true };
}

/**
 * Scores a blood pressure reading.
 *
 * - Returns `{ score: 0, valid: false }` for missing/invalid inputs.
 * - Otherwise returns a category score based on systolic/diastolic.
 *
 * Important behavior:
 * - When systolic and diastolic fall into different categories, we apply the
 *   higher-risk category (e.g., 150/85 is Stage 2 because systolic >= 140).
 */
export function scoreBloodPressure(bpValue: unknown): {
  score: number;
  valid: boolean;
} {
  const bp = parseBloodPressure(bpValue);
  if (!bp.valid || bp.systolic === null || bp.diastolic === null)
    return { score: 0, valid: false };

  const s = bp.systolic;
  const d = bp.diastolic;

  // Scoring weights are 0..3 to avoid classifying common vitals as high-risk.
  if (s < 120 && d < 80) return { score: 0, valid: true }; // Normal
  if (s >= 120 && s <= 129 && d < 80) return { score: 1, valid: true }; // Elevated

  // Stage 2 must override stage 1 when readings disagree (e.g., 150/85).
  if (s >= 140 || d >= 90) return { score: 3, valid: true }; // Stage 2
  if ((s >= 130 && s <= 139) || (d >= 80 && d <= 89))
    return { score: 2, valid: true }; // Stage 1

  return { score: 0, valid: false };
}

/**
 * Scores a temperature reading (°F).
 *
 * - Returns `{ valid: false }` when the input cannot be parsed as a number.
 * - `fever` is defined as `temp >= 99.6` when valid.
 */
export function scoreTemperature(tempValue: unknown): {
  score: number;
  valid: boolean;
  fever: boolean;
  temp: number | null;
} {
  const parsed = parseLooseNumber(tempValue);
  if (!parsed.valid || parsed.value === null)
    return { score: 0, valid: false, fever: false, temp: null };

  const t = parsed.value;
  const fever = t >= 99.6;

  if (t <= 99.5) return { score: 0, valid: true, fever, temp: t };
  if (t >= 99.6 && t <= 100.9) return { score: 1, valid: true, fever, temp: t };
  if (t >= 101.0) return { score: 2, valid: true, fever, temp: t };

  return { score: 0, valid: true, fever, temp: t };
}

/**
 * Scores age.
 *
 * - Returns `{ valid: false }` when the input cannot be parsed as a number.
 * - Otherwise assigns points based on age bands.
 */
export function scoreAge(ageValue: unknown): {
  score: number;
  valid: boolean;
  age: number | null;
} {
  const parsed = parseLooseNumber(ageValue);
  if (!parsed.valid || parsed.value === null)
    return { score: 0, valid: false, age: null };

  const age = Math.trunc(parsed.value);
  if (!Number.isFinite(age)) return { score: 0, valid: false, age: null };

  if (age < 40) return { score: 0, valid: true, age };
  if (age > 65) return { score: 2, valid: true, age };
  return { score: 1, valid: true, age };
}

/**
 * Extracts patient id from a patient record.
 *
 * The API can return different id keys, so we check several.
 */
function getPatientId(p: unknown): string | null {
  const obj = p as any;
  const candidates = [obj?.patient_id, obj?.patientId, obj?.id, obj?.patientID];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

/**
 * Picks the first matching field from an object.
 *
 * Used to tolerate inconsistent key names coming from upstream data.
 */
function pickField(p: unknown, keys: string[]): unknown {
  const obj = p as any;
  for (const k of keys) {
    if (obj && typeof obj === "object" && k in obj) return obj[k];
  }
  return undefined;
}

/**
 * Extracts the raw scoring inputs (BP/temp/age) from a patient record.
 *
 * We only depend on these fields for assessment scoring.
 */
function extractRiskInputs(p: unknown): {
  bpRaw: unknown;
  tempRaw: unknown;
  ageRaw: unknown;
} {
  const bpRaw = pickField(p, [
    "blood_pressure",
    "bloodPressure",
    "bp",
    "bloodPressureReading",
  ]);
  const tempRaw = pickField(p, [
    "temperature",
    "temp",
    "temp_f",
    "temperature_f",
    "temperatureF",
    "tempF",
  ]);
  const ageRaw = pickField(p, ["age", "Age", "patient_age", "patientAge"]);

  return { bpRaw, tempRaw, ageRaw };
}

/**
 * Computes scores and flags for a single patient.
 *
 * Returns `null` if the record doesn't contain a usable patient id.
 *
 * Flags:
 * - `highRisk`: `total >= 4`
 * - `fever`: valid temperature and `temp >= 99.6`
 * - `dataQualityIssue`: any invalid input among BP/temp/age
 */
export function computePatientRisk(p: unknown): ComputedPatientRisk | null {
  const patientId = getPatientId(p);
  if (!patientId) return null;

  const { bpRaw, tempRaw, ageRaw } = extractRiskInputs(p);

  const bp = scoreBloodPressure(bpRaw);
  const temp = scoreTemperature(tempRaw);
  const age = scoreAge(ageRaw);

  const total = bp.score + temp.score + age.score;
  const dataQualityIssue = !bp.valid || !temp.valid || !age.valid;
  const highRisk = total >= 4;

  return {
    patientId,
    scores: {
      bp: bp.score,
      temp: temp.score,
      age: age.score,
      total,
    },
    flags: {
      bpValid: bp.valid,
      tempValid: temp.valid,
      ageValid: age.valid,
      fever: temp.valid ? temp.fever : false,
      dataQualityIssue,
      highRisk,
    },
  };
}

/**
 * Like `computePatientRisk(...)`, but includes the raw input values used.
 *
 * This powers the `/scored` endpoint and UI table for human verification.
 */
export function computePatientRiskDetails(
  p: unknown
): ComputedPatientRiskDetails | null {
  const base = computePatientRisk(p);
  if (!base) return null;

  const { bpRaw, tempRaw, ageRaw } = extractRiskInputs(p);

  return {
    ...base,
    inputs: {
      bloodPressure: bpRaw,
      temperature: tempRaw,
      age: ageRaw,
    },
  };
}
