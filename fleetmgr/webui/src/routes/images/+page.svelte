<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { invalidate } from '$app/navigation';

  import { errorText } from '$lib/core/errors';
  import { takeNotice } from '$lib/core/notice';
  import ConfirmDialog from '$lib/core/ui/ConfirmDialog.svelte';
  import FileDrop from '$lib/core/ui/FileDrop.svelte';
  import Pager, { paginate } from '$lib/core/ui/Pager.svelte';
  import { deleteImage } from '$lib/software/delete-image';
  import { addImageFiles } from '$lib/software/image-files';
  import {
    IMAGE_FILE_TYPES,
    matchesFilter,
    sortImages,
    type CatalogImage,
    type SortKey
  } from '$lib/software/images';
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
  let deleteTarget = $state<CatalogImage | null>(null);
  let deleting = $state(false);
  let statusMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);
  let table: HTMLTableElement | null = $state(null);
  let filter: HTMLInputElement | null = $state(null);
  let drop: ReturnType<typeof FileDrop> | undefined = $state();
  // What the add or edit page that sent us here did. Taken now, shown once
  // the status region is in place, so that a screen reader reads it.
  const notice = takeNotice();

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

  onMount(() => {
    if (notice) statusMessage = { type: 'success', text: notice };
  });

  function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (key !== sortKey) return 'none';
    return ascending ? 'ascending' : 'descending';
  }

  async function handleDelete(): Promise<void> {
    const target = deleteTarget;
    if (!target) return;
    const index = paged.rows.findIndex((i) => i.name === target.name);
    try {
      deleting = true;
      statusMessage = null;
      await deleteImage(target.name);
      statusMessage = { type: 'success', text: `Deleted image ${target.name}.` };
    } catch (deleteError) {
      statusMessage = { type: 'error', text: errorText(deleteError, 'Failed to delete the image.') };
    } finally {
      deleting = false;
      deleteTarget = null;
    }
    // Also after an error: the entry can be gone while its file is not.
    await invalidate('data:images');
    await tick();
    // The dialog gave focus back to the row's Delete; when that went with
    // its row, focus goes to the row that took its place.
    if (document.activeElement && document.activeElement !== document.body) return;
    const names = table?.querySelectorAll<HTMLAnchorElement>('a.name') ?? [];
    const next = names[Math.min(index, names.length - 1)];
    if (next) next.focus();
    else if (filter) filter.focus();
    else drop?.focus();
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
      bind:this={drop}
      onfiles={(files) => void addImageFiles(files)}
      bind:dragging
      disabled={!!data.loadError}
      accept={IMAGE_FILE_TYPES}
    />
    <a class="btn btn-primary" href="/images/new">Add image</a>
  </div>
</div>

<!-- In place before any message, so that a screen reader reads each one. -->
<div role="status">
  {#if statusMessage}
    <div class={statusMessage.type === 'error' ? 'error-state status' : 'success-banner status'}>
      {statusMessage.text}
    </div>
  {/if}
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
          bind:this={filter}
          class="input compact"
          placeholder="Filter"
          aria-label="Filter"
          bind:value={text}
          oninput={() => (pageNo = 1)}
        />
        <span class="count tn">{rows.length} of {data.images.length}</span>
      </div>

      <div class="table-wrap">
        <table bind:this={table} class="images">
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
              <th class="col-action"><span class="sr-only">Actions</span></th>
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
                <td class="col-action action-cell">
                  <button
                    class="btn btn-ghost btn-sm row-remove on-row"
                    type="button"
                    aria-label={`Delete ${image.name}`}
                    disabled={deleting}
                    onclick={() => (deleteTarget = image)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            {:else}
              <tr class="empty-row"><td colspan="5" class="dim">No images match.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
      <Pager page={paged.page} pageCount={paged.pageCount} onchange={(p) => (pageNo = p)} />
    {/if}
  </section>
{/if}

<ConfirmDialog
  open={deleteTarget !== null}
  title="Delete image"
  message={`Delete ${deleteTarget?.name ?? ''} and its file?`}
  confirmLabel={deleting ? 'Deleting…' : 'Delete'}
  confirmClass="btn-danger"
  oncancel={() => (deleteTarget = null)}
  onconfirm={handleDelete}
/>

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

  .col-action {
    width: 96px;
    text-align: right;
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
      position: relative;
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

    /* Clear of Delete, which sits at the top right. */
    .images .name-cell {
      grid-area: name;
      padding-right: 80px;
    }

    .action-cell {
      position: absolute;
      top: 8px;
      right: 0;
      width: auto;
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
