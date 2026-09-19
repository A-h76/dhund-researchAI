import { DomainError, ErrorCode } from '../platform/errors';
import { isNonEmptyLocatorObject, parseStructureLocator } from '../evidence/locator';

const MODULE = 'orchestration';

/**
 * GAP-EXTRACT-COL-01 — ten locked column types. Untyped JSON blobs are rejected.
 */
export const EXTRACTION_COLUMN_TYPES = [
  'TEXT',
  'LONG_TEXT',
  'NUMBER',
  'BOOLEAN',
  'DATE',
  'ENUM',
  'MULTI_ENUM',
  'RANGE',
  'ENTITY',
  'CITATION',
] as const;

export type ExtractionColumnTypeName = (typeof EXTRACTION_COLUMN_TYPES)[number];

export function isExtractionColumnType(value: unknown): value is ExtractionColumnTypeName {
  return (
    typeof value === 'string' &&
    (EXTRACTION_COLUMN_TYPES as readonly string[]).includes(value)
  );
}

export interface ExtractionColumnDefinition {
  readonly key: string;
  readonly type: ExtractionColumnTypeName;
  readonly label?: string;
  readonly enumValues?: readonly string[];
}

export type ExtractionCellValue =
  | string
  | number
  | boolean
  | readonly string[]
  | { readonly min: number; readonly max: number }
  | { readonly name: string; readonly type?: string }
  | {
      readonly quote: string;
      readonly locator: {
        readonly blockId: string;
        readonly documentVersionId: string;
        readonly page: number;
      };
    };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.+-Z]+)?$/;

/**
 * Parse and validate schema `columns` JSON. Rejects bare/untyped blobs.
 */
export function parseExtractionColumns(raw: unknown): readonly ExtractionColumnDefinition[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new DomainError(ErrorCode.ValidationError, {
      module: MODULE,
      userMessage: 'Extraction schema columns must be a non-empty array.',
    });
  }

  const seen = new Set<string>();
  const columns: ExtractionColumnDefinition[] = [];

  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new DomainError(ErrorCode.ValidationError, {
        module: MODULE,
        userMessage: 'Each extraction column must be an object with a declared type.',
      });
    }

    const record = entry as Record<string, unknown>;

    // Bare JSON blob / untyped column — reject at schema creation (GAP-EXTRACT-COL-01).
    if (!('type' in record) || record.type === undefined || record.type === null) {
      throw new DomainError(ErrorCode.ValidationError, {
        module: MODULE,
        userMessage: 'Untyped extraction columns are rejected; every column requires a declared type.',
      });
    }

    if (!isExtractionColumnType(record.type)) {
      throw new DomainError(ErrorCode.ValidationError, {
        module: MODULE,
        userMessage: `Unknown extraction column type "${String(record.type)}".`,
      });
    }

    if (typeof record.key !== 'string' || record.key.trim().length === 0) {
      throw new DomainError(ErrorCode.ValidationError, {
        module: MODULE,
        userMessage: 'Each extraction column requires a non-empty key.',
      });
    }

    const key = record.key.trim();
    if (seen.has(key)) {
      throw new DomainError(ErrorCode.ValidationError, {
        module: MODULE,
        userMessage: `Duplicate extraction column key "${key}".`,
      });
    }
    seen.add(key);

    const type = record.type;
    const enumValues = parseEnumValues(record.enumValues, type);
    const label =
      typeof record.label === 'string' && record.label.trim().length > 0
        ? record.label.trim()
        : undefined;

    columns.push({
      key,
      type,
      ...(label !== undefined ? { label } : {}),
      ...(enumValues !== undefined ? { enumValues } : {}),
    });
  }

  return columns;
}

/**
 * Accept the declared shape; reject every other shape with extraction_value_type_mismatch.
 */
export function assertExtractionValueMatchesType(
  column: ExtractionColumnDefinition,
  value: unknown,
): asserts value is ExtractionCellValue {
  if (!matchesColumnType(column, value)) {
    throw new DomainError(ErrorCode.ExtractionValueTypeMismatch, {
      module: MODULE,
      userMessage: `Value does not match column type ${column.type} for key "${column.key}".`,
    });
  }
}

export function matchesColumnType(
  column: ExtractionColumnDefinition,
  value: unknown,
): boolean {
  switch (column.type) {
    case 'TEXT':
      return isNonEmptyString(value) && value.length <= 2_000;
    case 'LONG_TEXT':
      return isNonEmptyString(value);
    case 'NUMBER':
      return typeof value === 'number' && Number.isFinite(value);
    case 'BOOLEAN':
      return typeof value === 'boolean';
    case 'DATE':
      return isNonEmptyString(value) && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));
    case 'ENUM':
      return (
        isNonEmptyString(value) &&
        (column.enumValues?.includes(value) ?? false)
      );
    case 'MULTI_ENUM':
      return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every(
          (item) =>
            isNonEmptyString(item) && (column.enumValues?.includes(item) ?? false),
        )
      );
    case 'RANGE':
      return isRangeValue(value);
    case 'ENTITY':
      return isEntityValue(value);
    case 'CITATION':
      return isCitationValue(value);
    default: {
      const _exhaustive: never = column.type;
      return _exhaustive;
    }
  }
}

/**
 * Parse model output into a typed value. TEXT/LONG_TEXT may be raw strings;
 * structured types require JSON.
 */
export function parseExtractionCellOutput(
  column: ExtractionColumnDefinition,
  raw: string,
): unknown {
  const trimmed = raw.trim();
  if (column.type === 'TEXT' || column.type === 'LONG_TEXT') {
    if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) {
      try {
        return JSON.parse(trimmed) as unknown;
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new DomainError(ErrorCode.ExtractionValueTypeMismatch, {
      module: MODULE,
      userMessage: `Value does not match column type ${column.type} for key "${column.key}".`,
    });
  }
}

function parseEnumValues(
  raw: unknown,
  type: ExtractionColumnTypeName,
): readonly string[] | undefined {
  if (type !== 'ENUM' && type !== 'MULTI_ENUM') {
    return undefined;
  }
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isNonEmptyString)) {
    throw new DomainError(ErrorCode.ValidationError, {
      module: MODULE,
      userMessage: `${type} columns require a non-empty enumValues string array.`,
    });
  }
  return raw;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRangeValue(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.min === 'number' &&
    Number.isFinite(record.min) &&
    typeof record.max === 'number' &&
    Number.isFinite(record.max) &&
    record.min <= record.max
  );
}

function isEntityValue(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record.name)) {
    return false;
  }
  if (record.type !== undefined && typeof record.type !== 'string') {
    return false;
  }
  return true;
}

function isCitationValue(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record.quote)) {
    return false;
  }
  if (!isNonEmptyLocatorObject(record.locator)) {
    return false;
  }
  return parseStructureLocator(record.locator) !== null;
}
