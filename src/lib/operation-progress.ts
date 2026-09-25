type ProgressFields = {
  status: string;
  stepIndex: number;
  totalSteps: number;
  stepProgress?: number | null;
};

/**
 * Overall completion of a catalog operation, 0–100.
 *
 * stepIndex is the position of the step currently running (1-based). Steps
 * that report stepProgress count as partially done; otherwise the current
 * step is treated as reached, which is how older operations were recorded.
 */
export function operationProgressPercent(
  operation: ProgressFields,
  options: { maxWhileActive?: number } = {},
) {
  if (operation.status === "completed") return 100;
  if (operation.totalSteps <= 0) return 0;
  const reached = operation.stepProgress == null
    ? operation.stepIndex
    : Math.max(operation.stepIndex - 1, 0) +
      Math.min(Math.max(operation.stepProgress, 0), 1);
  return Math.min(
    Math.max(Math.round((reached / operation.totalSteps) * 100), 0),
    options.maxWhileActive ?? 100,
  );
}
