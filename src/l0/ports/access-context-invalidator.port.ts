export interface AccessContextInvalidator {
  invalidateAccessContext(userId: string): Promise<void>;
}
