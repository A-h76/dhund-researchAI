export interface ProcessorReadinessProbe {
  hasProcessors(): boolean;
}

export const PROCESSOR_READINESS = Symbol('PROCESSOR_READINESS');
