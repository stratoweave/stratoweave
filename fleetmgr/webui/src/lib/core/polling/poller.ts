export interface Poller {
  start(): void;
  stop(): void;
}

/** Run tick on an interval. A tick is skipped while the previous one is in
 * flight or the tab is hidden; returning to the tab ticks immediately. */
export function createPoller(tick: () => Promise<unknown>, intervalMs: number): Poller {
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  async function run(): Promise<void> {
    if (inFlight || document.hidden) {
      return;
    }
    inFlight = true;
    try {
      await tick();
    } finally {
      inFlight = false;
    }
  }

  function onVisibility(): void {
    if (!document.hidden) {
      void run();
    }
  }

  return {
    start() {
      if (timer !== null) {
        return;
      }
      timer = setInterval(() => void run(), intervalMs);
      document.addEventListener('visibilitychange', onVisibility);
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      document.removeEventListener('visibilitychange', onVisibility);
    }
  };
}
