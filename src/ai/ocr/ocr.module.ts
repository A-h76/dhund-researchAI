import { Module } from '@nestjs/common';
import { PlatformModule } from '../../platform/platform.module';
import { AiModule } from '../ai.module';
import { OcrMetrics } from './ocr.metrics';
import { OcrService } from './ocr.service';

@Module({
  imports: [PlatformModule, AiModule],
  providers: [OcrService, OcrMetrics],
  exports: [OcrService, OcrMetrics],
})
export class OcrModule {}
