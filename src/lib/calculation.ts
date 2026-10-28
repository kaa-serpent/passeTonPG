import type { Calculation, Entry, KeyRanking, Project } from "./types";
import { pinCountValid, normalizeCylinderSettings } from "./types";

function validateSettings(project: Project): void {
  if (!pinCountValid(project.pinCount, project.cylinderType)) {
    throw new Error(project.cylinderType === "disque" ? "Le projet doit comporter entre 5 et 11 disques." : "Le projet doit comporter 5 ou 6 goupilles.");
  }
  if (!Number.isInteger(project.min) || !Number.isInteger(project.max) ||
      project.min < 0 || project.max > 9 || project.min > project.max) {
    throw new Error("La plage doit être comprise entre 0 et 9, dans l’ordre croissant.");
  }
  if (project.cylinderType !== "disque" && project.macs !== null && (!Number.isInteger(project.macs) || project.macs < 0)) {
    throw new Error("Le MACS doit être un entier positif ou nul, ou rester vide.");
  }
}

/** Exact candidate count and one ordered page; never materializes the full code set. */
export function calculate(project: Project, offset = 0, limit = 50): Calculation {
  validateSettings(project);
  const { macs } = normalizeCylinderSettings(project);
  const cylinders = project.entries.filter((entry) => entry.type === "cylinder");
  const range = Array.from({ length: project.max - project.min + 1 }, (_, index) => project.min + index);
  const common = Array.from({ length: project.pinCount }, (_, index) =>
    range.filter((value) => cylinders.every((cylinder) => {
      const accepted = cylinder.positions[index];
      return accepted == null || accepted.includes(value);
    })),
  );
  const ready = cylinders.length >= 2;
  const provisional = cylinders.some((cylinder) =>
    Array.from({ length: project.pinCount }, (_, index) => cylinder.positions[index] == null).some(Boolean),
  );
  const emptyPositions = common.flatMap((values, index) => values.length === 0 ? [index + 1] : []);
  const start = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
  const pageSize = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 50;
  const result: Calculation = {
    ready, total: 0, codes: [], offset: start, provisional, common, emptyPositions, macsBlocked: false,
  };
  if (!ready || emptyPositions.length > 0) return result;

  // At most pinCount × 11 memoized states, regardless of the number of candidates.
  const memo = new Map<string, number>();
  const allowed = (previous: number | null, next: number) =>
    previous === null || macs === null || Math.abs(next - previous) <= macs;
  const countSuffix = (position: number, previous: number | null): number => {
    if (position === project.pinCount) return 1;
    const memoKey = `${position}:${previous ?? "start"}`;
    const cached = memo.get(memoKey);
    if (cached !== undefined) return cached;
    let count = 0;
    for (const value of common[position]) {
      if (allowed(previous, value)) count += countSuffix(position + 1, value);
    }
    memo.set(memoKey, count);
    return count;
  };
  result.total = countSuffix(0, null);
  result.macsBlocked = result.total === 0;
  if (start >= result.total || pageSize === 0) return result;

  let remainingSkip = start;
  const collect = (position: number, previous: number | null, prefix: string): void => {
    if (result.codes.length >= pageSize) return;
    if (position === project.pinCount) {
      result.codes.push(prefix);
      return;
    }
    for (const value of common[position]) {
      if (!allowed(previous, value)) continue;
      const subtreeSize = countSuffix(position + 1, value);
      if (remainingSkip >= subtreeSize) {
        remainingSkip -= subtreeSize;
        continue;
      }
      collect(position + 1, value, prefix + String(value));
      if (result.codes.length >= pageSize) return;
    }
  };
  collect(0, null, "");
  return result;
}

function classify(key: Entry, cylinder: Entry, pinCount: number): "compatible" | "incompatible" | "unknown" {
  let uncertain = false;
  for (let position = 0; position < pinCount; position += 1) {
    const cut = key.positions[position];
    const accepted = cylinder.positions[position];
    if (!cut || cut.length !== 1 || accepted == null) {
      uncertain = true;
      continue;
    }
    // A known mismatch is decisive, even when another position is unknown.
    if (!accepted.includes(cut[0])) return "incompatible";
  }
  return uncertain ? "unknown" : "compatible";
}

export function rankKeys(project: Project): KeyRanking[] {
  validateSettings(project);
  const { macs } = normalizeCylinderSettings(project);
  const cylinders = project.entries.filter((entry) => entry.type === "cylinder");
  return project.entries.filter((entry) => entry.type === "key").map((entry): KeyRanking => {
    const cuts = entry.positions.slice(0, project.pinCount);
    const complete = cuts.length === project.pinCount && cuts.every((cut) => cut?.length === 1 &&
      Number.isInteger(cut[0]) && cut[0] >= project.min && cut[0] <= project.max);
    const macsValid = complete && (macs === null || cuts.every((cut, index) =>
      index === 0 || Math.abs(cut![0] - cuts[index - 1]![0]) <= macs!,
    ));
    const matches = cylinders.map((cylinder) => ({
      id: cylinder.id,
      name: cylinder.name,
      status: classify(entry, cylinder, project.pinCount),
    }));
    // Known keys are analyzed independently, even if no common PG exists.
    // MACS warnings describe the model, not observed compatibility.
    const pgStatus: KeyRanking["pgStatus"] = matches.some((match) => match.status === "incompatible")
      ? "excluded"
      : cylinders.length < 2 ? "insufficient"
      : matches.every((match) => match.status === "compatible") ? "compatible" : "possible";
    return {
      entry,
      pgStatus,
      confirmed: matches.filter((match) => match.status === "compatible").length,
      possible: matches.filter((match) => match.status === "unknown").length,
      incompatible: matches.filter((match) => match.status === "incompatible").length,
      macsValid,
      cylinders: matches,
    };
  }).sort((first, second) => second.confirmed - first.confirmed || second.possible - first.possible);
}
