import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { PlatformModule } from '../platform/platform.module';
import { DocumentAccessController } from './document-access.controller';
import { DocumentsController } from './documents.controller';
import { DocumentsRepository } from './documents.repository';
import { DocumentsService } from './documents.service';
import { ExternalRecordsRepository } from './external-records.repository';
import { LibraryController } from './library.controller';
import { LibraryMetrics } from './library.metrics';
import { LibraryService } from './library.service';
import { UploadsController } from './uploads.controller';
import { UploadsMetrics } from './uploads.metrics';
import { UploadsService } from './uploads.service';

@Module({
  imports: [PlatformModule, IamModule],
  controllers: [
    DocumentsController,
    DocumentAccessController,
    UploadsController,
    LibraryController,
  ],
  providers: [
    DocumentsService,
    DocumentsRepository,
    ExternalRecordsRepository,
    UploadsService,
    UploadsMetrics,
    LibraryMetrics,
    LibraryService,
  ],
  exports: [DocumentsRepository, ExternalRecordsRepository],
})
export class IngestionModule {}
