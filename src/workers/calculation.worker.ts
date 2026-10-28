import { calculate, rankKeys } from "../lib/calculation";
import type { Project } from "../lib/types";

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<{ id: number; project: Project; offset: number }>) => {
  const { id, project, offset } = event.data;
  try {
    scope.postMessage({ id, result: calculate(project, offset, 50), ranking: rankKeys(project) });
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : "Le calcul a échoué." });
  }
};
