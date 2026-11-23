<script lang="ts">
  import { imagesFor, targetSplit, type ModelGroup, type TargetSplit } from '#lib/software/campaign-images.ts';
  import type { CatalogImage } from '#lib/software/images.ts';

  interface Props {
    groups: ModelGroup[];
    /** Devices that have not reported a model. */
    leftOut: string[];
    images: CatalogImage[];
    /** model -> image name; '' when none is picked. */
    picks: Record<string, string>;
    /** Show what keeps the campaign from being created. */
    showErrors?: boolean;
    onpick: (model: string, image: string) => void;
  }

  let { groups, leftOut, images, picks, showErrors = false, onpick }: Props = $props();

  const uid = $props.id();

  /** The models whose devices are listed under their row. */
  let shown = $state<Record<string, boolean>>({});

  let rows = $derived(
    groups.map((g) => {
      const choices = imagesFor(g.model, images);
      const pick = picks[g.model] ?? '';
      const chosen = choices.find((i) => i.name === pick) ?? null;
      const split = chosen === null ? null : targetSplit(g.devices, chosen.version);
      return { ...g, choices, chosen, split };
    })
  );

  function devicesText(n: number): string {
    return n === 1 ? '1 device' : `${n.toLocaleString()} devices`;
  }

  /** The names behind each count of the split column, in its order. */
  function splitNames(s: TargetSplit): [string, string[]][] {
    return [
      ['Need it', s.need],
      ['Already on it', s.onTarget],
      ['Newer', s.newer]
    ];
  }
</script>

<div class="table-wrap">
  <table class="models">
    <thead>
      <tr>
        <th class="col-model">Model</th>
        <th class="col-devices right">Devices</th>
        <th>Image</th>
        <th class="col-version">Version</th>
        <th class="col-split">Against the image</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row, index (row.model)}
        {@const id = `${uid}-${index}`}
        {@const open = shown[row.model] === true}
        <tr class:open>
          <td class="mono model">{row.model}</td>
          <td class="tn right">
            <button
              class="fold count"
              type="button"
              aria-expanded={open}
              aria-label={`${devicesText(row.devices.length)} of model ${row.model}`}
              onclick={() => (shown = { ...shown, [row.model]: !open })}
            >
              {row.devices.length.toLocaleString()}
            </button>
          </td>
          <td class="image-cell">
            {#if row.choices.length === 0}
              <span class="missing">No image lists this model.</span>
              <a class="add" href="/images/new">Add an image</a>
            {:else}
              <select
                class="select mono"
                class:has-error={showErrors && !row.chosen}
                aria-label={`Image for ${row.model}`}
                aria-invalid={showErrors && !row.chosen ? 'true' : undefined}
                aria-describedby={showErrors && !row.chosen ? `${id}-error` : undefined}
                value={row.chosen?.name ?? ''}
                onchange={(e) => onpick(row.model, e.currentTarget.value)}
              >
                {#if !row.chosen}
                  <option value="">Pick an image</option>
                {/if}
                {#each row.choices as image (image.name)}
                  <option value={image.name}>{image.name}{image.isDefault ? ' (default)' : ''}</option>
                {/each}
              </select>
              {#if showErrors && !row.chosen}
                <small id={`${id}-error`} class="field__meta field__meta--error">Pick an image.</small>
              {/if}
            {/if}
          </td>
          <td class="mono tn">{row.chosen?.version || '—'}</td>
          <td class="split">
            {#if row.split === null}
              —
            {:else}
              {@const s = row.split}
              {#if s.need.length > 0}
                <span>{s.need.length.toLocaleString()} need it</span>
              {/if}
              {#if s.onTarget.length > 0}
                <span class="on">{s.onTarget.length.toLocaleString()} already on it</span>
              {/if}
              {#if s.newer.length > 0}
                <span class="newer">{s.newer.length.toLocaleString()} newer</span>
              {/if}
            {/if}
          </td>
        </tr>
        {#if open}
          <!-- Which devices the counts cover, split as against the image. -->
          <tr class="names-row">
            <td colspan="5">
              {#if row.split === null}
                <p class="mono names">{row.devices.map((d) => d.name).join(', ')}</p>
              {:else}
                {#each splitNames(row.split) as [label, names] (label)}
                  {#if names.length > 0}
                    <p class="names">
                      <span class="names-label">{label}</span>
                      <span class="mono">{names.join(', ')}</span>
                    </p>
                  {/if}
                {/each}
              {/if}
            </td>
          </tr>
        {/if}
      {/each}
    </tbody>
  </table>
</div>

{#if leftOut.length > 0}
  <details class="left-out">
    <summary>Left out: {devicesText(leftOut.length)} without a reported model</summary>
    <p class="mono names">{leftOut.join(', ')}</p>
  </details>
{/if}

<style>
  .models {
    table-layout: fixed;
    min-width: 720px;
  }

  .col-model {
    width: 22%;
  }

  .col-devices {
    width: 10%;
  }

  .col-version {
    width: 14%;
  }

  .col-split {
    width: 20%;
  }

  .split {
    font-size: var(--sw-text-xs);
    color: var(--sw-text-secondary);
  }

  .split span + span::before {
    content: ' · ';
    color: var(--sw-text-muted);
  }

  .split .on {
    color: var(--sw-success);
  }

  .split .newer {
    color: var(--sw-warning);
  }

  .right {
    text-align: right;
  }

  /* The count opens the list of its devices. */
  .count {
    min-height: 24px;
    font-size: inherit;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  tr.open td {
    border-bottom-color: transparent;
  }

  .names-row td {
    padding-top: 0;
  }

  .names-row .names {
    margin: 0 0 4px;
  }

  .names-label {
    margin-right: 8px;
    font-family: var(--sw-font-sans);
    color: var(--sw-text-secondary);
  }

  .model {
    font-size: var(--sw-text-sm);
    overflow-wrap: anywhere;
  }

  .image-cell .select {
    width: 100%;
    max-width: 460px;
    font-size: var(--sw-text-xs);
  }

  .field__meta {
    display: block;
    margin-top: 4px;
  }

  .missing {
    color: var(--sw-warning);
    font-size: var(--sw-text-sm);
    margin-right: 10px;
  }

  .add {
    font-size: var(--sw-text-sm);
    color: var(--sw-accent-bright);
  }

  .left-out {
    margin-top: 14px;
    font-size: var(--sw-text-sm);
    color: var(--sw-text-secondary);
  }

  .left-out summary {
    cursor: pointer;
  }

  .names {
    margin: 8px 0 0;
    font-size: var(--sw-text-xs);
    color: var(--sw-text-muted);
    overflow-wrap: anywhere;
  }
</style>
