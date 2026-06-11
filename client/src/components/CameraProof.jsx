import { useEffect, useRef, useState } from "react";

export default function CameraProof({ onCapture, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState("");

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
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob((blob) => blob && onCapture(blob), "image/jpeg", 0.86);
  };

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
          </div>
          <div className="modal-footer">
            <button className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-danger" disabled={Boolean(error)} onClick={capture}>Capture photo</button>
          </div>
        </div>
      </div>
    </div>
  );
}
