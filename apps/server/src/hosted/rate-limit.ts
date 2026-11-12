/** Fixed-window-free sliding log rate limiter (in memory, per key). */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly limit: () => number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now
  ) {}

  /** true (and records the hit) when allowed. */
  take(key: string): boolean {
    const t = this.now();
    const arr = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (arr.length >= this.limit()) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(t);
    this.hits.set(key, arr);
    return true;
  }

  reset() {
    this.hits.clear();
  }
}
