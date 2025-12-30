export type PatientId = string;

export type PatientRecord = Record<string, unknown>;

export type AlertLists = {
  high_risk_patients: PatientId[];
  fever_patients: PatientId[];
  data_quality_issues: PatientId[];
};

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

export type ComputedPatientRiskDetails = ComputedPatientRisk & {
  inputs: {
    bloodPressure: unknown;
    temperature: unknown;
    age: unknown;
  };
};
