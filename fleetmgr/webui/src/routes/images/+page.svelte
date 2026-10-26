<script lang="ts">
  import FileDrop from '$lib/core/ui/FileDrop.svelte';
  import Pager, { paginate } from '$lib/core/ui/Pager.svelte';
  import { addImageFiles } from '$lib/software/image-files';
  import { IMAGE_FILE_TYPES, matchesFilter, sortImages, type SortKey } from '$lib/software/images';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const COLUMNS: { key: SortKey; label: string }[] = [
    { key: 'name', label: 'Name' },
    { key: 'os', label: 'OS' },
    { key: 'models', label: 'Models' },
    { key: 'version', label: 'Version' }
  ];

  // Newest version first until a header is clicked.
  let sortKey = $state<SortKey>('version');
  let ascending = $state(false);
  let text = $state('');
  let pageNo = $state(1);
  let dragging = $state(false);

  let rows = $derived(sortImages(data.images.filter((i) => matchesFilter(i, text)), sortKey, ascending));
  let paged = $derived(paginate(rows, pageNo, 50));

  function sortBy(key: SortKey): void {
    if (key === sortKey) {
      ascending = !ascending;
    } else {
      sortKey = key;
      // A version column reads best newest first.
      ascending = key !== 'version';
    }
    pageNo = 1;
  }

  function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (key !== sortKey) return 'none';
    return ascending ? 'ascending' : 'descending';
  }
</script>

<div class="page-header">
  <div>
    <h1>Images</h1>
    <p>
      Software images by file name, with the OS each runs and the hardware
      models it is for. Drop image files anywhere on this page to upload them.
    </p>
  </div>
  <div class="page-actions">
    <!-- An upload checks its names against the list, so it needs the list. -->
    <FileDrop
      onfiles={(files) => void addImageFiles(files)}
      bind:dragging
      disabled={!!data.loadError}
      accept={IMAGE_FILE_TYPES}
    />
    <a class="btn btn-primary" href="/images/new">Add image</a>
  </div>
</div>

{#if data.loadError}
  <div class="error-state status">{data.loadError}</div>
{:else}
  <section class="card" class:dropping={dragging}>
    {#if dragging}
      <div class="drop-hint-bar"><span class="drop-hint">Drop to add these files as images</span></div>
    {/if}
    {#if data.images.length === 0}
      <div class="empty-state">No images yet. Add one by hand, or drop image files anywhere on this page.</div>
    {:else}
      <div class="filters">
        <input
          class="input compact"
          placeholder="Filter"
          aria-label="Filter"
          bind:value={text}
          oninput={() => (pageNo = 1)}
        />
        <span class="count tn">{rows.length} of {data.images.length}</span>
      </div>

      <div class="table-wrap">
        <table class="images">
          <thead>
            <tr>
              {#each COLUMNS as c (c.key)}
                <th class={`col-${c.key}`} aria-sort={ariaSort(c.key)}>
                  <button class="sort" class:active={c.key === sortKey} type="button" onclick={() => sortBy(c.key)}>
                    {c.label}
                    <svg
                      class="arrow"
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                      focusable="false"
                    >
                      {#if c.key !== sortKey}
                        <path d="m3 4 2-2 2 2M3 6l2 2 2-2" />
                      {:else if ascending}
                        <path d="m2.5 6.5 2.5-2.5 2.5 2.5" />
                      {:else}
                        <path d="m2.5 3.5 2.5 2.5 2.5-2.5" />
                      {/if}
                    </svg>
                  </button>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each paged.rows as image (image.name)}
              <tr>
                <td class="name-cell">
                  <a class="mono name" href={`/images/${encodeURIComponent(image.name)}`}>{image.name}</a>
                </td>
                <td class="os-cell nowrap">{image.os}</td>
                <td class="models-cell">
                  <span class="chips">
                    {#each image.models as m (m)}<span class="tag mono">{m}</span>{/each}
                  </span>
                </td>
                <td class="version-cell mono nowrap">{image.version}</td>
              </tr>
            {:else}
              <tr class="empty-row"><td colspan="4" class="dim">No images match.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
      <Pager page={paged.page} pageCount={paged.pageCount} onchange={(p) => (pageNo = p)} />
    {/if}
  </section>
{/if}

<style>
  .filters {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
  }

  .filters .input {
    flex: 1;
    max-width: 280px;
  }

  .count {
    margin-left: auto;
    font-size: var(--sw-text-sm);
    color: var(--sw-text-secondary);
    white-space: nowrap;
  }

  .images {
    table-layout: fixed;
    min-width: 860px;
  }

  .col-name {
    width: 38%;
  }

  .col-os {
    width: 11%;
  }

  .col-version {
    width: 12%;
  }

  .sort {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    color: inherit;
    cursor: pointer;
  }

  .sort:hover,
  .sort.active {
    color: var(--sw-text-primary);
  }

  .arrow {
    flex-shrink: 0;
    color: var(--sw-text-muted);
  }

  .sort.active .arrow {
    color: var(--sw-accent);
  }

  .name {
    font-size: var(--sw-text-xs);
    color: var(--sw-accent-bright);
    text-decoration: none;
    overflow-wrap: anywhere;
  }

  .name:hover {
    text-decoration: underline;
  }

  .chips {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .tag {
    padding: 2px 8px;
    border: 1px solid var(--sw-border-default);
    border-radius: var(--sw-radius-xs);
    background: var(--sw-bg-elevated);
    font-size: var(--sw-text-xs);
    white-space: nowrap;
  }

  .nowrap {
    white-space: nowrap;
  }

  .dim {
    color: var(--sw-text-muted);
  }

  /* Touch screens get targets a finger can hit, as app.css gives chips. */
  @media (pointer: coarse) {
    .sort {
      min-height: 32px;
    }

    .name {
      display: inline-block;
      padding: 6px 0;
    }
  }

  @media (max-width: 720px) {
    /* Each image becomes a block: its name, then its version and OS, then
       its models. The header stays, as a row of sort buttons. */
    .images {
      min-width: 0;
      table-layout: auto;
    }

    .images thead,
    .images tbody {
      display: block;
    }

    .images thead tr {
      display: flex;
      flex-wrap: wrap;
      gap: 0 18px;
      padding: 0 10px;
      border-bottom: 1px solid var(--sw-border-subtle);
      background: var(--sw-bg-surface);
    }

    .images th {
      display: block;
      width: auto;
      padding: 9px 0;
      border: none;
      background: none;
    }

    .images tbody tr {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      grid-template-areas:
        'name name'
        'version os'
        'models models';
      gap: 6px 12px;
      padding: 12px 0;
    }

    .images tbody tr + tr {
      border-top: 1px solid var(--sw-border-subtle);
    }

    .images td {
      display: block;
      padding: 0;
      border: none;
    }

    .name-cell {
      grid-area: name;
    }

    .version-cell {
      grid-area: version;
    }

    .os-cell {
      grid-area: os;
      color: var(--sw-text-secondary);
    }

    .models-cell {
      grid-area: models;
    }

    .empty-row td {
      grid-column: 1 / -1;
    }

    tbody tr:hover td {
      background: none;
    }
  }
</style>
