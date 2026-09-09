import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { PlatformModule } from '../platform/platform.module';
import { DocumentsController } from './documents.controller';
import { DocumentsRepository } from './documents.repository';
import { DocumentsService } from './documents.service';
import { ExternalRecordsRepository } from './external-records.repository';

@Module({
  imports: [PlatformModule, IamModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentsRepository, ExternalRecordsRepository],
  exports: [DocumentsRepository, ExternalRecordsRepository],
})
export class IngestionModule {}
