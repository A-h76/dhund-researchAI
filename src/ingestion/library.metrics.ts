import { Injectable } from '@nestjs/common';

export type LibraryTargetKind = 'document' | 'external_record';
export type LibraryFolderOperation = 'create' | 'update' | 'delete';

@Injectable()
export class LibraryMetrics {
  private readonly itemsByTarget: Record<LibraryTargetKind, number> = {
    document: 0,
    external_record: 0,
  };
  private readonly folderOperations: Record<LibraryFolderOperation, number> = {
    create: 0,
    update: 0,
    delete: 0,
  };

  recordItem(target: LibraryTargetKind): void {
    this.itemsByTarget[target] += 1;
  }

  recordFolder(operation: LibraryFolderOperation): void {
    this.folderOperations[operation] += 1;
  }

  snapshot(): {
    itemsByTarget: Record<LibraryTargetKind, number>;
    folderOperations: Record<LibraryFolderOperation, number>;
  } {
    return {
      itemsByTarget: { ...this.itemsByTarget },
      folderOperations: { ...this.folderOperations },
    };
  }
}
