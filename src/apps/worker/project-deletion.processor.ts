import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventDispatcherService } from '../../platform/events/event-dispatcher.service';
import type { EventEnvelope } from '../../platform/events/envelope';
import { ProjectErasureService } from '../../platform/persistence/project-erasure.service';
import { ProcessorRegistry } from './processor-registry';

export const PROJECT_DELETED_EVENT = 'projects.project.deleted';

@Injectable()
export class ProjectDeletionProcessor implements OnModuleInit {
  constructor(
    private readonly dispatcher: EventDispatcherService,
    private readonly erasure: ProjectErasureService,
    private readonly processors: ProcessorRegistry,
  ) {}

  onModuleInit(): void {
    this.processors.register('project-deletion');
    this.dispatcher.register(PROJECT_DELETED_EVENT, (envelope) =>
      this.handle(envelope),
    );
  }

  private async handle(envelope: EventEnvelope): Promise<void> {
    const projectId =
      envelope.projectId ??
      (typeof envelope.payload.projectId === 'string'
        ? envelope.payload.projectId
        : envelope.aggregateId);
    await this.erasure.run(projectId);
  }
}
