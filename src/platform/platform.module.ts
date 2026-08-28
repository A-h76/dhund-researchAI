import { Module } from '@nestjs/common';
import { L0Module } from '../l0/l0.module';

@Module({
  imports: [L0Module],
  exports: [L0Module],
})
export class PlatformModule {}
