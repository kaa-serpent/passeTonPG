export const cylinderTypes = ["paracentrique", "radial", "disque"] as const;
export type CylinderType = typeof cylinderTypes[number];
export const cylinderTypeLabels: Record<CylinderType, string> = { paracentrique: "Paracentrique", radial: "Radial", disque: "Disque" };
export const cylinderTypeLabel = (value: CylinderType | null | undefined) => value ? cylinderTypeLabels[value] : "Non renseigné";
export type PinCount = 5 | 6 | 7 | 8 | 9 | 10 | 11;
export const pinCounts = (type: CylinderType | null | undefined): readonly PinCount[] =>
  type === "disque" ? [5, 6, 7, 8, 9, 10, 11] : [5, 6];
export const pinCountValid = (count: number, type: CylinderType | null | undefined) =>
  pinCounts(type).some((value) => value === count);
export type Position = number[] | null;
export interface Settings {
  pinCount: PinCount;
  min: number;
  max: number;
  macs: number | null;
}
export interface Entry {
  id: string;
  type: "key" | "cylinder";
  name: string;
  description: string;
  positions: Position[];
}
export interface Model extends Settings {
  pdfSource?: {
    file: string;
    sha256: string;
    page: number;
    card: number;
    label: string;
    unit: "inch";
    codes: number[];
    depths: number[];
    firstPin: number;
    pinSpacing: number;
    readDirection: string | null;
    notes: string[];
  };
  measurementSource?: {
    file: string;
    sha256: string;
    sheet: string;
    row: number;
    label: string;
    unit: string;
    depths: number[];
    firstPin: string | number | null;
    pinSpacing: string | number | null;
    cutAngle: number | null;
    macs: string | number | null;
    notice: string;
  };
  cylinderType: CylinderType | null;
  id: string;
  brand: string;
  name: string;
  version: number;
  verified: boolean;
  pendingFields: string[];
}
export interface Project extends Settings {
  cylinderType: CylinderType | null;
  id: string;
  name: string;
  description: string;
  modelId: string | null;
  modelVersion: number | null;
  entries: Entry[];
  revision: number;
  updatedAt: string;
}
export interface User {
  id: string;
  username: string;
  role: "admin" | "user";
  mustChangePassword: boolean;
}
export interface Calculation {
  ready: boolean;
  total: number;
  codes: string[];
  offset: number;
  provisional: boolean;
  common: number[][];
  emptyPositions: number[];
  macsBlocked: boolean;
}
export interface KeyRanking {
  entry: Entry;
  pgStatus: "compatible" | "possible" | "excluded" | "insufficient";
  confirmed: number;
  possible: number;
  incompatible: number;
  macsValid: boolean;
  cylinders: {id: string; name: string; status: "compatible" | "incompatible" | "unknown"}[];
}

/** Disc cylinders have no adjacent-cut constraint, including in older cached data. */
export function normalizeCylinderSettings<T extends Settings & { cylinderType?: CylinderType | null }>(settings: T): T {
  return settings.cylinderType === "disque" ? { ...settings, macs: null } : settings;
}
