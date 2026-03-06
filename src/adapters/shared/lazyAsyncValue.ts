export interface LazyAsyncValueOptions<T> {
  load: () => Promise<T>;
  onRejected?: (error: unknown) => void;
}

export class LazyAsyncValue<T> {
  private readonly load: () => Promise<T>;
  private readonly onRejected?: (error: unknown) => void;
  private value: T | null = null;
  private pending: Promise<T> | null = null;

  public constructor(options: LazyAsyncValueOptions<T>) {
    this.load = options.load;
    this.onRejected = options.onRejected;
  }

  public get current(): T | null {
    return this.value;
  }

  public async get(): Promise<T> {
    if (this.value) {
      return this.value;
    }

    if (!this.pending) {
      this.pending = this.load()
        .then((value) => {
          this.value = value;
          return value;
        })
        .catch((error: unknown) => {
          this.pending = null;
          this.onRejected?.(error);
          throw error;
        });
    }

    return this.pending;
  }

  public clear(): void {
    this.value = null;
    this.pending = null;
  }
}
