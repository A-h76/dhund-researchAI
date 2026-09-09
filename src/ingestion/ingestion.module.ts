import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { PlatformModule } from '../platform/platform.module';
import { DocumentsController } from './documents.controller';
import { DocumentsRepository } from './documents.repository';
import { DocumentsService } from './documents.service';
import { ExternalRecordsRepository } from './external-records.repository';
import { UploadsController } from './uploads.controller';
import { UploadsMetrics } from './uploads.metrics';
import { UploadsService } from './uploads.service';

@Module({
  imports: [PlatformModule, IamModule],
  controllers: [DocumentsController, UploadsController],
  providers: [
    DocumentsService,
    DocumentsRepository,
    ExternalRecordsRepository,
    UploadsService,
    UploadsMetrics,
  ],
  exports: [DocumentsRepository, ExternalRecordsRepository],
})
export class IngestionModule {}
