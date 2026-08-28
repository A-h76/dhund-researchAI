export const OBJECT_STORAGE_SERVICE = Symbol('OBJECT_STORAGE_SERVICE');

export interface ObjectStorageService {
  ping(): Promise<boolean>;
}
