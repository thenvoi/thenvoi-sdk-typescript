import { describe, expect, it, vi } from "vitest";

import { LazyAsyncValue } from "../src/adapters/shared/lazyAsyncValue";

describe("LazyAsyncValue", () => {
  it("loads once for concurrent callers and caches the resolved value", async () => {
    const load = vi.fn(async () => "ready");
    const lazy = new LazyAsyncValue({ load });

    const [first, second, third] = await Promise.all([
      lazy.get(),
      lazy.get(),
      lazy.get(),
    ]);

    expect(first).toBe("ready");
    expect(second).toBe("ready");
    expect(third).toBe("ready");
    expect(load).toHaveBeenCalledTimes(1);
    expect(lazy.current).toBe("ready");
  });

  it("retries loading after a rejection and invokes onRejected", async () => {
    const onRejected = vi.fn();
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("ok");
    const lazy = new LazyAsyncValue({ load, onRejected, retryBackoffMs: 0 });

    await expect(lazy.get()).rejects.toThrow("boom");
    expect(onRejected).toHaveBeenCalledTimes(1);

    await expect(lazy.get()).resolves.toBe("ok");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("rejects immediately during backoff window after failure", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("ok");
    const lazy = new LazyAsyncValue({ load, retryBackoffMs: 5_000 });

    await expect(lazy.get()).rejects.toThrow("boom");
    await expect(lazy.get()).rejects.toThrow("retrying after");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("clears cached state and reloads after clear()", async () => {
    let counter = 0;
    const lazy = new LazyAsyncValue({
      load: async () => {
        counter += 1;
        return `value-${counter}`;
      },
    });

    await expect(lazy.get()).resolves.toBe("value-1");
    lazy.clear();
    await expect(lazy.get()).resolves.toBe("value-2");
  });
});
