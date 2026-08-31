import { Module } from '@nestjs/common';
import { L0Module } from '../l0/l0.module';
import { PlatformModule } from '../platform/platform.module';
import { ProjectsModule } from '../projects/projects.module';
import { EvidenceLocatorResolver } from './extract/evidence-locator.resolver';
import { ExtractJobConsumer } from './extract/extract-job.consumer';
import { ExtractMetrics } from './extract/extract.metrics';
import { ExtractService } from './extract/extract.service';
import { IngestionPipelineEntry } from './extract/ingestion-pipeline.entry';
import { PdfParseAdapter } from './extract/pdf-parse.adapter';
import { PDF_PARSER } from './extract/pdf-parser.port';

@Module({
  imports: [PlatformModule, L0Module, ProjectsModule],
  providers: [
    PdfParseAdapter,
    { provide: PDF_PARSER, useExisting: PdfParseAdapter },
    ExtractMetrics,
    ExtractService,
    EvidenceLocatorResolver,
    IngestionPipelineEntry,
    ExtractJobConsumer,
  ],
  exports: [
    IngestionPipelineEntry,
    ExtractService,
    EvidenceLocatorResolver,
    ExtractJobConsumer,
    ExtractMetrics,
  ],
})
export class IngestionModule {}
