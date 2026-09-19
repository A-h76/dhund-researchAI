/** Stub ExtractionMatrixService for ResearchRunCoordinator unit/integration harnesses. */
export function stubExtractionMatrix(overrides?: {
  readonly dispatchCellsForRun?: jest.Mock;
  readonly areCellsTerminal?: jest.Mock;
  readonly finalizeExtractionRunIfReady?: jest.Mock;
}): {
  dispatchCellsForRun: jest.Mock;
  areCellsTerminal: jest.Mock;
  finalizeExtractionRunIfReady: jest.Mock;
} {
  return {
    dispatchCellsForRun:
      overrides?.dispatchCellsForRun ?? jest.fn().mockResolvedValue(0),
    areCellsTerminal: overrides?.areCellsTerminal ?? jest.fn().mockResolvedValue(true),
    finalizeExtractionRunIfReady:
      overrides?.finalizeExtractionRunIfReady ?? jest.fn().mockResolvedValue(undefined),
  };
}
