import { useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import { api } from "../../services/api";
import type { RecoveryIssue, RecoveryPreviewResponse, RecoveryScanResponse } from "../../services/api";
import "./RecoveryPanel.css";

interface RecoveryPanelProps {
  notify: (message: string) => void;
}

const issueLabels: Record<string, string> = {
  incomplete_cancellation: "Incomplete cancellation",
  order_quantity_mismatch: "Order or inventory mismatch",
  failed_notification_delivery: "Failed notification",
  missing_order_aggregate: "Missing report aggregate",
  unresolved_cod_handoff: "Unresolved COD",
  missing_delivery_proof: "Missing delivery proof",
  stock_projection_mismatch: "Stock display mismatch",
  stale_idempotency_claim: "Stale checkout request"
};

function messageFrom(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The recovery check could not be completed.";
}

function recoveryRequestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `recovery-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function RecoveryPanel({ notify }: RecoveryPanelProps) {
  const [scan, setScan] = useState<RecoveryScanResponse | null>(null);
  const [selected, setSelected] = useState<RecoveryIssue | null>(null);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<RecoveryPreviewResponse | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState<"scan" | "preview" | "apply" | "">("");
  const [error, setError] = useState("");

  const loadIssues = async () => {
    setBusy("scan");
    setError("");
    try {
      const result = await api.scanRecoveryIssues(200);
      setScan(result);
      setSelected(null);
      setReason("");
      setPreview(null);
      setConfirmation("");
    } catch (scanError) {
      setError(messageFrom(scanError));
    } finally {
      setBusy("");
    }
  };

  const selectIssue = (issue: RecoveryIssue) => {
    setSelected(issue);
    setReason("");
    setPreview(null);
    setConfirmation("");
    setError("");
  };

  const previewAction = async () => {
    if (!selected || reason.trim().length < 8) return;
    setBusy("preview");
    setError("");
    try {
      setPreview(await api.previewRecoveryAction(selected.id, reason.trim()));
      setConfirmation("");
    } catch (previewError) {
      setError(messageFrom(previewError));
    } finally {
      setBusy("");
    }
  };

  const applyAction = async () => {
    if (!selected || !preview || confirmation !== "APPLY_RECOVERY") return;
    setBusy("apply");
    setError("");
    try {
      const result = await api.applyRecoveryAction({
        issueId: selected.id,
        reason: reason.trim(),
        requestId: recoveryRequestId(),
        previewHash: preview.previewHash,
        confirmation: "APPLY_RECOVERY"
      });
      notify(`Recovery completed for ${result.recordId}. An audit record was saved.`);
      await loadIssues();
    } catch (applyError) {
      setError(messageFrom(applyError));
      setBusy("");
    }
  };

  return (
    <section className="recovery-panel" aria-labelledby="recovery-panel-title">
      <header className="recovery-panel-header">
        <div><p className="eyebrow text-danger">Owner recovery</p><h3 id="recovery-panel-title">Operational exception check</h3><span>Scans recent records without changing data. Only verified safe actions can be applied.</span></div>
        <button className="btn btn-outline-dark" type="button" disabled={Boolean(busy)} onClick={loadIssues}><RefreshCw size={16} className={busy === "scan" ? "spin" : ""} aria-hidden="true" /> {scan ? "Scan again" : "Run dry scan"}</button>
      </header>

      {error && <div className="alert alert-danger recovery-error" role="alert"><AlertTriangle size={17} aria-hidden="true" /><span>{error}</span></div>}

      {!scan && !error && <div className="recovery-empty"><ShieldCheck size={22} aria-hidden="true" /><div><strong>No scan has run</strong><span>Start a bounded, read-only check before reviewing recovery options.</span></div></div>}

      {scan && (
        <>
          <div className="recovery-scan-meta">
            <span><strong>{scan.issues.length}</strong> finding{scan.issues.length === 1 ? "" : "s"}</span>
            <span>Generated {new Date(scan.generatedAt).toLocaleString("en-PH")}</span>
            {scan.truncated && <span className="warning">Result limit reached</span>}
          </div>
          <div className="recovery-issue-list">
            {scan.issues.length === 0 && <div className="recovery-empty success"><CheckCircle2 size={22} aria-hidden="true" /><div><strong>No recovery findings</strong><span>The bounded scan found no supported exceptions.</span></div></div>}
            {scan.issues.map((issue) => (
              <article className={`recovery-issue ${issue.severity}`} key={issue.id}>
                <AlertTriangle size={18} aria-hidden="true" />
                <div><strong>{issueLabels[issue.type] || issue.type}</strong><span>{issue.summary}</span><small>Record {issue.recordId}</small></div>
                {issue.actionable
                  ? <button className="btn btn-outline-danger" type="button" onClick={() => selectIssue(issue)}>Review safe action</button>
                  : <span className="recovery-review-only">Manual review</span>}
              </article>
            ))}
          </div>
        </>
      )}

      {selected && (
        <div className="recovery-action" aria-live="polite">
          <div className="recovery-action-heading"><Wrench size={18} aria-hidden="true" /><div><strong>{issueLabels[selected.type] || selected.type}</strong><span>A reason and fresh dry-run preview are required.</span></div></div>
          <label className="form-label" htmlFor="recovery-reason">Recovery reason<input id="recovery-reason" className="form-control" value={reason} maxLength={240} onChange={(event) => { setReason(event.target.value); setPreview(null); setConfirmation(""); }} placeholder="At least 8 characters; do not include customer details" /></label>
          <div className="recovery-action-buttons">
            <button className="btn btn-outline-secondary" type="button" disabled={Boolean(busy)} onClick={() => setSelected(null)}>Cancel</button>
            <button className="btn btn-dark" type="button" disabled={Boolean(busy) || reason.trim().length < 8} onClick={previewAction}>{busy === "preview" ? "Checking current state..." : "Preview safe action"}</button>
          </div>
          {preview && (
            <div className="recovery-preview">
              <strong>Dry-run result</strong>
              <ul>{preview.changes.map((change) => <li key={change}>{change}</li>)}</ul>
              <label className="form-label" htmlFor="recovery-confirmation">Type APPLY_RECOVERY to confirm<input id="recovery-confirmation" className="form-control" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
              <button className="btn btn-danger" type="button" disabled={Boolean(busy) || confirmation !== "APPLY_RECOVERY"} onClick={applyAction}>{busy === "apply" ? "Applying recovery..." : "Apply audited recovery"}</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
