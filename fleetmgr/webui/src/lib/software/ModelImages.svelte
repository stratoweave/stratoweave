<script lang="ts">
  import { imagesFor, type ModelGroup } from '$lib/software/campaign-images';
  import type { CatalogImage } from '$lib/software/images';

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

  let rows = $derived(
    groups.map((g) => {
      const choices = imagesFor(g.model, images);
      const pick = picks[g.model] ?? '';
      const chosen = choices.find((i) => i.name === pick) ?? null;
      return { ...g, choices, chosen };
    })
  );

  function devicesText(n: number): string {
    return n === 1 ? '1 device' : `${n.toLocaleString()} devices`;
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
      </tr>
    </thead>
    <tbody>
      {#each rows as row, index (row.model)}
        {@const id = `${uid}-${index}`}
        <tr>
          <td class="mono model">{row.model}</td>
          <td class="tn right" title={row.devices.join(', ')}>{row.devices.length.toLocaleString()}</td>
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
        </tr>
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
    min-width: 640px;
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

  .right {
    text-align: right;
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
