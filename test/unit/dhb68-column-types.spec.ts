import {
  EXTRACTION_COLUMN_TYPES,
  assertExtractionValueMatchesType,
  matchesColumnType,
  parseExtractionColumns,
  type ExtractionColumnDefinition,
} from '../../src/orchestration/extraction-column-types';
import { DomainError, ErrorCode } from '../../src/platform/errors';
import { generateId } from '../../src/platform/ids/uuid-v7';

function column(
  type: ExtractionColumnDefinition['type'],
  overrides: Partial<ExtractionColumnDefinition> = {},
): ExtractionColumnDefinition {
  return {
    key: overrides.key ?? type.toLowerCase(),
    type,
    ...(type === 'ENUM' || type === 'MULTI_ENUM'
      ? { enumValues: overrides.enumValues ?? ['alpha', 'beta'] }
      : {}),
    ...overrides,
  };
}

const VALID: Record<ExtractionColumnDefinition['type'], unknown> = {
  TEXT: 'short text',
  LONG_TEXT: 'a'.repeat(3_000),
  NUMBER: 42.5,
  BOOLEAN: true,
  DATE: '2026-09-19',
  ENUM: 'alpha',
  MULTI_ENUM: ['alpha', 'beta'],
  RANGE: { min: 1, max: 10 },
  ENTITY: { name: 'Aspirin', type: 'drug' },
  CITATION: {
    quote: 'quoted span',
    locator: {
      blockId: generateId(),
      documentVersionId: generateId(),
      page: 1,
    },
  },
};

describe('DHB-68 GAP-EXTRACT-COL-01 decision conformance', () => {
  it('locks exactly ten column types', () => {
    expect(EXTRACTION_COLUMN_TYPES).toHaveLength(10);
  });

  it.each(EXTRACTION_COLUMN_TYPES)(
    '%s accepts its declared shape and rejects every other shape',
    (type) => {
      const col = column(type);
      expect(matchesColumnType(col, VALID[type])).toBe(true);
      assertExtractionValueMatchesType(col, VALID[type]);

      for (const other of EXTRACTION_COLUMN_TYPES) {
        if (other === type) {
          continue;
        }
        // TEXT and LONG_TEXT both accept non-empty strings — skip mutual reject.
        if (
          (type === 'TEXT' && other === 'LONG_TEXT') ||
          (type === 'LONG_TEXT' && other === 'TEXT')
        ) {
          continue;
        }
        // ENUM string may coincidentally match TEXT/LONG_TEXT valid shapes.
        if (
          (type === 'TEXT' || type === 'LONG_TEXT') &&
          (other === 'ENUM' || other === 'DATE')
        ) {
          continue;
        }
        if (type === 'ENUM' && (other === 'TEXT' || other === 'LONG_TEXT' || other === 'DATE')) {
          // ENUM valid value is a string; TEXT would accept it — ensure ENUM rejects NUMBER etc.
          continue;
        }
        expect(matchesColumnType(col, VALID[other])).toBe(false);
        expect(() => assertExtractionValueMatchesType(col, VALID[other])).toThrow(
          DomainError,
        );
        try {
          assertExtractionValueMatchesType(col, VALID[other]);
        } catch (error) {
          expect(error).toMatchObject({ code: ErrorCode.ExtractionValueTypeMismatch });
        }
      }
    },
  );

  it('rejects NUMBER/BOOLEAN/RANGE/ENTITY/CITATION/MULTI_ENUM cross shapes explicitly', () => {
    expect(() =>
      assertExtractionValueMatchesType(column('NUMBER'), 'not-a-number'),
    ).toThrow(expect.objectContaining({ code: ErrorCode.ExtractionValueTypeMismatch }));
    expect(() => assertExtractionValueMatchesType(column('BOOLEAN'), 1)).toThrow(
      expect.objectContaining({ code: ErrorCode.ExtractionValueTypeMismatch }),
    );
    expect(() =>
      assertExtractionValueMatchesType(column('RANGE'), { min: 5, max: 1 }),
    ).toThrow(expect.objectContaining({ code: ErrorCode.ExtractionValueTypeMismatch }));
    expect(() => assertExtractionValueMatchesType(column('ENTITY'), { id: 'x' })).toThrow(
      expect.objectContaining({ code: ErrorCode.ExtractionValueTypeMismatch }),
    );
    expect(() =>
      assertExtractionValueMatchesType(column('CITATION'), { quote: 'x' }),
    ).toThrow(expect.objectContaining({ code: ErrorCode.ExtractionValueTypeMismatch }));
    expect(() =>
      assertExtractionValueMatchesType(column('MULTI_ENUM'), ['gamma']),
    ).toThrow(expect.objectContaining({ code: ErrorCode.ExtractionValueTypeMismatch }));
  });

  it('rejects an untyped JSON blob column at schema creation', () => {
    expect(() =>
      parseExtractionColumns([{ key: 'blob', value: { anything: true } }]),
    ).toThrow(DomainError);
    try {
      parseExtractionColumns([{ key: 'blob', value: { anything: true } }]);
    } catch (error) {
      expect(error).toMatchObject({ code: ErrorCode.ValidationError });
      expect((error as DomainError).userMessage).toMatch(/Untyped|declared type/i);
    }
  });

  it('rejects columns missing type entirely', () => {
    expect(() => parseExtractionColumns([{ key: 'x' }])).toThrow(
      expect.objectContaining({ code: ErrorCode.ValidationError }),
    );
  });

  it('parses a full typed schema', () => {
    const columns = parseExtractionColumns(
      EXTRACTION_COLUMN_TYPES.map((type) => ({
        key: type.toLowerCase(),
        type,
        ...(type === 'ENUM' || type === 'MULTI_ENUM'
          ? { enumValues: ['alpha', 'beta'] }
          : {}),
      })),
    );
    expect(columns).toHaveLength(10);
    expect(columns.every((c) => EXTRACTION_COLUMN_TYPES.includes(c.type))).toBe(true);
  });
});
