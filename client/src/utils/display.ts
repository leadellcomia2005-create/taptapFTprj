import { ORDER_STATUS_LABELS } from "../types/constants";
import type { MenuItem, OrderStatus, TimestampMs } from "../types/domain";

export type CurrencyValue = number | string | null | undefined;
export type MenuPhotoStyle = {
  backgroundImage?: string;
  backgroundPosition?: string;
  backgroundRepeat?: "no-repeat";
  backgroundSize?: "contain";
};

export const currency = (value: CurrencyValue): string => `\u20b1${Number(value || 0).toLocaleString("en-PH")}`;

export const statusLabel = (value: OrderStatus | string): string => ORDER_STATUS_LABELS[value as OrderStatus] || value;

export const menuPhotoStyle = (product: Pick<MenuItem, "image" | "imagePosition">): MenuPhotoStyle => product.image
  ? {
      backgroundImage: `url(${product.image})`,
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      backgroundSize: "contain"
    }
  : { backgroundPosition: product.imagePosition };

export const relativeTime = (timestamp: TimestampMs | string | null | undefined): string => {
  const seconds = Math.max(0, Math.floor((Date.now() - Number(timestamp || 0)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

export const assistantSourceLabel = (source: unknown): string => {
  const value = String(source || "").toLowerCase();
  if (!value || ["assistant", "demo", "openai", "dialogflow", "dialogflow fallback"].includes(value)) return "";
  return String(source);
};
