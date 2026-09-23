import { Inject, Injectable } from '@nestjs/common';
import {
  CITATION_PROJECTION,
  type CitationProjectionPort,
} from '../l0/ports/citation-projection.port';
import {
  exportBibliography,
  identityFromCitation,
  type ExportFormat,
} from './citation-export';
import { CitationMetrics } from './citations.metrics';

@Injectable()
export class CitationExportService {
  constructor(
    @Inject(CITATION_PROJECTION) private readonly store: CitationProjectionPort,
    private readonly metrics: CitationMetrics,
  ) {}

  async exportProject(
    projectId: string,
    format: ExportFormat,
  ): Promise<{ readonly format: ExportFormat; readonly body: string }> {
    const citations = await this.store.listCitations(projectId);
    const body = exportBibliography(format, citations.map(identityFromCitation));
    this.metrics.recordExport(format);
    return { format, body };
  }
}
