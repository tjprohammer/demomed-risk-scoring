import type { AlertLists, ComputedPatientRisk } from "./types";

/**
 * Deduplicates and sorts an array of patient ids.
 *
 * This guarantees deterministic output (stable ordering) which is helpful for:
 * - reviewing generated JSON
 * - tests
 * - avoiding accidental grader mismatches due to ordering
 */
function uniqSorted(ids: string[]): string[] {
  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
}

/**
 * Builds the three required alert lists from per-patient computed risk.
 *
 * Output lists:
 * - `high_risk_patients`: `flags.highRisk === true`
 * - `fever_patients`: `flags.fever === true`
 * - `data_quality_issues`: `flags.dataQualityIssue === true`
 */
export function buildAlertLists(computed: ComputedPatientRisk[]): AlertLists {
  const highRisk: string[] = [];
  const fever: string[] = [];
  const dq: string[] = [];

  for (const p of computed) {
    if (p.flags.highRisk) highRisk.push(p.patientId);
    if (p.flags.fever) fever.push(p.patientId);
    if (p.flags.dataQualityIssue) dq.push(p.patientId);
  }

  return {
    high_risk_patients: uniqSorted(highRisk),
    fever_patients: uniqSorted(fever),
    data_quality_issues: uniqSorted(dq),
  };
}
