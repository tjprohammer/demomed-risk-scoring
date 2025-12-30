# Healthcare API Assessment

## 1. Assessment Context

API: DemoMed Healthcare API (a fictional system for coding evaluation)

Your Role: Demonstrate API integration and data processing skills.

Goal: Show how you handle real-world API challenges and data inconsistencies.

NOTE: This is simulated test data created specifically for assessment purposes only.

## 2. Your API Key

A unique API key has been automatically generated for this session. You will need this key to authenticate with the API endpoints.

Your API Key:

```
YOUR_API_KEY_HERE
```

Authentication

All API requests require authentication using the `x-api-key` header:

Headers:

```json
{ "x-api-key": "YOUR_API_KEY" }
```

## 3. API Information

Base URL: `https://assessment.ksensetech.com/api`

API Behavior (Important!)

This API simulates real-world conditions:

- Rate limiting: May return `429` errors if you make requests too quickly.
- Intermittent failures: ~8% chance of `500/503` errors (requires retry logic).
- Pagination: Returns 5 patients per page by default (~10 pages, ~50 patients total).
- Inconsistent responses: Occasionally returns data in different formats or with missing fields.

### Endpoint Details

Retrieve patient list

`GET /api/patients`

Headers

- `x-api-key` (string, required): API key for authentication and access control

Query parameters

- `page` (string, optional): The page index. Default: `1`
- `limit` (string, optional): How many resources to return in each list page. Default: `5`, maximum: `20`

Example Usage:

```bash
curl -X GET "https://assessment.ksensetech.com/api/patients?page=1&limit=10" \
  -H "x-api-key: your-api-key-here"
```

Response:

```json
{
  "data": [
    {
      "patient_id": "DEMO001",
      "name": "TestPatient, John",
      "age": 45,
      "gender": "M",
      "blood_pressure": "120/80",
      "temperature": 98.6,
      "visit_date": "2024-01-15",
      "diagnosis": "Sample_Hypertension",
      "medications": "DemoMed_A 10mg, TestDrug_B 500mg"
    },
    {
      "patient_id": "DEMO002",
      "name": "AssessmentUser, Jane",
      "age": 67,
      "gender": "F",
      "blood_pressure": "140/90",
      "temperature": 99.2,
      "visit_date": "2024-01-16",
      "diagnosis": "Eval_Diabetes",
      "medications": "FakeMed 1000mg"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 5,
    "total": 50,
    "totalPages": 10,
    "hasNext": true,
    "hasPrevious": false
  },
  "metadata": {
    "timestamp": "2025-07-15T23:01:05.059Z",
    "version": "v1.0",
    "requestId": "123"
  }
}
```

## 4. Your Task: Implement Risk Scoring

Create a patient risk scoring system. The total risk is the sum of scores from each category.

### Blood Pressure Risk

Note: If systolic and diastolic readings fall into different risk categories, use the higher risk stage for scoring.

- Normal (Systolic <120 AND Diastolic <80): 1 points
- Elevated (Systolic 120‑129 AND Diastolic <80): 2 points
- Stage 1 (Systolic 130‑139 OR Diastolic 80‑89): 3 points
- Stage 2 (Systolic ≥140 OR Diastolic ≥90): 4 points

Invalid/Missing Data (0 points):

- Missing systolic or diastolic values (e.g., "150/" or "/90")
- Non-numeric values (e.g., "INVALID", "N/A")
- Null, undefined, or empty values

### Temperature Risk

- Normal (≤99.5°F): 0 points
- Low Fever (99.6-100.9°F): 1 point
- High Fever (≥101.0°F): 2 points

Invalid/Missing Data (0 points):

- Non-numeric values (e.g., "TEMP_ERROR", "invalid")
- Null, undefined, or empty values

### Age Risk

- Under 40 (<40 years): 1 points
- 40-65 (40-65 years, inclusive): 1 point
- Over 65 (>65 years): 2 points

Invalid/Missing Data (0 points):

- Null, undefined, or empty values
- Non-numeric strings (e.g., "fifty-three", "unknown")

Total Risk Score = (BP Score) + (Temp Score) + (Age Score)

## 5. Required Outputs

Alert Lists: Your system should identify patients who meet specific criteria:

### High-Risk Patients (`high_risk_patients`)

Include the patient’s `patient_id` if:

- The patient has a valid `patient_id`, and
- Total Risk Score is **≥ 4**, where:

  Total Risk Score = (BP Score) + (Temp Score) + (Age Score)

Notes:

- “High risk” is based on the **sum** of category scores.
- Invalid/missing category inputs contribute **0** points for that category, but the patient can still be considered high-risk if the remaining categories bring the total to **≥ 4**.

### Fever Patients (`fever_patients`)

Include the patient’s `patient_id` if:

- Temperature is **valid numeric data**, and
- Temperature is **≥ 99.6°F**

Notes:

- If temperature is missing, null, empty, or non-numeric (e.g., `"TEMP_ERROR"`), it is treated as invalid and the patient should **not** be included in `fever_patients`.
- Fever membership is independent of the total risk score.

### Data Quality Issues (`data_quality_issues`)

Include the patient’s `patient_id` if **any** of the following are invalid/missing:

- Blood pressure
  - Missing systolic or diastolic (e.g., `"150/"`, `"/90"`)
  - Non-numeric values (e.g., `"INVALID"`, `"N/A"`)
  - Null/undefined/empty
- Temperature
  - Non-numeric values (e.g., `"TEMP_ERROR"`, `"invalid"`)
  - Null/undefined/empty
- Age
  - Null/undefined/empty
  - Non-numeric strings (e.g., `"fifty-three"`, `"unknown"`)

Notes:

- This list is about **data validity**, not about score thresholds.
- A patient can appear in multiple lists (e.g., high-risk and also data-quality-issue).

### Example output JSON

Your final payload must be exactly this shape:

```json
{
  "high_risk_patients": ["DEMO002", "DEMO031"],
  "fever_patients": ["DEMO005", "DEMO021"],
  "data_quality_issues": ["DEMO004", "DEMO007"]
}
```

## 6. Deliverables & Submission

You must submit your results by making a POST request to the assessment API.

Submission Attempts

You have 3 attempts to submit your assessment. Each submission provides immediate feedback to help you improve your score.

Submit Alert List

`POST /api/submit-assessment`

Headers

- `x-api-key` (string, required): API key for authentication and access control

Request body parameters

Encoding type: `application/json`

Schema

- `high_risk_patients` (string[], required): Array of patient IDs with total risk score ≥ 4
- `fever_patients` (string[], required): Array of patient IDs with temperature ≥ 99.6°F
- `data_quality_issues` (string[], required): Array of patient IDs with invalid/missing data

How to Submit (Example)

```bash
curl -X POST https://assessment.ksensetech.com/api/submit-assessment \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "high_risk_patients": ["DEMO002", "DEMO031"],
    "fever_patients": ["DEMO005", "DEMO021"],
    "data_quality_issues": ["DEMO004", "DEMO007"]
  }'
```

Response (example):

```json
{
  "success": true,
  "message": "Assessment submitted successfully",
  "results": {
    "score": 91.94,
    "percentage": 92,
    "status": "PASS",
    "breakdown": {
      "high_risk": {
        "score": 48,
        "max": 50,
        "correct": 20,
        "submitted": 21,
        "matches": 20
      },
      "fever": {
        "score": 19,
        "max": 25,
        "correct": 9,
        "submitted": 7,
        "matches": 7
      },
      "data_quality": {
        "score": 25,
        "max": 25,
        "correct": 8,
        "submitted": 8,
        "matches": 8
      }
    },
    "feedback": {
      "strengths": ["✅ Data quality issues: Perfect score (8/8)"],
      "issues": [
        "🔄 High-risk patients: 20/20 correct, but 1 incorrectly included",
        "🔄 Fever patients: 7/9 correct, but 2 missed"
      ]
    },
    "attempt_number": 1,
    "remaining_attempts": 2,
    "is_personal_best": true,
    "can_resubmit": true
  }
}
```
