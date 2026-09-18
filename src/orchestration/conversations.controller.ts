import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { RequireProjectRole } from '../iam/authorization/require-project-role';
import { ConversationsService } from './conversations.service';

@Controller('v1/projects/:projectId/conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireProjectRole('EDITOR')
  create(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.conversations.create(authorization, projectId, body);
  }

  @Get(':conversationId')
  @RequireProjectRole('VIEWER')
  get(
    @Param('projectId') projectId: string,
    @Param('conversationId') conversationId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.conversations.get(authorization, projectId, conversationId);
  }

  @Get(':conversationId/messages')
  @RequireProjectRole('VIEWER')
  listMessages(
    @Param('projectId') projectId: string,
    @Param('conversationId') conversationId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.conversations.listMessages(authorization, projectId, conversationId);
  }

  @Post(':conversationId/messages')
  @HttpCode(HttpStatus.OK)
  @RequireProjectRole('EDITOR')
  sendMessage(
    @Param('projectId') projectId: string,
    @Param('conversationId') conversationId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.conversations.sendMessage(
      authorization,
      projectId,
      conversationId,
      body,
    );
  }
}
