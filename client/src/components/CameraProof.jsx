import { useEffect, useRef, useState } from "react";

export default function CameraProof({ onCapture, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState("");
  const [handoff, setHandoff] = useState({ customerName: "", signature: "", otp: "" });
  const [captured, setCaptured] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);

  useEffect(() => {
    navigator.mediaDevices?.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    }).then((stream) => {
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
    }).catch((cameraError) => setError(cameraError.message));
    return () => streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => () => {
    if (captured?.url) URL.revokeObjectURL(captured.url);
  }, [captured?.url]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setError("Camera is still preparing. Try again in a moment.");
      return;
    }
    const canvas = document.createElement("canvas");
    const sourceWidth = video.videoWidth || 1280;
    const sourceHeight = video.videoHeight || 720;
    const scale = Math.min(1, 1280 / sourceWidth);
    canvas.width = Math.round(sourceWidth * scale);
    canvas.height = Math.round(sourceHeight * scale);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setError("The proof photo could not be captured. Please try again.");
        return;
      }
      if (captured?.url) URL.revokeObjectURL(captured.url);
      setCaptured({ blob, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height });
    }, "image/jpeg", 0.86);
  };
  const retake = () => {
    if (captured?.url) URL.revokeObjectURL(captured.url);
    setCaptured(null);
  };
  const submit = () => {
    if (captured?.blob) onCapture(captured.blob, handoff);
  };
  const handoffReady = Boolean(handoff.customerName.trim() || handoff.signature.trim());
  const lowQuality = captured && (captured.width < 720 || captured.height < 480);

  return (
    <div className="modal d-block camera-modal" tabIndex="-1">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Proof of delivery</h5>
            <button type="button" className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body">
            {error && <div className="alert alert-danger">{error}</div>}
            {captured
              ? <img className="proof-preview" src={captured.url} alt="Captured delivery proof preview" />
              : <video ref={videoRef} autoPlay playsInline className="w-100 rounded" onLoadedMetadata={() => setCameraReady(true)} />}
            <small className={lowQuality ? "proof-camera-tip warning" : "proof-camera-tip"}>
              {captured
                ? lowQuality ? "Photo is small or unclear. Retake if the delivery handoff is not visible." : "Review the photo before submitting it."
                : cameraReady ? "Point the camera at the handoff or delivered items before capturing." : "Preparing camera..."}
            </small>
            <div className="proof-handoff-grid">
              <label className="form-label">Customer name<input className="form-control" value={handoff.customerName} onChange={(event) => setHandoff((current) => ({ ...current, customerName: event.target.value }))} placeholder="Name of receiver" /></label>
              <label className="form-label">Delivery OTP <small>Optional</small><input className="form-control" value={handoff.otp} onChange={(event) => setHandoff((current) => ({ ...current, otp: event.target.value.replace(/\D/g, "").slice(0, 6) }))} placeholder="6-digit code if provided" /></label>
              <label className="form-label proof-signature">Typed signature<input className="form-control" value={handoff.signature} onChange={(event) => setHandoff((current) => ({ ...current, signature: event.target.value }))} placeholder="Customer signature / initials" /></label>
            </div>
            {!handoffReady && <small className="proof-required-note">Receiver name or typed signature is required before submitting proof.</small>}
          </div>
          <div className="modal-footer">
            <button className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
            {captured && <button className="btn btn-outline-dark" onClick={retake}>Retake</button>}
            {captured
              ? <button className="btn btn-danger" disabled={!handoffReady} onClick={submit}>Submit proof</button>
              : <button className="btn btn-danger" disabled={Boolean(error) || !cameraReady} onClick={capture}>Capture photo</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
