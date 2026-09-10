export const LAS_PINAS_CITY = "Las Piñas City";

export const LAS_PINAS_BARANGAYS = [
  "Almanza Uno",
  "Almanza Dos",
  "B. F. International Village",
  "Daniel Fajardo",
  "Elias Aldana",
  "Ilaya",
  "Manuyo Uno",
  "Manuyo Dos",
  "Pamplona Uno",
  "Pamplona Dos",
  "Pamplona Tres",
  "Pilar",
  "Pulang Lupa Uno",
  "Pulang Lupa Dos",
  "Talon Uno",
  "Talon Dos",
  "Talon Tres",
  "Talon Kuatro",
  "Talon Singko",
  "Zapote"
] as const;

export type LasPinasBarangay = (typeof LAS_PINAS_BARANGAYS)[number];

export const LAS_PINAS_BOUNDS = {
  south: 14.38,
  north: 14.53,
  west: 120.94,
  east: 121.06
} as const;

const normalizedBarangay = (value: string): string => value
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]/gi, "")
  .toLowerCase();

export function isLasPinasBarangay(value: string): value is LasPinasBarangay {
  const normalized = normalizedBarangay(value);
  return LAS_PINAS_BARANGAYS.some((barangay) => normalizedBarangay(barangay) === normalized);
}

export function buildLasPinasAddress(streetAddress: string, barangay: string): string {
  const street = streetAddress.trim().replace(/\s+/g, " ");
  if (!street || !isLasPinasBarangay(barangay)) return street;
  return `${street}, ${barangay}, ${LAS_PINAS_CITY}`;
}

export function parseLasPinasAddress(address = ""): { streetAddress: string; barangay: LasPinasBarangay | "" } {
  const value = String(address).trim();
  const barangay = LAS_PINAS_BARANGAYS.find((candidate) => (
    normalizedBarangay(value).includes(normalizedBarangay(candidate))
  ));
  if (!barangay) {
    return {
      streetAddress: value
        .replace(/,?\s*Las\s+Pi(?:ñ|n)as(?:\s+City)?(?:\s+\d{4})?\s*$/i, "")
        .trim(),
      barangay: ""
    };
  }
  const index = value.toLowerCase().indexOf(barangay.toLowerCase());
  return {
    streetAddress: value.slice(0, index).replace(/,?\s*(?:barangay|brgy\.?)[\s,]*$/i, "").replace(/,\s*$/, "").trim(),
    barangay
  };
}

export function isWithinLasPinasBounds(location: { lat?: unknown; lng?: unknown } | null | undefined): boolean {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= LAS_PINAS_BOUNDS.south
    && lat <= LAS_PINAS_BOUNDS.north
    && lng >= LAS_PINAS_BOUNDS.west
    && lng <= LAS_PINAS_BOUNDS.east;
}
