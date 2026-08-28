import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [ProjectsModule],
  exports: [ProjectsModule],
})
export class IngestionModule {}
