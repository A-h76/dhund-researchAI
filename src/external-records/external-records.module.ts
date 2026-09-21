import { Module } from '@nestjs/common';
import { ConnectorsModule } from '../connectors/connectors.module';
import { IdentityModule } from '../identity/identity.module';
import { PlatformModule } from '../platform/platform.module';
import { ExternalRecordMetrics } from './external-record.metrics';
import { ExternalRecordRefreshService } from './external-record-refresh.service';
import { RefmgrImportService } from './refmgr-import.service';

@Module({
  imports: [PlatformModule, ConnectorsModule, IdentityModule],
  providers: [
    ExternalRecordMetrics,
    ExternalRecordRefreshService,
    RefmgrImportService,
  ],
  exports: [
    ExternalRecordMetrics,
    ExternalRecordRefreshService,
    RefmgrImportService,
  ],
})
export class ExternalRecordsModule {}
