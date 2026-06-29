import { useEffect, useRef, useState } from "react";

export default function CameraProof({ onCapture, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState("");
  const [handoff, setHandoff] = useState({ customerName: "", signature: "", otp: "" });

  useEffect(() => {
    navigator.mediaDevices?.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
      audio: false
    }).then((stream) => {
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
    }).catch((cameraError) => setError(cameraError.message));
    return () => streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const capture = () => {
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    const sourceWidth = video.videoWidth || 1280;
    const sourceHeight = video.videoHeight || 720;
    const scale = Math.min(1, 960 / sourceWidth);
    canvas.width = Math.round(sourceWidth * scale);
    canvas.height = Math.round(sourceHeight * scale);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => blob && onCapture(blob, handoff), "image/jpeg", 0.72);
  };
  const handoffReady = handoff.customerName.trim() || handoff.signature.trim() || handoff.otp.trim();

  return (
    <div className="modal d-block camera-modal" tabIndex="-1">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Proof of delivery</h5>
            <button type="button" className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body">
            {error ? <div className="alert alert-danger">{error}</div> : <video ref={videoRef} autoPlay playsInline className="w-100 rounded" />}
            <div className="proof-handoff-grid">
              <label className="form-label">Customer name<input className="form-control" value={handoff.customerName} onChange={(event) => setHandoff((current) => ({ ...current, customerName: event.target.value }))} placeholder="Name of receiver" /></label>
              <label className="form-label">Delivery OTP<input className="form-control" value={handoff.otp} onChange={(event) => setHandoff((current) => ({ ...current, otp: event.target.value.replace(/\D/g, "").slice(0, 6) }))} placeholder="6-digit code" /></label>
              <label className="form-label proof-signature">Typed signature<input className="form-control" value={handoff.signature} onChange={(event) => setHandoff((current) => ({ ...current, signature: event.target.value }))} placeholder="Customer signature / initials" /></label>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-danger" disabled={Boolean(error) || !handoffReady} onClick={capture}>Capture photo and handoff</button>
          </div>
        </div>
      </div>
    </div>
  );
}
