export const DATABASE_SERVICE = Symbol('DATABASE_SERVICE');

export interface DatabaseService {
  ping(): Promise<boolean>;
}
