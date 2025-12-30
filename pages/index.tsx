import { useMemo, useState } from "react";

type AlertLists = {
  high_risk_patients: string[];
  fever_patients: string[];
  data_quality_issues: string[];
};

type ScoredPatient = {
  patientId: string;
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
  inputs: {
    bloodPressure: unknown;
    temperature: unknown;
    age: unknown;
  };
};

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(
    "https://assessment.ksensetech.com/api"
  );
  const [limit, setLimit] = useState(20);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<AlertLists | null>(null);
  const [scored, setScored] = useState<ScoredPatient[] | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const counts = useMemo(() => {
    if (!alerts) return null;
    return {
      highRisk: alerts.high_risk_patients.length,
      fever: alerts.fever_patients.length,
      dataQuality: alerts.data_quality_issues.length,
    };
  }, [alerts]);

  async function loadAlerts(): Promise<void> {
    setLoading(true);
    setError(null);
    setAlerts(null);
    setScored(null);

    try {
      const headers: Record<string, string> = {};
      if (apiKey.trim()) headers["x-api-key"] = apiKey.trim();
      if (baseUrl.trim()) headers["x-base-url"] = baseUrl.trim();

      const res = await fetch(
        `/alerts?limit=${encodeURIComponent(String(limit))}`,
        {
          method: "GET",
          headers,
        }
      );

      const body = (await res.json()) as unknown;
      if (!res.ok) {
        const msg = (body as any)?.error
          ? String((body as any).error)
          : `HTTP ${res.status}`;
        throw new Error(msg);
      }

      setAlerts(body as AlertLists);
      setLastLoadedAt(new Date().toISOString());
    } catch (e: any) {
      setError(e?.message ? String(e.message) : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }

  async function loadScored(): Promise<void> {
    setLoading(true);
    setError(null);
    setAlerts(null);
    setScored(null);

    try {
      const headers: Record<string, string> = {};
      if (apiKey.trim()) headers["x-api-key"] = apiKey.trim();
      if (baseUrl.trim()) headers["x-base-url"] = baseUrl.trim();

      const res = await fetch(`/scored?limit=${encodeURIComponent(String(limit))}`, {
        method: "GET",
        headers,
      });

      const body = (await res.json()) as any;
      if (!res.ok) {
        const msg = body?.error ? String(body.error) : `HTTP ${res.status}`;
        throw new Error(msg);
      }

      const rows = Array.isArray(body?.data) ? (body.data as ScoredPatient[]) : [];
      setScored(rows);
      setLastLoadedAt(new Date().toISOString());
    } catch (e: any) {
      setError(e?.message ? String(e.message) : "Failed to load scored patients");
    } finally {
      setLoading(false);
    }
  }

  function invalidFields(p: ScoredPatient): string {
    const bad: string[] = [];
    if (!p.flags.bpValid) bad.push("BP");
    if (!p.flags.tempValid) bad.push("Temp");
    if (!p.flags.ageValid) bad.push("Age");
    return bad.length ? bad.join(", ") : "—";
  }

  return (
    <main>
      <h1>DemoMed Risk Scoring</h1>
      <p>
        Load the assessment outputs (alert lists) computed from the DemoMed API.
      </p>

      <section>
        <h2>Inputs</h2>
        <p>
          If you run the server with <code>DEMOMED_API_KEY</code> set, you can
          leave API key blank.
        </p>

        <div>
          <label>
            API Key (optional)
            <br />
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="ak_..."
              style={{ width: "min(640px, 100%)" }}
            />
          </label>
        </div>

        <div style={{ marginTop: 12 }}>
          <label>
            Base URL
            <br />
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              style={{ width: "min(640px, 100%)" }}
            />
          </label>
        </div>

        <div style={{ marginTop: 12 }}>
          <label>
            Page size (1–20)
            <br />
            <input
              type="number"
              min={1}
              max={20}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              style={{ width: 120 }}
            />
          </label>
        </div>

        <div style={{ marginTop: 12 }}>
          <button onClick={() => void loadAlerts()} disabled={loading}>
            {loading ? "Loading…" : "Load alert lists"}
          </button>{" "}
          <button onClick={() => void loadScored()} disabled={loading}>
            {loading ? "Loading…" : "Load scored patients"}
          </button>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Outputs</h2>

        {error ? (
          <p style={{ color: "crimson" }}>
            Error: <code>{error}</code>
          </p>
        ) : null}

        {alerts && counts ? (
          <>
            <p>
              Last loaded: <code>{lastLoadedAt}</code>
            </p>

            <ul>
              <li>
                High-risk (total score ≥ 4): <strong>{counts.highRisk}</strong>
              </li>
              <li>
                Fever (temperature ≥ 99.6°F): <strong>{counts.fever}</strong>
              </li>
              <li>
                Data quality issues: <strong>{counts.dataQuality}</strong>
              </li>
            </ul>

            <h3>High-risk patients</h3>
            <pre>{JSON.stringify(alerts.high_risk_patients, null, 2)}</pre>

            <h3>Fever patients</h3>
            <pre>{JSON.stringify(alerts.fever_patients, null, 2)}</pre>

            <h3>Data quality issues</h3>
            <pre>{JSON.stringify(alerts.data_quality_issues, null, 2)}</pre>
          </>
        ) : null}

        {scored ? (
          <>
            <p>
              Last loaded: <code>{lastLoadedAt}</code>
            </p>

            <p>
              Showing <strong>{scored.length}</strong> patients with computed scores.
            </p>

            <div style={{ overflowX: "auto" }}>
              <table cellPadding={6} style={{ borderCollapse: "collapse", minWidth: 720 }}>
                <thead>
                  <tr>
                    <th align="left">Patient</th>
                    <th align="right">Total</th>
                    <th align="right">BP</th>
                    <th align="right">Temp</th>
                    <th align="right">Age</th>
                    <th align="left">Fever</th>
                    <th align="left">High Risk</th>
                    <th align="left">Data Quality</th>
                    <th align="left">Invalid Fields</th>
                    <th align="left">Raw Inputs (BP / Temp / Age)</th>
                  </tr>
                </thead>
                <tbody>
                  {scored.map((p) => (
                    <tr key={p.patientId}>
                      <td>
                        <code>{p.patientId}</code>
                      </td>
                      <td align="right">
                        <strong>{p.scores.total}</strong>
                      </td>
                      <td align="right">{p.scores.bp}</td>
                      <td align="right">{p.scores.temp}</td>
                      <td align="right">{p.scores.age}</td>
                      <td>{p.flags.fever ? "Yes" : "No"}</td>
                      <td>{p.flags.highRisk ? "Yes" : "No"}</td>
                      <td>{p.flags.dataQualityIssue ? "Yes" : "No"}</td>
                      <td>{invalidFields(p)}</td>
                      <td>
                        <code>
                          {JSON.stringify([
                            p.inputs.bloodPressure,
                            p.inputs.temperature,
                            p.inputs.age,
                          ])}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : alerts ? null : (
          <p>No results loaded yet.</p>
        )}
      </section>
    </main>
  );
}
