export interface Poller {
  start(): void;
  stop(): void;
}

/** Run tick every intervalMs, counted from the end of the previous tick,
 * so ticks never overlap and a slow server is not asked again at once. A
 * hidden tab does not tick; coming back to it ticks at once. A tick that
 * fails leaves what is shown and is retried on the next one. */
export function createPoller(tick: () => Promise<unknown>, intervalMs: number): Poller {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let started = false;

  function clear(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(): void {
    clear();
    if (started && !document.hidden) {
      timer = setTimeout(run, intervalMs);
    }
  }

  async function run(): Promise<void> {
    timer = null;
    if (!started || running || document.hidden) {
      return;
    }
    running = true;
    try {
      await tick();
    } catch {
      // the next tick tries again
    } finally {
      running = false;
      schedule();
    }
  }

  function onVisibility(): void {
    if (document.hidden) {
      clear();
    } else if (!running) {
      clear();
      void run();
    }
  }

  return {
    start() {
      if (started) {
        return;
      }
      started = true;
      document.addEventListener('visibilitychange', onVisibility);
      schedule();
    },
    stop() {
      started = false;
      clear();
      document.removeEventListener('visibilitychange', onVisibility);
    }
  };
}

let lastSeq = 0;

/** A number for a request about to start, above every one taken before.
 * Data is only as new as the request that fetched it, so loaders and polls
 * stamp what they read with these and the newest wins. */
export function nextSeq(): number {
  return ++lastSeq;
}
