<script lang="ts">
  import { goto } from '$app/navigation';
  import { tick } from 'svelte';

  import { NAVIGATION, SOURCES, searchEntries } from './index-builder';
  import type { PaletteEntry, PaletteGroup } from './types';

  let { open = $bindable(false) }: { open: boolean } = $props();

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement | null = $state(null);
  let resultsEl: HTMLDivElement | null = $state(null);
  let dialog: HTMLDialogElement | null = $state(null);
  // Raw: a deep proxy over 30k device entries costs more than the search.
  // Kept between opens, so a reopen shows the last entries while it reloads.
  let loaded: Record<string, PaletteEntry[]> = $state.raw({});
  let pending = $state(0);
  let generation = 0;

  let groups = $derived.by<PaletteGroup[]>(() => {
    const out: PaletteGroup[] = [];
    const nav = searchEntries(NAVIGATION, query);
    if (nav.total > 0) out.push({ category: 'Navigation', entries: nav.entries });
    for (const source of SOURCES) {
      const all = loaded[source.category];
      if (!all) continue;
      const { entries, total } = searchEntries(all, query);
      if (total === 0) continue;
      if (total > entries.length) {
        const q = query.trim();
        entries.push({
          id: `more:${source.category}`,
          label: `Show all ${total.toLocaleString()}${q ? ' matching' : ''}`,
          href: source.listHref(q),
          more: true
        });
      }
      out.push({ category: source.category, entries });
    }
    return out;
  });
  let flat = $derived(groups.flatMap((group) => group.entries));
  // Clamp instead of writing back: the raw index may point past a shrunken result set.
  let activeIndex = $derived(Math.min(selectedIndex, Math.max(0, flat.length - 1)));

  $effect(() => {
    if (!open) return;

    selectedIndex = 0;
    query = '';
    const current = ++generation;
    pending = SOURCES.length;
    for (const source of SOURCES) {
      source
        .load()
        .then((entries) => {
          if (current === generation) loaded = { ...loaded, [source.category]: entries };
        })
        // A failed read leaves its group out; the others still show.
        .catch(() => {})
        .finally(() => {
          if (current === generation) pending--;
        });
    }

    void tick().then(() => inputEl?.focus());
  });

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  function move(index: number): void {
    selectedIndex = index;
    void tick().then(() => {
      const row = resultsEl?.querySelector('.cmdk-entry--selected');
      const label = row?.previousElementSibling;
      // The first row of a group brings its label along.
      if (label?.classList.contains('cmdk-group-label')) label.scrollIntoView({ block: 'nearest' });
      row?.scrollIntoView({ block: 'nearest' });
    });
  }

  function handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      open = false;
      event.preventDefault();
      return;
    }
    if (event.key === 'ArrowDown') {
      move(Math.min(activeIndex + 1, flat.length - 1));
      event.preventDefault();
      return;
    }
    if (event.key === 'ArrowUp') {
      move(Math.max(0, activeIndex - 1));
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      const entry = flat[activeIndex];
      if (entry) select(entry);
      event.preventDefault();
    }
  }

  function select(entry: PaletteEntry): void {
    open = false;
    void goto(entry.href);
  }

  function handleCancel(event: Event): void {
    event.preventDefault();
    open = false;
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === dialog) open = false;
  }
</script>

<dialog
  bind:this={dialog}
  class="cmdk-overlay"
  aria-label="Search"
  oncancel={handleCancel}
  onclick={handleBackdropClick}
>
  {#if open}
    <div class="cmdk-panel card">
      <div class="cmdk-search">
        <span class="cmdk-prompt" aria-hidden="true">⌘</span>
        <input
          bind:this={inputEl}
          bind:value={query}
          oninput={() => (selectedIndex = 0)}
          onkeydown={handleKey}
          type="text"
          class="cmdk-input"
          placeholder="Jump to a campaign, image, device or schedule…"
          autocomplete="off"
          spellcheck="false"
        />
      </div>

      <div class="cmdk-results" bind:this={resultsEl}>
        {#if pending > 0}
          <div class="cmdk-hint-row">Loading…</div>
        {/if}

        {#if flat.length === 0 && pending === 0}
          <div class="cmdk-empty">No results for “{query}”</div>
        {:else}
          {#each groups as group (group.category)}
            <div class="cmdk-group">
              <div class="cmdk-group-label">{group.category}</div>
              {#each group.entries as entry (entry.id)}
                {@const index = flat.indexOf(entry)}
                <button
                  class="cmdk-entry"
                  class:cmdk-entry--selected={index === activeIndex}
                  class:cmdk-entry--more={entry.more}
                  onmouseenter={() => (selectedIndex = index)}
                  onclick={() => select(entry)}
                  type="button"
                >
                  <span class="cmdk-entry-label">{entry.label}</span>
                  {#if entry.description}
                    <span class="cmdk-entry-desc">{entry.description}</span>
                  {/if}
                </button>
              {/each}
            </div>
          {/each}
        {/if}
      </div>

      <div class="cmdk-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>↵</kbd> open</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </div>
  {/if}
</dialog>

<style>
  .cmdk-overlay {
    position: fixed;
    inset: 0;
    margin: 0;
    padding: 12vh 1rem 1rem;
    width: 100vw;
    max-width: 100vw;
    height: 100vh;
    max-height: 100vh;
    border: 0;
    background: transparent;
    color: inherit;
    display: none;
    justify-content: center;
    align-items: flex-start;
  }

  .cmdk-overlay[open] {
    display: flex;
  }

  .cmdk-overlay::backdrop {
    background: rgb(var(--sw-navy-rgb) / 0.7);
    backdrop-filter: blur(2px);
  }

  .cmdk-panel {
    position: relative;
    z-index: 1;
    display: grid;
    width: min(100%, 36rem);
    max-height: 70vh;
    grid-template-rows: auto 1fr auto;
    border: 1px solid var(--sw-border-default);
    background: var(--sw-bg-surface);
    box-shadow: var(--sw-shadow-elevated);
    overflow: hidden;
    padding: 0;
  }

  .cmdk-search {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--sw-border-subtle);
  }

  .cmdk-prompt {
    font-family: var(--sw-font-mono);
    color: var(--sw-text-muted);
    font-size: 14px;
  }

  .cmdk-input {
    flex: 1;
    border: 0;
    background: transparent;
    color: var(--sw-text-primary);
    font-size: 15px;
    outline: none;
  }

  .cmdk-input::placeholder {
    color: var(--sw-text-muted);
  }

  .cmdk-results {
    overflow-y: auto;
    padding: 6px 6px 10px;
  }

  .cmdk-group {
    display: grid;
    gap: 1px;
    margin-top: 6px;
  }

  .cmdk-group-label {
    padding: 8px 12px 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--sw-text-muted);
  }

  .cmdk-entry {
    display: flex;
    width: 100%;
    align-items: baseline;
    gap: 12px;
    padding: 9px 12px;
    border: 0;
    border-radius: var(--sw-radius-md);
    background: transparent;
    color: var(--sw-text-primary);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }

  .cmdk-entry--more {
    color: var(--sw-text-muted);
  }

  .cmdk-entry--selected,
  .cmdk-entry:hover {
    background: var(--sw-bg-card);
  }

  .cmdk-entry--selected {
    background: var(--sw-accent-glow);
    color: var(--sw-accent);
  }

  .cmdk-entry-label {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cmdk-entry-desc {
    color: var(--sw-text-muted);
    font-family: var(--sw-font-mono);
    font-size: 11px;
    flex-shrink: 0;
    max-width: 50%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cmdk-entry--selected .cmdk-entry-desc {
    color: var(--sw-accent);
    opacity: 0.75;
  }

  .cmdk-empty,
  .cmdk-hint-row {
    padding: 18px;
    text-align: center;
    color: var(--sw-text-muted);
    font-size: 13px;
  }

  .cmdk-footer {
    display: flex;
    gap: 14px;
    padding: 10px 16px;
    border-top: 1px solid var(--sw-border-subtle);
    color: var(--sw-text-muted);
    font-size: 11px;
  }

  .cmdk-footer kbd {
    display: inline-block;
    padding: 1px 5px;
    margin-right: 3px;
    border: 1px solid var(--sw-border-subtle);
    border-radius: 4px;
    background: var(--sw-bg-deep);
    font-family: var(--sw-font-mono);
    font-size: 11px;
  }
</style>
