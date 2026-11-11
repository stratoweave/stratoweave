<script lang="ts">
  import { onMount } from 'svelte';

  import { takeNotice } from '#lib/core/notice.ts';
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
</script>

<div class="page-header">
  <div>
    <h1>Redundancy groups</h1>
  </div>
  <div class="page-actions">
    <a class="btn btn-primary" href="/groups/new">New group</a>
  </div>
</div>

{#if data.loadError}
  <div class="error-state status">{data.loadError}</div>
{/if}

{#if statusMessage}
  <div class="success-banner status">{statusMessage}</div>
{/if}

<section class="card">
  {#if data.rows.length === 0}
    <div class="empty-state">No redundancy groups yet.</div>
  {:else}
    <div class="filter-row">
      <input
        class="input compact mono filter-input"
        type="text"
        aria-label="Filter by name"
        placeholder="filter by name (glob with * and ?)"
        bind:value={filterText}
        oninput={() => (page = 1)}
      />
      <span class="filter-count">{filtered.length} of {data.rows.length}</span>
    </div>
    <div class="table-wrap">
      <table class="dense">
        <thead>
          <tr>
            <th>Group</th>
            <th class="right">Members</th>
            <th>Order</th>
            <th>Separation</th>
            <th class="right">Min separation</th>
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
              <td>{row.separation.policy}</td>
              <td class="tn right mono">
                {row.separation.minSeparation > 0 ? formatDuration(row.separation.minSeparation) : '—'}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <Pager page={paged.page} pageCount={paged.pageCount} onchange={(p) => (page = p)} />
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
    font-size: 12px;
    color: var(--sw-text-muted);
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
