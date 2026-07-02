export const currency = (value) => `\u20b1${Number(value || 0).toLocaleString("en-PH")}`;

export const statusLabel = (value) => ({
  "pending-payment": "Payment pending",
  received: "Received",
  preparing: "Preparing",
  ready: "Ready",
  "out-for-delivery": "Out for delivery",
  arrived: "Arrived",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled"
}[value] || value);

export const menuPhotoStyle = (product) => product.image
  ? {
      backgroundImage: `url(${product.image})`,
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      backgroundSize: "contain"
    }
  : { backgroundPosition: product.imagePosition };

export const relativeTime = (timestamp) => {
  const seconds = Math.max(0, Math.floor((Date.now() - Number(timestamp || 0)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

export const assistantSourceLabel = (source) => {
  const value = String(source || "").toLowerCase();
  if (!value || ["assistant", "demo", "openai", "dialogflow", "dialogflow fallback"].includes(value)) return "";
  return source;
};
