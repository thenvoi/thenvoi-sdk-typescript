export class MessageRetryTracker {
  private readonly maxRetriesValue: number;
  private attempts = new Map<string, number>();
  private failed = new Set<string>();

  public constructor(maxRetries = 1, _roomId = "") {
    this.maxRetriesValue = maxRetries;
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
      this.failed.add(messageId);
    }

    return [attempts, exceeded];
  }

  public markSuccess(messageId: string): void {
    this.attempts.delete(messageId);
  }

  public markPermanentlyFailed(messageId: string): void {
    this.failed.add(messageId);
  }
}
