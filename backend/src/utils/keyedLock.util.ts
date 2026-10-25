/**
 * Serializes asynchronous tasks that write the same resource. Used for
 * per-share files (visitors, comments) so two concurrent requests cannot
 * interleave a read-modify-write and lose an update. Idle keys are removed as
 * soon as their queue drains, so the map only holds active writes.
 */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );

    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });

    return result;
  }
}
