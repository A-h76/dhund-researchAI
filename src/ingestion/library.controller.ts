import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { RequireProjectRole } from '../iam/authorization/require-project-role';
import { LibraryService } from './library.service';

@Controller('v1/projects/:projectId/library')
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Post('folders')
  @HttpCode(HttpStatus.CREATED)
  @RequireProjectRole('EDITOR')
  createFolder(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.library.createFolder(authorization, projectId, body);
  }

  @Get('folders')
  @RequireProjectRole('VIEWER')
  listFolders(
    @Param('projectId') projectId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.library.listFolders(authorization, projectId);
  }

  @Patch('folders/:folderId')
  @RequireProjectRole('EDITOR')
  updateFolder(
    @Param('projectId') projectId: string,
    @Param('folderId') folderId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.library.updateFolder(authorization, projectId, folderId, body);
  }

  @Delete('folders/:folderId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireProjectRole('OWNER')
  deleteFolder(
    @Param('projectId') projectId: string,
    @Param('folderId') folderId: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<void> {
    return this.library.deleteFolder(authorization, projectId, folderId);
  }

  @Post('items')
  @HttpCode(HttpStatus.CREATED)
  @RequireProjectRole('EDITOR')
  createItem(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.library.createItem(authorization, projectId, body);
  }

  @Get('items')
  @RequireProjectRole('VIEWER')
  listItems(
    @Param('projectId') projectId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.library.listItems(authorization, projectId);
  }

  @Patch('items/:itemId')
  @RequireProjectRole('EDITOR')
  updateItem(
    @Param('projectId') projectId: string,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.library.updateItem(authorization, projectId, itemId, body);
  }

  @Delete('items/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireProjectRole('EDITOR')
  deleteItem(
    @Param('projectId') projectId: string,
    @Param('itemId') itemId: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<void> {
    return this.library.deleteItem(authorization, projectId, itemId);
  }
}
