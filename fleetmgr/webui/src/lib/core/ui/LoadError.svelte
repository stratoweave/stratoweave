<script lang="ts">
  import { reload } from '#lib/core/reload.ts';

  // A read that failed, in place of the content it should have shown: never
  // an empty state, which would say there is nothing when the server did not
  // answer.
  // onretry reads again what failed; without it, Retry reloads the page's
  // reads.
  let { message, onretry }: { message: string; onretry?: () => Promise<void> } = $props();

  let retrying = $state(false);

  async function retry(): Promise<void> {
    retrying = true;
    try {
      await (onretry ?? reload)();
    } finally {
      retrying = false;
    }
  }
</script>

<div class="error-state status load-error" role="alert">
  <span>{message}</span>
  <button class="btn btn-secondary btn-sm" type="button" disabled={retrying} onclick={retry}>
    {retrying ? 'Retrying…' : 'Retry'}
  </button>
</div>

<style>
  .load-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px 16px;
  }
</style>
