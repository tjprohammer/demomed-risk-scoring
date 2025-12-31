/**
 * Stable identifier for a patient in the DemoMed dataset.
 *
 * The grader expects arrays of these IDs in the submission payload.
 */
export type PatientId = string;

/**
 * Generic patient record shape.
 *
 * The upstream API is not strictly typed and can contain inconsistent fields,
 * so we model it as an arbitrary object and defensively parse required inputs.
 */
export type PatientRecord = Record<string, unknown>;

/**
 * The exact payload shape required by `/submit-assessment`.
 */
export type AlertLists = {
  high_risk_patients: PatientId[];
  fever_patients: PatientId[];
  data_quality_issues: PatientId[];
};

/**
 * Per-patient scoring output used internally to build alert lists.
 */
export type ComputedPatientRisk = {
  patientId: PatientId;
  scores: {
    bp: number;
    temp: number;
    age: number;
    total: number;
  };
  flags: {
    bpValid: boolean;
    tempValid: boolean;
    ageValid: boolean;
    fever: boolean;
    dataQualityIssue: boolean;
    highRisk: boolean;
  };
};

/**
 * Extended per-patient scoring output including the raw inputs used.
 *
 * Used by the `/scored` endpoint and UI for verification/debugging.
 */
export type ComputedPatientRiskDetails = ComputedPatientRisk & {
  inputs: {
    bloodPressure: unknown;
    temperature: unknown;
    age: unknown;
  };
};
