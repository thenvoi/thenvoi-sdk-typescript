const DEFAULT_MAX_TRACKED = 10_000;

export class MessageRetryTracker {
  private readonly maxRetriesValue: number;
  private readonly maxTracked: number;
  private attempts = new Map<string, number>();
  private failed = new Set<string>();

  public constructor(maxRetries = 1, maxTracked = DEFAULT_MAX_TRACKED) {
    this.maxRetriesValue = maxRetries;
    this.maxTracked = maxTracked;
  }

  public get maxRetries(): number {
    return this.maxRetriesValue;
  }

  public isPermanentlyFailed(messageId: string): boolean {
    return this.failed.has(messageId);
  }

  public recordAttempt(messageId: string): [number, boolean] {
    const attempts = (this.attempts.get(messageId) ?? 0) + 1;
    this.attempts.set(messageId, attempts);

    const exceeded = attempts > this.maxRetriesValue;
    if (exceeded) {
      this.evictSetIfNeeded(this.failed);
      this.failed.add(messageId);
    }

    this.evictMapIfNeeded(this.attempts);
    return [attempts, exceeded];
  }

  public markSuccess(messageId: string): void {
    this.attempts.delete(messageId);
  }

  public markPermanentlyFailed(messageId: string): void {
    this.evictSetIfNeeded(this.failed);
    this.failed.add(messageId);
  }

  private evictMapIfNeeded(map: Map<string, unknown>): void {
    while (map.size >= this.maxTracked) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) {
        map.delete(oldest);
      } else {
        break;
      }
    }
  }

  private evictSetIfNeeded(set: Set<string>): void {
    while (set.size >= this.maxTracked) {
      const oldest = set.values().next().value;
      if (oldest !== undefined) {
        set.delete(oldest);
      } else {
        break;
      }
    }
  }
}
