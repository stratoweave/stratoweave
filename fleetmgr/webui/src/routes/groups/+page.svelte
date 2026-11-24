<script lang="ts">
  import { onMount, tick } from 'svelte';

  import { takeNotice } from '#lib/core/notice.ts';
  import LoadError from '#lib/core/ui/LoadError.svelte';
  import Pager, { paginate } from '#lib/core/ui/Pager.svelte';
  import { formatDuration } from '#lib/core/time.ts';
  import { nameMatcher } from '#lib/software/selection.ts';
  import type { PageProps } from './$types';

  const PAGE_SIZE = 100;
  // Members the Order column names before "and N more".
  const ORDER_SHOWN = 4;

  let { data }: PageProps = $props();

  let filterText = $state('');
  let page = $state(1);
  let filterInput: HTMLInputElement | null = $state(null);
  // What the group page that sent us here did. Shown once the status region
  // is in place, so that a screen reader reads it.
  const notice = takeNotice();
  let statusMessage = $state('');

  onMount(() => {
    if (notice) statusMessage = notice;
  });

  let filtered = $derived.by(() => {
    const match = nameMatcher(filterText.trim());
    return data.rows.filter((r) => match(r.name));
  });
  let paged = $derived(paginate(filtered, page, PAGE_SIZE));

  // The button goes with the empty result; focus stays in the filter.
  async function clearFilter(): Promise<void> {
    filterText = '';
    page = 1;
    await tick();
    filterInput?.focus();
  }
</script>

<div class="page-header">
  <div>
    <h1>Redundancy groups</h1>
  </div>
  <div class="page-actions">
    <a class="btn btn-primary" href="/groups/new">New group</a>
  </div>
</div>

<!-- In place before any message, so that a screen reader reads each one. -->
<div role="status">
  {#if statusMessage}
    <div class="success-banner status">{statusMessage}</div>
  {/if}
</div>

<section class="card">
  {#if data.loadError}
    <LoadError message={data.loadError} />
  {:else if data.rows.length === 0}
    <div class="empty-state">No redundancy groups yet.</div>
  {:else}
    <div class="filter-row">
      <input
        bind:this={filterInput}
        class="input compact mono filter-input"
        type="text"
        aria-label="Filter by name or glob"
        placeholder="Filter by name or glob"
        title="Matches part of a name, or a glob with * and ?"
        bind:value={filterText}
        oninput={() => (page = 1)}
      />
      <span class="filter-count" role="status">
        {filtered.length.toLocaleString()} of {data.rows.length.toLocaleString()}
      </span>
    </div>
    {#if filtered.length === 0}
      <div class="empty-state no-match">
        No groups match this filter.
        <button class="btn btn-secondary btn-sm" type="button" onclick={clearFilter}>Clear filter</button>
      </div>
    {:else}
      <div class="table-wrap">
        <table class="dense">
          <thead>
            <tr>
              <th>Group</th>
              <th class="right">Members</th>
              <th>Order</th>
              <th>Separation</th>
              <th class="right">Min separation</th>
              <th>On failure</th>
            </tr>
          </thead>
          <tbody>
            {#each paged.rows as row (row.name)}
              <tr>
                <td>
                  <a class="group-name mono" href={`/groups/${encodeURIComponent(row.name)}`}>{row.name}</a>
                </td>
                <td class="tn right">
                  {#if row.members.length === 0}
                    <span class="dim">0</span>
                  {:else}
                    <a class="count-link" href={`/devices?group=${encodeURIComponent(row.name)}`}>
                      {row.members.length.toLocaleString()}
                    </a>
                  {/if}
                </td>
                <td class="order mono">
                  {#each row.members.slice(0, ORDER_SHOWN) as member, i (member.name)}
                    {#if i > 0}<span class="arrow">→</span>{/if}
                    <a class="member" href={`/devices/${encodeURIComponent(member.name)}`}>{member.name}</a>
                  {:else}
                    <span class="dim">—</span>
                  {/each}
                  {#if row.members.length > ORDER_SHOWN}
                    <span class="more">and {(row.members.length - ORDER_SHOWN).toLocaleString()} more</span>
                  {/if}
                </td>
                <td>{row.policy.separationPolicy}</td>
                <td class="tn right mono">
                  {row.policy.minSeparation > 0 ? formatDuration(row.policy.minSeparation) : '—'}
                </td>
                <td>{row.policy.failurePolicy}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <Pager page={paged.page} pageCount={paged.pageCount} onchange={(p) => (page = p)} />
    {/if}
  {/if}
</section>

<style>
  .filter-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 12px;
  }

  .filter-input {
    flex: 1;
    max-width: 320px;
  }

  .filter-count {
    font-size: var(--sw-text-xs);
    color: var(--sw-text-muted);
  }

  .no-match {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 8px 12px;
  }

  /* In the card, as the empty state is. */
  .card > :global(.load-error) {
    margin-bottom: 0;
  }

  .group-name {
    font-weight: 600;
    color: var(--sw-accent-bright);
    text-decoration: none;
  }

  .group-name:hover,
  .member:hover {
    color: var(--sw-accent);
  }

  .member,
  .count-link {
    color: var(--sw-accent-bright);
    text-decoration: none;
  }

  .count-link:hover {
    color: var(--sw-accent);
    text-decoration: underline;
  }

  .order {
    font-size: var(--sw-text-sm);
  }

  .arrow {
    margin: 0 6px;
    color: var(--sw-text-muted);
  }

  .more {
    margin-left: 8px;
    color: var(--sw-text-muted);
  }

  .dim {
    color: var(--sw-text-muted);
  }

  @media (max-width: 720px) {
    .filter-input {
      flex-basis: 100%;
      max-width: none;
    }
  }
</style>
