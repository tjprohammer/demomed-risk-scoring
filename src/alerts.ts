import type { AlertLists, ComputedPatientRisk } from "./types";

function uniqSorted(ids: string[]): string[] {
  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
}

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
