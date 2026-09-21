import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { PlatformModule } from '../platform/platform.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { ChatMetrics } from './chat.metrics';
import { PaperChatService } from './paper-chat.service';
import { OrchestrationModule } from './orchestration.module';
import { ScreeningDecisionsController } from './screening-decisions.controller';

@Module({
  imports: [PlatformModule, IamModule, RetrievalModule, OrchestrationModule],
  controllers: [ConversationsController, ScreeningDecisionsController],
  providers: [ConversationsService, PaperChatService, ChatMetrics],
  exports: [ConversationsService, PaperChatService, ChatMetrics],
})
export class OrchestrationApiModule {}
