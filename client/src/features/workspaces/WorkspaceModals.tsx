import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { getDeliveryProof } from "../../services/firebase/delivery";
import type { DeliveryProof, Order } from "../../types/domain";
import { currency } from "./workspaceHelpers";

interface ReasonModalProps {
  title: string;
  label: string;
  placeholder: string;
  confirmText: string;
  submitting?: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (reason: string) => void | Promise<void>;
}

export function ReasonModal({ title, label, placeholder, confirmText, submitting = false, error = "", onClose, onSubmit }: ReasonModalProps) {
  const [reason, setReason] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reason.trim() || submitting) return;
    await onSubmit(reason.trim());
  };
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return (
    <div className="modal d-block" onMouseDown={(event: MouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-dialog modal-dialog-centered">
        <form className="modal-content reason-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="reason-modal-title">
          <div className="modal-header"><h5 className="modal-title" id="reason-modal-title">{title}</h5><button className="btn-close" type="button" aria-label="Close" onClick={onClose} /></div>
          <div className="modal-body">
            <label className="form-label">{label}<textarea className="form-control" rows={4} autoFocus disabled={submitting} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={placeholder} /></label>
            {error && <div className="alert alert-danger mb-0" role="alert">{error}</div>}
          </div>
          <div className="modal-footer"><button className="btn btn-outline-dark" type="button" disabled={submitting} onClick={onClose}>Close</button><button className="btn btn-danger" disabled={!reason.trim() || submitting}>{submitting ? "Saving..." : confirmText}</button></div>
        </form>
      </div>
    </div>
  );
}

interface DeliveryProofModalProps {
  order: Order;
  onClose: () => void;
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The delivery proof could not be loaded.";
const escapeText = (value: unknown) => String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char] || char);

export function DeliveryProofModal({ order, onClose }: DeliveryProofModalProps) {
  const [proof, setProof] = useState<DeliveryProof | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getDeliveryProof(order)
      .then((result: DeliveryProof | null) => {
        if (active) setProof(result);
      })
      .catch((proofError: unknown) => {
        if (active) setError(errorMessage(proofError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [order]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const handoff = proof?.handoff || order.proofOfDeliveryMeta || {};
  const proofImage = proof?.imageUrl || proof?.downloadUrl || proof?.dataUrl || "";
  const proofStorageLabel = proof?.storageMode === "storage" ? "Optimized storage" : proof?.downloadUrl || order.proofOfDeliveryUrl ? "Photo link" : "Database fallback";
  const capturedAt = handoff.capturedAt || proof?.createdAt || order.deliveredAt || order.updatedAt;
  const riderLabel = order.riderName || proof?.riderName || "Assigned rider";
  const qualityWarning = handoff.photoQualityWarning || proof?.photoQualityWarning || "";
  const printProof = () => {
    if (!proofImage) return;
    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=920,height=720");
    if (!printWindow) {
      setError("Allow popups so the proof can open for printing.");
      return;
    }
    printWindow.document.write(`<!doctype html><html><head><title>Proof ${escapeText(order.id)}</title><style>body{font-family:Arial,sans-serif;margin:28px;color:#211d19}h1{margin:0 0 4px;font-size:28px}.meta{display:grid;grid-template-columns:140px 1fr;gap:8px;margin:22px 0}.meta strong{color:#6d6258}.photo{max-width:100%;max-height:680px;border:1px solid #ddd;border-radius:10px}</style></head><body><h1>Proof of Delivery</h1><p>Order ${escapeText(order.id)}</p><img class="photo" src="${proofImage}" alt="Delivery proof" /><div class="meta"><strong>Customer</strong><span>${escapeText(order.customerName || "Customer")}</span><strong>Receiver</strong><span>${escapeText(handoff.customerName || "Not recorded")}</span><strong>Signature</strong><span>${escapeText(handoff.signature || "Not recorded")}</span><strong>OTP</strong><span>${handoff.otpVerified ? "Verified" : "Not required / not used"}</span><strong>Captured</strong><span>${capturedAt ? escapeText(new Date(capturedAt).toLocaleString("en-PH")) : "No timestamp"}</span><strong>Rider</strong><span>${escapeText(riderLabel)}</span><strong>Total</strong><span>${escapeText(currency(order.total))}</span><strong>Drop-off</strong><span>${escapeText(order.address || "Address not recorded")}</span><strong>Photo check</strong><span>${escapeText(qualityWarning || "No warning")}</span></div><script>window.onload=()=>{window.print();}</script></body></html>`);
    printWindow.document.close();
  };

  return (
    <div className="modal d-block" onMouseDown={(event: MouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-dialog modal-dialog-centered modal-lg">
        <div className="modal-content proof-viewer-modal" role="dialog" aria-modal="true" aria-labelledby="proof-viewer-title">
          <div className="modal-header">
            <div><p className="eyebrow text-danger">Delivery evidence</p><h5 className="modal-title" id="proof-viewer-title">Proof of Delivery</h5><small className="proof-order-id">Order {order.id}</small></div>
            <button className="btn-close" type="button" aria-label="Close" onClick={onClose} />
          </div>
          <div className="modal-body">
            {loading && <div className="empty-chat proof-loading">Loading delivery proof...</div>}
            {error && <div className="alert alert-danger">{error}</div>}
            {!loading && !error && (
              <div className="proof-viewer-layout">
                <figure className="proof-photo-frame"><img src={proofImage} alt={`Delivery proof for ${order.id}`} loading="lazy" /></figure>
                <dl className="proof-detail-grid">
                  <div><dt>Order ID</dt><dd>{order.id}</dd></div>
                  <div><dt>Customer</dt><dd>{order.customerName || handoff.customerName || "Customer"}</dd></div>
                  <div><dt>Order total</dt><dd>{currency(order.total)}</dd></div>
                  <div><dt>Drop-off</dt><dd>{order.address || "Address not recorded"}{order.landmark ? ` - ${order.landmark}` : ""}</dd></div>
                  <div><dt>Receiver</dt><dd>{handoff.customerName || "Not recorded"}</dd></div>
                  <div><dt>Typed signature</dt><dd>{handoff.signature || "Not recorded"}</dd></div>
                  <div><dt>OTP check</dt><dd>{handoff.otpVerified ? "Verified" : "Not required / not used"}</dd></div>
                  <div><dt>Captured</dt><dd>{capturedAt ? new Date(capturedAt).toLocaleString("en-PH") : "No timestamp"}</dd></div>
                  <div><dt>Rider</dt><dd>{riderLabel}</dd></div>
                  <div><dt>Photo storage</dt><dd>{proofStorageLabel}</dd></div>
                  {qualityWarning && <div className="proof-quality-card"><dt>Photo check</dt><dd>{qualityWarning}</dd></div>}
                </dl>
              </div>
            )}
          </div>
          <div className="modal-footer">
            {proofImage && <a className="btn btn-outline-dark" href={proofImage} download={`${order.id}-delivery-proof.jpg`}>Download photo</a>}
            <button className="btn btn-dark" type="button" disabled={!proofImage} onClick={printProof}>Print proof</button>
            <button className="btn btn-outline-dark" type="button" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
