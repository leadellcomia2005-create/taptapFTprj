type AnalyticsScalar = string | number | boolean;
type AnalyticsItem = {
  item_id: string;
  item_name: string;
  price: number;
  quantity: number;
};
type AnalyticsPayload = Record<string, AnalyticsScalar | AnalyticsItem[]>;
type AnalyticsStorage = Pick<Storage, "getItem" | "setItem">;

export const analyticsOnceStorageKey = "taptap-analytics-once";

const eventParameters: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  select_content: new Set(["content_type", "item_id", "role"]),
  view_item_list: new Set(["item_list_id", "item_list_name", "source"]),
  sign_up_start: new Set(["method", "source"]),
  sign_up: new Set(["method"]),
  login: new Set(["method", "role"]),
  begin_checkout: new Set(["currency", "value", "items"]),
  checkout_abandoned: new Set(["currency", "value", "items", "reason"]),
  purchase: new Set(["transaction_id", "currency", "value", "items"])
});

function cleanValue(key: string, value: unknown): AnalyticsScalar | AnalyticsItem[] | undefined {
  if (key === "items" && Array.isArray(value)) {
    return value.slice(0, 50).map((item) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        item_id: String(record.item_id || "").slice(0, 128),
        item_name: String(record.item_name || "").slice(0, 120),
        price: Number(record.price || 0),
        quantity: Number(record.quantity || 0)
      };
    });
  }
  if (typeof value === "string") return value.slice(0, 120);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return undefined;
}

export function buildAnalyticsPayload(
  name: string,
  parameters: Record<string, unknown> = {}
): AnalyticsPayload | null {
  const allowed = eventParameters[name];
  if (!allowed) return null;
  const payload: AnalyticsPayload = {};
  for (const key of allowed) {
    const value = cleanValue(key, parameters[key]);
    if (value !== undefined) payload[key] = value;
  }
  return payload;
}

function readOnceRecords(storage: AnalyticsStorage | null): Record<string, number> {
  if (!storage) return {};
  try {
    const value: unknown = JSON.parse(storage.getItem(analyticsOnceStorageKey) || "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, number>
      : {};
  } catch {
    return {};
  }
}

export function hasRecordedAnalyticsEvent(storage: AnalyticsStorage | null, key: string): boolean {
  return Boolean(readOnceRecords(storage)[key]);
}

export function rememberAnalyticsEvent(
  storage: AnalyticsStorage | null,
  key: string,
  timestamp = Date.now()
): boolean {
  if (!storage || !key) return false;
  try {
    const records = readOnceRecords(storage);
    if (records[key]) return false;
    records[key] = timestamp;
    const recent = Object.entries(records)
      .sort(([, first], [, second]) => Number(second) - Number(first))
      .slice(0, 200);
    storage.setItem(analyticsOnceStorageKey, JSON.stringify(Object.fromEntries(recent)));
    return true;
  } catch {
    return false;
  }
}
