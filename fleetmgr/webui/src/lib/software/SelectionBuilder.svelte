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
    error?: string;
    onchange?: (names: string[]) => void;
  }

  let { inventory, owners, error = '', onchange }: Props = $props();

  let selection = $state<Selection>(emptySelection());
  let types = $derived([...new Set(inventory.map((d) => d.type))].sort());
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

  let bars = $derived.by(() => {
    const rows = Object.entries(expansion.byType).sort();
    const max = Math.max(1, ...rows.map(([, n]) => n));
    return rows.map(([name, n]) => ({ name, n, w: (n / max) * 100 }));
  });
</script>

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
        <span class="fvalue tokens">
          {#if types.length === 0}
            <span class="hint">no devices</span>
          {/if}
          {#each types as t (t)}
            <button
              class="tok"
              class:on={selection.types.includes(t)}
              type="button"
              onclick={() => patch({ types: toggle(selection.types, t) })}
            >
              {t}
            </button>
          {/each}
          {#if selection.types.length === 0}
            <span class="hint">all</span>
          {/if}
        </span>
      </div>
      <div class="andr">AND</div>
      <div class="frow">
        <span class="flabel">Name</span>
        <span class="fop">matches</span>
        <input
          class="fld mono"
          type="text"
          placeholder="substring, or glob with * and ?"
          value={selection.namePattern}
          oninput={(e) => patch({ namePattern: e.currentTarget.value })}
        />
      </div>
      <div class="andr">AND</div>
      <div class="frow">
        <span class="flabel">Description</span>
        <span class="fop">contains</span>
        <input
          class="fld"
          type="text"
          placeholder="anything"
          value={selection.descriptionContains}
          oninput={(e) => patch({ descriptionContains: e.currentTarget.value })}
        />
      </div>
      <div class="andr">AND</div>
      <div class="frow">
        <span class="flabel">Requires approval</span>
        <span class="fop">is</span>
        <select
          class="fld"
          value={selection.requiresApproval}
          onchange={(e) => patch({ requiresApproval: e.currentTarget.value as '' | 'yes' | 'no' })}
        >
          <option value="">any</option>
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </select>
      </div>
      <div class="andr">AND</div>
      <div class="frow">
        <span class="flabel">Owned by a campaign</span>
        <span class="fop">is</span>
        <select
          class="fld"
          value={selection.ownedByCampaign}
          onchange={(e) => patch({ ownedByCampaign: e.currentTarget.value as '' | 'yes' | 'no' })}
        >
          <option value="no">No</option>
          <option value="yes">Yes</option>
          <option value="">any</option>
        </select>
      </div>
    </div>

    <textarea
      class="paste mono"
      rows="3"
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

    <div class="dists">
      {#if bars.length > 0}
        <div>
          <div class="kick" style:margin-bottom="10px">Matched by type</div>
          {#each bars as b (b.name)}
            <div class="bar-row">
              <span class="mono bar-name">{b.name}</span>
              <span class="bar-track"><span class="bar-fill" style:width={`${b.w}%`}></span></span>
              <span class="mono tn bar-n">{b.n.toLocaleString()}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
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
              <td class="mono stype">{d.type}</td>
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
    grid-template-columns: 1fr 280px;
    gap: 26px;
  }

  @media (max-width: 900px) {
    .builder {
      grid-template-columns: 1fr;
    }
  }

  .filters-side {
    display: grid;
    gap: 13px;
    align-content: start;
  }

  .filters-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  .filters {
    border: 1px solid var(--sw-border-subtle);
    border-radius: 8px;
    background: var(--sw-bg-elevated);
    padding: 14px 16px;
    display: grid;
    gap: 9px;
  }

  .frow {
    display: grid;
    grid-template-columns: 160px 90px 1fr;
    gap: 9px;
    align-items: center;
  }

  .flabel,
  .fop {
    background: var(--sw-bg-card);
    border: 1px solid var(--sw-border-default);
    border-radius: 6px;
    padding: 7px 10px;
    font-size: 12.5px;
  }

  .fop {
    color: var(--sw-text-secondary);
  }

  .fld {
    background: var(--sw-bg-input);
    border: 1px solid var(--sw-border-default);
    border-radius: 6px;
    color: var(--sw-text-primary);
    padding: 7px 10px;
    font-size: 12.5px;
    outline: none;
    width: 100%;
  }

  .fld:focus-visible {
    outline: 2px solid var(--sw-primary);
    outline-offset: 1px;
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
    border-radius: 4px;
    padding: 3px 8px;
    font-family: var(--sw-font-mono, monospace);
    font-size: 11.5px;
    color: var(--sw-text-secondary);
    cursor: pointer;
  }

  .tok.on {
    background: var(--sw-accent-glow);
    border: 1px solid var(--sw-accent-glow-strong);
    color: var(--sw-accent-bright);
  }

  .andr {
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.1em;
    color: var(--sw-text-muted);
    padding-left: 4px;
  }

  .paste {
    width: 100%;
    padding: 9px 12px;
    background: var(--sw-bg-input);
    border: 1px solid var(--sw-border-default);
    border-radius: 6px;
    color: var(--sw-text-primary);
    font-size: 12px;
    resize: vertical;
    outline: none;
    white-space: pre;
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
    font-size: 42px;
    font-weight: 600;
    line-height: 1;
  }

  .count.empty {
    color: var(--sw-text-muted);
  }

  .err {
    font-size: 12px;
    color: var(--sw-danger);
  }

  .dists {
    display: grid;
    grid-template-columns: 1fr;
  }

  .bar-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 5px;
  }

  .bar-name {
    width: 80px;
    color: var(--sw-text-muted);
    font-size: 11.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar-track {
    flex: 1;
    height: 7px;
    border-radius: 4px;
    background: var(--sw-bg-hover);
    overflow: hidden;
    display: block;
  }

  .bar-fill {
    display: block;
    height: 100%;
    border-radius: 4px;
    background: var(--sw-primary);
  }

  .bar-n {
    width: 42px;
    text-align: right;
    color: var(--sw-text-secondary);
    font-size: 11.5px;
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
    font-size: 19px;
    font-weight: 600;
    width: 50px;
    text-align: right;
    color: var(--sw-text-secondary);
    flex-shrink: 0;
  }

  .excl-what {
    font-size: 12.5px;
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

  .mono {
    font-family: var(--sw-font-mono, ui-monospace, monospace);
  }

  .tn {
    font-variant-numeric: tabular-nums;
  }
</style>
