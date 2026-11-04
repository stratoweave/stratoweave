<script lang="ts">
  import type { Device } from '$lib/software/model';
  import {
    emptySelection,
    expandSelection,
    type Selection,
    type SelectionContext
  } from '$lib/software/selection';

  interface Props {
    inventory: Device[];
    owners: Map<string, string>;
    /** Schedule names, for the schedule filter. */
    schedules: string[];
    /** Held by the page, so that it outlives this component. */
    selection?: Selection;
    error?: string;
    onchange?: (names: string[]) => void;
  }

  let {
    inventory,
    owners,
    schedules,
    selection = $bindable(emptySelection()),
    error = '',
    onchange
  }: Props = $props();

  let types = $derived([...new Set(inventory.map((d) => d.type))].sort());
  // '' stands for devices that have not reported a model or version; it
  // sorts first.
  let models = $derived([...new Set(inventory.map((d) => d.model))].sort());
  let versions = $derived([...new Set(inventory.map((d) => d.version))].sort());
  let context = $derived<SelectionContext>({ owners });
  let expansion = $derived(expandSelection(selection, inventory, context));

  $effect(() => {
    onchange?.(expansion.names);
  });

  function patch(partial: Partial<Selection>): void {
    selection = { ...selection, ...partial };
  }

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function barsOf(counts: Record<string, number>): { name: string; n: number; w: number }[] {
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const max = Math.max(1, ...rows.map(([, n]) => n));
    return rows.map(([name, n]) => ({ name, n, w: (n / max) * 100 }));
  }

  let typeBars = $derived(barsOf(expansion.byType));
  let modelBars = $derived(barsOf(expansion.byModel));

  const NOT_REPORTED = 'not reported';
</script>

{#snippet tokens(values: string[], picked: string[], set: (next: string[]) => void)}
  <span class="fvalue tokens">
    {#each values as v (v)}
      <button
        class="tok"
        class:on={picked.includes(v)}
        class:none={v === ''}
        aria-pressed={picked.includes(v)}
        type="button"
        onclick={() => set(toggle(picked, v))}
      >
        {v || NOT_REPORTED}
      </button>
    {/each}
    {#if picked.length === 0}
      <span class="hint">all</span>
    {/if}
  </span>
{/snippet}

{#snippet bars(title: string, rows: { name: string; n: number; w: number }[])}
  <div>
    <div class="kick" style:margin-bottom="10px">{title}</div>
    {#each rows as b (b.name)}
      <div class="bar-row">
        <span class="mono bar-name" title={b.name || NOT_REPORTED}>{b.name || NOT_REPORTED}</span>
        <span class="bar-track"><span class="bar-fill" style:width={`${b.w}%`}></span></span>
        <span class="mono tn bar-n">{b.n.toLocaleString()}</span>
      </div>
    {/each}
  </div>
{/snippet}

<div class="builder">
  <div class="filters-side">
    <div class="filters-head">
      <span class="kick">Filters — devices matching all of these</span>
      <span class="hint">from the fleet inventory</span>
    </div>
    <div class="filters">
      <div class="frow">
        <span class="flabel">Device type</span>
        <span class="fop">is any of</span>
        {#if types.length === 0}
          <span class="hint">no devices</span>
        {:else}
          {@render tokens(types, selection.types, (next) => patch({ types: next }))}
        {/if}
      </div>
      <div class="andr">AND</div>
      <div class="frow">
        <span class="flabel">Model</span>
        <span class="fop">is any of</span>
        {@render tokens(models, selection.models, (next) => patch({ models: next }))}
      </div>
      <div class="andr">AND</div>
      <div class="frow">
        <span class="flabel">Version</span>
        <span class="fop">is any of</span>
        {@render tokens(versions, selection.versions, (next) => patch({ versions: next }))}
      </div>
      <div class="andr">AND</div>
      <div class="frow">
        <span class="flabel">Name</span>
        <span class="fop">matches</span>
        <input
          class="fld mono"
          type="text"
          aria-label="Name matches"
          placeholder="substring, or glob with * and ?"
          value={selection.namePattern}
          oninput={(e) => patch({ namePattern: e.currentTarget.value })}
        />
      </div>
      <div class="andr">AND</div>
      <div class="frow">
        <span class="flabel">Address</span>
        <span class="fop">contains</span>
        <input
          class="fld mono"
          type="text"
          aria-label="Address contains"
          placeholder="anything"
          value={selection.addressContains}
          oninput={(e) => patch({ addressContains: e.currentTarget.value })}
        />
      </div>
      <div class="andr">AND</div>
      <div class="frow">
        <span class="flabel">Description</span>
        <span class="fop">contains</span>
        <input
          class="fld"
          type="text"
          aria-label="Description contains"
          placeholder="anything"
          value={selection.descriptionContains}
          oninput={(e) => patch({ descriptionContains: e.currentTarget.value })}
        />
      </div>
      <div class="andr">AND</div>
      <div class="frow">
        <span class="flabel">Schedule</span>
        <span class="fop">is</span>
        <select
          class="select"
          aria-label="Schedule"
          value={selection.schedule}
          onchange={(e) => patch({ schedule: e.currentTarget.value })}
        >
          <option value="">any</option>
          <option value="none">no schedule</option>
          {#each schedules as name (name)}
            <option value={`=${name}`}>{name}</option>
          {/each}
        </select>
      </div>
    </div>

    <textarea
      class="input mono"
      rows="3"
      aria-label="Explicit device names"
      placeholder="optional: explicit names, one per line or comma-separated — used instead of the whole inventory"
      value={selection.pasted}
      oninput={(e) => patch({ pasted: e.currentTarget.value })}
    ></textarea>

    <div class="count-row">
      <div>
        <div class="count tn" class:empty={expansion.names.length === 0}>
          {expansion.names.length.toLocaleString()}
        </div>
        <div class="hint">devices match now</div>
      </div>
      {#if error}
        <span class="err">{error}</span>
      {/if}
    </div>

    {#if typeBars.length > 0}
      <div class="dists">
        {@render bars('Matched by type', typeBars)}
        {@render bars('Matched by model', modelBars)}
      </div>
    {/if}
  </div>

  <div class="rail">
    <div class="kick" style:margin-bottom="12px">Excluded, and why</div>
    {#if expansion.excluded.length === 0}
      <div class="hint">Nothing excluded.</div>
    {/if}
    {#each expansion.excluded as e (e.what)}
      <div class="excl">
        <span class="excl-n tn">{e.n.toLocaleString()}</span>
        <div class="excl-body">
          <div class="excl-what">{e.what}</div>
          <div class="mono excl-path">{e.path}</div>
        </div>
      </div>
    {/each}

    {#if expansion.sample.length > 0}
      <div class="kick" style:margin="20px 0 10px">Sample of the match</div>
      <table class="sample">
        <tbody>
          {#each expansion.sample as d (d.name)}
            <tr>
              <td class="mono sname">{d.name}</td>
              <td class="mono stype">{d.model || NOT_REPORTED}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if expansion.names.length > expansion.sample.length}
        <div class="hint tn" style:margin-top="8px">
          … and {(expansion.names.length - expansion.sample.length).toLocaleString()} more
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .builder {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
    gap: 26px;
  }

  @media (max-width: 900px) {
    .builder {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .filters-side {
    display: grid;
    gap: 13px;
    align-content: start;
  }

  .filters-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 4px 12px;
  }

  .filters {
    border: 1px solid var(--sw-border-subtle);
    border-radius: var(--sw-radius-md);
    background: var(--sw-bg-elevated);
    padding: 14px 16px;
    display: grid;
    gap: 9px;
  }

  .frow {
    display: grid;
    grid-template-columns: 160px 90px minmax(0, 1fr);
    gap: 9px;
    align-items: center;
  }

  /* On a phone the field and its operator share a line; the value takes
     the next one. */
  @media (max-width: 560px) {
    .frow {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .frow > :last-child {
      grid-column: 1 / -1;
    }
  }

  .flabel,
  .fop {
    background: var(--sw-bg-card);
    border: 1px solid var(--sw-border-default);
    border-radius: var(--sw-radius-sm);
    padding: 7px 10px;
    font-size: var(--sw-text-sm);
  }

  .fop {
    color: var(--sw-text-secondary);
  }

  .fld {
    background: var(--sw-bg-input);
    border: 1px solid var(--sw-border-default);
    border-radius: var(--sw-radius-sm);
    color: var(--sw-text-primary);
    padding: 7px 10px;
    font-size: var(--sw-text-sm);
    outline: none;
    width: 100%;
  }

  .frow .select {
    width: 100%;
    padding-top: 7px;
    padding-bottom: 7px;
    border-radius: var(--sw-radius-sm);
    font-size: var(--sw-text-sm);
  }

  .fld::placeholder {
    color: var(--sw-text-muted);
  }

  /* The same focus as every other text field. */
  .fld:focus-visible {
    border-color: var(--sw-accent);
    box-shadow: 0 0 0 3px var(--sw-accent-glow);
  }

  .fvalue.tokens {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .tok {
    display: inline-flex;
    align-items: center;
    background: none;
    border: 1px dashed var(--sw-border-default);
    border-radius: var(--sw-radius-xs);
    padding: 3px 8px;
    font-family: var(--sw-font-mono, monospace);
    font-size: var(--sw-text-xs);
    color: var(--sw-text-secondary);
    cursor: pointer;
  }

  .tok.on {
    background: var(--sw-accent-glow);
    border: 1px solid var(--sw-accent-glow-strong);
    color: var(--sw-accent-bright);
  }

  /* "not reported" is not a value the device has. */
  .tok.none {
    font-family: inherit;
    font-style: italic;
  }

  .andr {
    font-size: var(--sw-text-2xs);
    font-weight: 500;
    letter-spacing: 0.1em;
    color: var(--sw-text-muted);
    padding-left: 4px;
  }

  .count-row {
    display: flex;
    align-items: baseline;
    gap: 26px;
    padding: 12px 0;
    border-top: 1px solid var(--sw-border-subtle);
    border-bottom: 1px solid var(--sw-border-subtle);
  }

  .count {
    font-size: var(--sw-text-3xl);
    font-weight: 600;
    line-height: 1;
  }

  .count.empty {
    color: var(--sw-text-muted);
  }

  .err {
    font-size: 12px;
    color: var(--sw-danger-text);
  }

  .dists {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 20px 26px;
  }

  .bar-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 5px;
  }

  .bar-name {
    width: 110px;
    color: var(--sw-text-muted);
    font-size: var(--sw-text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar-track {
    flex: 1;
    height: 7px;
    border-radius: var(--sw-radius-xs);
    background: var(--sw-bg-hover);
    overflow: hidden;
    display: block;
  }

  .bar-fill {
    display: block;
    height: 100%;
    border-radius: var(--sw-radius-xs);
    background: var(--sw-primary);
  }

  .bar-n {
    width: 42px;
    text-align: right;
    color: var(--sw-text-secondary);
    font-size: var(--sw-text-xs);
  }

  .rail {
    border-left: 1px solid var(--sw-border-subtle);
    padding-left: 26px;
  }

  @media (max-width: 900px) {
    .rail {
      border-left: none;
      padding-left: 0;
    }
  }

  .excl {
    display: flex;
    gap: 14px;
    padding: 10px 0;
    border-bottom: 1px solid var(--sw-border-subtle);
  }

  .excl-n {
    font-size: var(--sw-text-xl);
    font-weight: 600;
    width: 50px;
    text-align: right;
    color: var(--sw-text-secondary);
    flex-shrink: 0;
  }

  .excl-what {
    font-size: var(--sw-text-sm);
  }

  .excl-path {
    color: var(--sw-text-muted);
    margin-top: 2px;
    font-size: 11px;
    word-break: break-all;
  }

  .sample {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .sample td {
    padding: 6px 0;
    border-bottom: 1px solid var(--sw-border-subtle);
  }

  .sname {
    color: var(--sw-accent-bright);
  }

  .stype {
    color: var(--sw-text-muted);
  }

  .hint {
    font-size: 12px;
    color: var(--sw-text-muted);
  }
</style>
