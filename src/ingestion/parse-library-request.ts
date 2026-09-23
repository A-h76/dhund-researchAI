import { DomainError, ErrorCode } from '../platform/errors';

const MODULE = 'ingestion';

export interface ParsedLibraryFolderWrite {
  readonly name?: string;
  readonly parentFolderId?: string | null;
  readonly position?: number;
}

export interface ParsedLibraryItemCreate {
  readonly documentId: string | null;
  readonly externalRecordId: string | null;
  readonly folderId: string | null;
  readonly position: number;
  readonly note: string | null;
}

export interface ParsedLibraryItemPatch {
  readonly folderId?: string | null;
  readonly position?: number;
  readonly note?: string;
}

export function parseLibraryFolderCreate(body: unknown): {
  name: string;
  parentFolderId: string | null;
  position: number;
} {
  const record = objectBody(body);
  const name = requireName(record);
  return {
    name,
    parentFolderId: optionalId(record.parentFolderId),
    position: optionalPosition(record.position),
  };
}

export function parseLibraryFolderPatch(body: unknown): ParsedLibraryFolderWrite {
  const record = objectBody(body);
  const patch: {
    name?: string;
    parentFolderId?: string | null;
    position?: number;
  } = {};
  if ('name' in record) {
    patch.name = requireName(record);
  }
  if ('parentFolderId' in record) {
    patch.parentFolderId = optionalId(record.parentFolderId);
  }
  if ('position' in record) {
    patch.position = optionalPosition(record.position);
  }
  if (patch.name === undefined && patch.parentFolderId === undefined && patch.position === undefined) {
    throw invalid();
  }
  return patch;
}

export function parseLibraryItemCreate(body: unknown): ParsedLibraryItemCreate {
  const record = objectBody(body);
  if ('documentId' in record && 'externalRecordId' in record) {
    const documentId = optionalId(record.documentId);
    const externalRecordId = optionalId(record.externalRecordId);
    if (documentId !== null && externalRecordId !== null) {
      throw targetInvalid();
    }
  }
  const documentId = 'documentId' in record ? optionalId(record.documentId) : null;
  const externalRecordId =
    'externalRecordId' in record ? optionalId(record.externalRecordId) : null;
  const count = (documentId === null ? 0 : 1) + (externalRecordId === null ? 0 : 1);
  if (count !== 1) {
    throw targetInvalid();
  }
  return {
    documentId,
    externalRecordId,
    folderId: 'folderId' in record ? optionalId(record.folderId) : null,
    position: optionalPosition(record.position),
    note: 'note' in record ? optionalNote(record.note) : null,
  };
}

export function parseLibraryItemPatch(body: unknown): ParsedLibraryItemPatch {
  const record = objectBody(body);
  if ('documentId' in record || 'externalRecordId' in record) {
    throw new DomainError(ErrorCode.ValidationError, {
      module: MODULE,
      userMessage: 'Changing a library item target is rejected.',
    });
  }
  const patch: {
    folderId?: string | null;
    position?: number;
    note?: string;
  } = {};
  if ('folderId' in record) {
    patch.folderId = optionalId(record.folderId);
  }
  if ('position' in record) {
    patch.position = optionalPosition(record.position);
  }
  if ('note' in record) {
    const note = optionalNote(record.note);
    if (note === null) {
      throw invalid();
    }
    patch.note = note;
  }
  if (Object.keys(patch).length === 0) {
    throw invalid();
  }
  return patch;
}

function objectBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new DomainError(ErrorCode.MalformedRequest, { module: MODULE });
  }
  return body as Record<string, unknown>;
}

function requireName(record: Record<string, unknown>): string {
  if (typeof record.name !== 'string' || record.name.trim().length === 0) {
    throw invalid();
  }
  return record.name.trim();
}

function optionalId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalid();
  }
  return value.trim();
}

function optionalPosition(value: unknown): number {
  if (value === undefined) {
    return 0;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw invalid();
  }
  return value;
}

function optionalNote(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw invalid();
  }
  return value;
}

function invalid(): DomainError {
  return new DomainError(ErrorCode.ValidationError, { module: MODULE });
}

function targetInvalid(): DomainError {
  return new DomainError(ErrorCode.LibraryItemTargetInvalid, { module: MODULE });
}
