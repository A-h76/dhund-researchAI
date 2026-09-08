export interface AdapterClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export class SystemAdapterClock implements AdapterClock {
  now(): number {
    return Date.now();
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
