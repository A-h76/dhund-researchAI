export const LAYER_ORDER = [
  'l0',
  'platform',
  'iam',
  'projects',
  'ingestion',
  'retrieval',
  'evidence',
  'orchestration',
  'ai',
] as const;

export type LayerName = (typeof LAYER_ORDER)[number];

const LAYER_INDEX = new Map<LayerName, number>(
  LAYER_ORDER.map((name, index) => [name, index]),
);

const LAYER_SEGMENT = /[/\\](l0|platform|iam|projects|ingestion|retrieval|evidence|orchestration|ai)[/\\]/;

export function layerFromPath(filePath: string): LayerName | null {
  const match = filePath.match(LAYER_SEGMENT);
  return match ? (match[1] as LayerName) : null;
}

export function layerIndex(layer: LayerName): number {
  return LAYER_INDEX.get(layer) ?? -1;
}

export interface LayerViolation {
  file: string;
  importerLayer: LayerName;
  importedLayer: LayerName;
  importPath: string;
}

export function findLayerViolations(
  files: Array<{ path: string; content: string }>,
): LayerViolation[] {
  const violations: LayerViolation[] = [];
  const importRegex = /from\s+['"]([^'"]+)['"]/g;

  for (const file of files) {
    const importerLayer = layerFromPath(file.path);
    if (importerLayer === null) {
      continue;
    }

    const importerIndex = layerIndex(importerLayer);
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(file.content)) !== null) {
      const importPath = match[1];
      const importedLayer = resolveImportedLayer(file.path, importPath);
      if (importedLayer === null) {
        continue;
      }

      const importedIndex = layerIndex(importedLayer);
      if (importedIndex > importerIndex) {
        violations.push({
          file: file.path,
          importerLayer,
          importedLayer,
          importPath,
        });
      }
    }
  }

  return violations;
}

function resolveImportedLayer(filePath: string, importPath: string): LayerName | null {
  if (importPath.startsWith('@')) {
    const aliasLayer = importPath.slice(1).split('/')[0] as LayerName;
    return LAYER_INDEX.has(aliasLayer) ? aliasLayer : null;
  }

  if (!importPath.startsWith('.')) {
    return null;
  }

  const normalized = filePath.replace(/\\/g, '/');
  const dir = normalized.slice(0, normalized.lastIndexOf('/'));
  const segments = importPath.split('/');
  const resolved: string[] = dir.split('/');

  for (const segment of segments) {
    if (segment === '.' || segment === '') {
      continue;
    }
    if (segment === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }

  return layerFromPath(resolved.join('/'));
}
