import { Injectable } from '@nestjs/common';
import type { ProjectScope, ScopedListQuery } from '../l0/ports';
import { ScopedReader } from '../platform/persistence/scoped-reader';

const MODULE = 'orchestration';

@Injectable()
export class ResearchRunsRepository {
  constructor(private readonly reader: ScopedReader) {}

  get(scope: ProjectScope, id: string) {
    return this.reader.require('research_run', scope, id, MODULE);
  }

  update(scope: ProjectScope, id: string, patch: Record<string, unknown>) {
    return this.reader.update('research_run', scope, id, patch, MODULE);
  }

  remove(scope: ProjectScope, id: string) {
    return this.reader.remove('research_run', scope, id, MODULE);
  }

  list(scope: ProjectScope, query: ScopedListQuery) {
    return this.reader.list('research_run', scope, query);
  }
}

@Injectable()
export class ExtractionCellsRepository {
  constructor(private readonly reader: ScopedReader) {}

  get(scope: ProjectScope, id: string) {
    return this.reader.require('extraction_cell', scope, id, MODULE);
  }

  update(scope: ProjectScope, id: string, patch: Record<string, unknown>) {
    return this.reader.update('extraction_cell', scope, id, patch, MODULE);
  }

  remove(scope: ProjectScope, id: string) {
    return this.reader.remove('extraction_cell', scope, id, MODULE);
  }

  list(scope: ProjectScope, query: ScopedListQuery) {
    return this.reader.list('extraction_cell', scope, query);
  }
}

@Injectable()
export class ConversationsRepository {
  constructor(private readonly reader: ScopedReader) {}

  get(scope: ProjectScope, id: string) {
    return this.reader.require('conversation', scope, id, MODULE);
  }

  update(scope: ProjectScope, id: string, patch: Record<string, unknown>) {
    return this.reader.update('conversation', scope, id, patch, MODULE);
  }

  remove(scope: ProjectScope, id: string) {
    return this.reader.remove('conversation', scope, id, MODULE);
  }

  list(scope: ProjectScope, query: ScopedListQuery) {
    return this.reader.list('conversation', scope, query);
  }
}

@Injectable()
export class MessagesRepository {
  constructor(private readonly reader: ScopedReader) {}

  get(scope: ProjectScope, id: string) {
    return this.reader.require('message', scope, id, MODULE);
  }

  update(scope: ProjectScope, id: string, patch: Record<string, unknown>) {
    return this.reader.update('message', scope, id, patch, MODULE);
  }

  remove(scope: ProjectScope, id: string) {
    return this.reader.remove('message', scope, id, MODULE);
  }

  list(scope: ProjectScope, query: ScopedListQuery) {
    return this.reader.list('message', scope, query);
  }
}

@Injectable()
export class ResearchArtifactsRepository {
  constructor(private readonly reader: ScopedReader) {}

  get(scope: ProjectScope, id: string) {
    return this.reader.require('research_artifact', scope, id, MODULE);
  }

  update(scope: ProjectScope, id: string, patch: Record<string, unknown>) {
    return this.reader.update('research_artifact', scope, id, patch, MODULE);
  }

  remove(scope: ProjectScope, id: string) {
    return this.reader.remove('research_artifact', scope, id, MODULE);
  }

  list(scope: ProjectScope, query: ScopedListQuery) {
    return this.reader.list('research_artifact', scope, query);
  }
}

@Injectable()
export class ScreeningDecisionsRepository {
  constructor(private readonly reader: ScopedReader) {}

  get(scope: ProjectScope, id: string) {
    return this.reader.require('screening_decision', scope, id, MODULE);
  }

  update(scope: ProjectScope, id: string, patch: Record<string, unknown>) {
    return this.reader.update('screening_decision', scope, id, patch, MODULE);
  }

  remove(scope: ProjectScope, id: string) {
    return this.reader.remove('screening_decision', scope, id, MODULE);
  }

  list(scope: ProjectScope, query: ScopedListQuery) {
    return this.reader.list('screening_decision', scope, query);
  }
}

export const ORCHESTRATION_REPOS = [
  ResearchRunsRepository,
  ExtractionCellsRepository,
  ConversationsRepository,
  MessagesRepository,
  ResearchArtifactsRepository,
  ScreeningDecisionsRepository,
] as const;
