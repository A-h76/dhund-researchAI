import { Controller, Get, Param, Query } from '@nestjs/common';
import { parseExportFormat } from '../../evidence/citation-export';
import { CitationExportService } from '../../evidence/citation-export.service';
import { RequireProjectRole } from '../../iam/authorization/require-project-role';

@Controller('v1/projects/:projectId/citations')
export class CitationExportController {
  constructor(private readonly exports: CitationExportService) {}

  @Get('export')
  @RequireProjectRole('VIEWER')
  export(@Param('projectId') projectId: string, @Query('format') format: unknown) {
    return this.exports.exportProject(projectId, parseExportFormat(format));
  }
}
