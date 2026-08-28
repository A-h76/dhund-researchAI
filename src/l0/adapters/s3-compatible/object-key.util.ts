function sanitizeSegment(value: string): string {
  return value.replace(/[/\\:\0.]/g, '_').trim();
}

export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? 'file';
  const withoutNulls = base.replace(/\0/g, '');
  const safe = withoutNulls.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255);
  const normalized = safe.replace(/^_+|_+$/g, '');

  return normalized.length > 0 ? normalized : 'file';
}

export function generateObjectKey(
  orgId: string,
  projectId: string,
  category: string,
  id: string,
  filename: string,
): string {
  return [
    sanitizeSegment(orgId),
    sanitizeSegment(projectId),
    sanitizeSegment(category),
    sanitizeSegment(id),
    sanitizeFilename(filename),
  ].join('/');
}
