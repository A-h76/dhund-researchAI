import type { EventVersionSchema, FieldSchema, FieldType } from './types';

export class SchemaCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaCompatibilityError';
  }
}

function typeOfValue(value: unknown): FieldType {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'object') {
    return t;
  }
  return 'object';
}

export function validatePayloadAgainstSchema(
  payload: Record<string, unknown>,
  schema: EventVersionSchema,
): void {
  for (const field of schema.fields) {
    const value = payload[field.name];
    if (value === undefined) {
      if (field.required) {
        throw new SchemaCompatibilityError(
          `Missing required field "${field.name}" for schemaVersion ${schema.schemaVersion}`,
        );
      }
      continue;
    }

    const actual = typeOfValue(value);
    if (actual !== field.type) {
      throw new SchemaCompatibilityError(
        `Field "${field.name}" expected type ${field.type}, got ${actual} (schemaVersion ${schema.schemaVersion})`,
      );
    }
  }
}

/**
 * Removing or retyping a payload field at the same schemaVersion is a breaking change.
 * Returns violations when `candidate` is not a compatible same-version evolution of `baseline`.
 */
export function findSameVersionBreaks(
  baseline: readonly FieldSchema[],
  candidate: readonly FieldSchema[],
): readonly string[] {
  const violations: string[] = [];
  const candidateByName = new Map(candidate.map((f) => [f.name, f]));

  for (const base of baseline) {
    const next = candidateByName.get(base.name);
    if (next === undefined) {
      violations.push(`Removed field "${base.name}" at the same schemaVersion`);
      continue;
    }
    if (next.type !== base.type) {
      violations.push(
        `Retyped field "${base.name}" from ${base.type} to ${next.type} at the same schemaVersion`,
      );
    }
    if (base.required && !next.required) {
      violations.push(`Field "${base.name}" changed from required to optional at the same schemaVersion`);
    }
  }

  return violations;
}

/** During a compatibility window, both versions must validate their respective payloads. */
export function assertCompatibilityWindow(
  versions: readonly EventVersionSchema[],
  samples: Readonly<Record<number, Record<string, unknown>>>,
): void {
  for (const version of versions) {
    const sample = samples[version.schemaVersion];
    if (sample === undefined) {
      throw new SchemaCompatibilityError(
        `Missing sample payload for schemaVersion ${version.schemaVersion}`,
      );
    }
    validatePayloadAgainstSchema(sample, version);
  }
}
