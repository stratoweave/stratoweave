/** Calls `apply` with what the newest load's promise brings. A page shows
 * before its big reads are in, and keeps what it shows until the next
 * load's data arrives, so a reload does not blank it. The promise must not
 * reject. Call while the component initializes. */
export function onLoaded<T>(promise: () => Promise<T>, apply: (value: T) => void): void {
  $effect.pre(() => {
    const pending = promise();
    let newest = true;
    void pending.then((value) => {
      if (newest) apply(value);
    });
    return () => {
      newest = false;
    };
  });
}
