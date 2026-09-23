export class BindingOccupancy {
  readonly message = new Set<string>();
  readonly writing = new Set<string>();
}

export function bindingKey(projectId: string, evidenceId: string): string {
  return `${projectId}:${evidenceId}`;
}
