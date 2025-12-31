import { describe, expect, test } from "vitest";
import {
  parseBloodPressure,
  scoreBloodPressure,
  scoreTemperature,
  scoreAge,
  computePatientRisk,
} from "./scoring";

describe("blood pressure parsing", () => {
  test("parses string systolic/diastolic", () => {
    expect(parseBloodPressure("120/80")).toEqual({
      systolic: 120,
      diastolic: 80,
      valid: true,
    });
  });

  test("rejects missing systolic or diastolic", () => {
    expect(parseBloodPressure("150/")).toEqual({
      systolic: null,
      diastolic: null,
      valid: false,
    });
    expect(parseBloodPressure("/90")).toEqual({
      systolic: null,
      diastolic: null,
      valid: false,
    });
  });

  test("parses object form", () => {
    expect(parseBloodPressure({ systolic: 140, diastolic: 90 })).toEqual({
      systolic: 140,
      diastolic: 90,
      valid: true,
    });
  });

  test("parses array form", () => {
    expect(parseBloodPressure([130, 85])).toEqual({
      systolic: 130,
      diastolic: 85,
      valid: true,
    });
  });
});

describe("blood pressure scoring", () => {
  test("normal", () => {
    expect(scoreBloodPressure("119/79")).toEqual({ score: 0, valid: true });
  });

  test("elevated", () => {
    expect(scoreBloodPressure("125/79")).toEqual({ score: 1, valid: true });
  });

  test("stage 1", () => {
    expect(scoreBloodPressure("131/79")).toEqual({ score: 2, valid: true });
    expect(scoreBloodPressure("119/85")).toEqual({ score: 2, valid: true });
  });

  test("stage 2 overrides stage 1 when mixed", () => {
    expect(scoreBloodPressure("150/85")).toEqual({ score: 3, valid: true });
    expect(scoreBloodPressure("135/95")).toEqual({ score: 3, valid: true });
  });

  test("invalid returns 0/invalid", () => {
    expect(scoreBloodPressure("N/A")).toEqual({ score: 0, valid: false });
  });
});

describe("temperature scoring", () => {
  test("normal <= 99.5", () => {
    expect(scoreTemperature(99.5).score).toBe(0);
    expect(scoreTemperature(99.5).fever).toBe(false);
  });

  test("low fever 99.6-100.9", () => {
    const s = scoreTemperature("99.6F");
    expect(s.score).toBe(1);
    expect(s.fever).toBe(true);
  });

  test("high fever >= 101.0", () => {
    const s = scoreTemperature(101);
    expect(s.score).toBe(2);
    expect(s.fever).toBe(true);
  });

  test("invalid is 0/invalid", () => {
    expect(scoreTemperature("TEMP_ERROR")).toEqual({
      score: 0,
      valid: false,
      fever: false,
      temp: null,
    });
  });
});

describe("age scoring", () => {
  test("<40 is 0 points", () => {
    expect(scoreAge(39)).toMatchObject({ score: 0, valid: true });
  });

  test("40-65 is 1 point", () => {
    expect(scoreAge(65)).toMatchObject({ score: 1, valid: true });
  });

  test(">65 is 2 points", () => {
    expect(scoreAge(66)).toMatchObject({ score: 2, valid: true });
  });

  test("invalid is 0/invalid", () => {
    expect(scoreAge("unknown")).toMatchObject({
      score: 0,
      valid: false,
      age: null,
    });
  });
});

describe("computePatientRisk", () => {
  test("flags high risk when total >=4", () => {
    const r = computePatientRisk({
      patient_id: "DEMOX",
      age: 70,
      temperature: 101,
      blood_pressure: "119/79",
    });
    expect(r?.scores.total).toBe(0 + 2 + 2);
    expect(r?.flags.highRisk).toBe(true);
    expect(r?.flags.fever).toBe(true);
  });

  test("returns null with missing patient id", () => {
    expect(computePatientRisk({ age: 50 })).toBeNull();
  });
});
