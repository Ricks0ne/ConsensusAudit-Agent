// lib/verdict.ts
export type Verdict = {
  mode: string;
  status: 'APPROVED' | 'REJECTED';
  critical_count: number;
  high_count: number;
  findings: { type: string; severity: string; summary: string }[];
  submissionId: string;
  timestamp: string;
  isAppeal: boolean;
  previousVerdictHash: string | null;
  [key: string]: any;
};

/**
 * Single place where a raw model or contract result becomes a verdict.
 * "criticals mean REJECTED" is enforced here, in code — never trusted
 * from a prompt or from contract state alone.
 */
export function normalizeVerdict(raw: any): Pick<Verdict, 'status' | 'critical_count' | 'high_count' | 'findings'> {
  const toCount = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };

  const critical = toCount(raw?.critical_count);
  const high = toCount(raw?.high_count);

  const findings = Array.isArray(raw?.findings)
    ? raw.findings
      .filter((f: any) => f && typeof f === 'object')
      .slice(0, 25)
      .map((f: any) => ({
        type: String(f.type ?? 'Unspecified').slice(0, 200),
        severity: String(f.severity ?? 'Low').slice(0, 32),
        summary: String(f.summary ?? '').slice(0, 600)
      }))
    : [];

  let status = String(raw?.status ?? 'REJECTED').trim().toUpperCase();
  if (status !== 'APPROVED' && status !== 'REJECTED') status = 'REJECTED';
  if (critical > 0 || high > 0) status = 'REJECTED';

  return { status: status as 'APPROVED' | 'REJECTED', critical_count: critical, high_count: high, findings };
}