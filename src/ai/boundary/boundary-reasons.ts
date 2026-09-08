export const BOUNDARY_REFUSAL_REASONS = [
  'declared_clinical',
  'object_storage_bytes_not_ocr',
  'presigned_url_not_ocr',
] as const;

export type BoundaryRefusalReason = (typeof BOUNDARY_REFUSAL_REASONS)[number];
