<script lang="ts" module>
  /** One page of `rows`; `page` is clamped to the pages there are. */
  export function paginate<T>(rows: T[], page: number, size: number): { rows: T[]; page: number; pageCount: number } {
    const pageCount = Math.max(1, Math.ceil(rows.length / size));
    const current = Math.min(page, pageCount);
    return { rows: rows.slice((current - 1) * size, current * size), page: current, pageCount };
  }
</script>

<script lang="ts">
  interface Props {
    page: number;
    pageCount: number;
    onchange: (page: number) => void;
  }

  let { page, pageCount, onchange }: Props = $props();
</script>

{#if pageCount > 1}
  <div class="pager">
    <button class="btn btn-secondary btn-sm" type="button" disabled={page <= 1} onclick={() => onchange(page - 1)}>
      ‹
    </button>
    <span>page {page} / {pageCount}</span>
    <button class="btn btn-secondary btn-sm" type="button" disabled={page >= pageCount} onclick={() => onchange(page + 1)}>
      ›
    </button>
  </div>
{/if}

<style>
  .pager {
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: flex-end;
    margin-top: 10px;
    font-size: 12px;
    color: var(--sw-text-secondary);
  }
</style>
