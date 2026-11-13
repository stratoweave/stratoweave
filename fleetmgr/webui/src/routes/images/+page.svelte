<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { invalidate } from '$app/navigation';

  import { errorText } from '#lib/core/errors.ts';
  import { restconfPatchJson } from '#lib/core/restconf/client.ts';
  import { takeNotice } from '#lib/core/notice.ts';
  import FileDrop from '#lib/core/ui/FileDrop.svelte';
  import ImageDrive from '#lib/software/ImageDrive.svelte';
  import { addImageFiles } from '#lib/software/image-files.ts';
  import { buildTree } from '#lib/software/image-tree.ts';
  import { IMAGE_FILE_TYPES } from '#lib/software/images.ts';
  import { DATA_ROOT, urlBasePatch } from '#lib/software/model.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  let dragging = $state(false);
  let statusMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);
  let drive: ReturnType<typeof ImageDrive> | undefined = $state();
  // What the add or edit page that sent us here did. Taken now, shown once
  // the status region is in place, so that a screen reader reads it.
  const notice = takeNotice();

  let tree = $derived(buildTree(data.images, data.listing));
  let addHref = $derived(data.folder ? `/images/new?${new URLSearchParams({ folder: data.folder })}` : '/images/new');

  // Where devices fetch the images from, as typed here until saved.
  let urlBase = $state(untrack(() => data.urlBase));
  let savingUrlBase = $state(false);

  async function saveUrlBase(): Promise<void> {
    try {
      savingUrlBase = true;
      statusMessage = null;
      await restconfPatchJson(DATA_ROOT, urlBasePatch(urlBase.trim()));
      statusMessage = { type: 'success', text: 'Saved the image URL base.' };
      await invalidate('data:images');
      urlBase = data.urlBase;
    } catch (saveError) {
      statusMessage = { type: 'error', text: errorText(saveError, 'Failed to save the image URL base.') };
    } finally {
      savingUrlBase = false;
    }
  }

  onMount(() => {
    if (notice) statusMessage = { type: 'success', text: notice };
  });

  // What a change did belongs to the folder it was made in.
  let shownFolder = untrack(() => data.folder);
  $effect(() => {
    if (data.folder === shownFolder) return;
    shownFolder = data.folder;
    statusMessage = null;
  });
</script>

<div class="page-header">
  <div>
    <h1>Images</h1>
    <p>
      Software images, kept in folders, with the OS each runs and the hardware models it is for. Drop image files
      anywhere on this page to upload them into the folder you are in.
    </p>
  </div>
  <div class="page-actions">
    <button
      class="btn btn-secondary"
      type="button"
      disabled={!!data.loadError || !tree.filesOn}
      onclick={() => drive?.newFolder()}
    >
      New folder
    </button>
    <!-- An upload checks its names against the list, so it needs the list. -->
    <FileDrop
      onfiles={(files) => void addImageFiles(files, data.folder)}
      bind:dragging
      disabled={!!data.loadError}
      accept={IMAGE_FILE_TYPES}
    />
    <a class="btn btn-primary" href={addHref}>Add image</a>
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
  {#if data.filesError}
    <div class="error-state status">{data.filesError}</div>
  {/if}

  <section class="card url-base">
    <label class="field url-field">
      <span class="field__label">Image URL base</span>
      <input
        class="input mono"
        placeholder="e.g. scp://user:password@host:/images/"
        value={urlBase}
        oninput={(e) => (urlBase = e.currentTarget.value)}
      />
      <small class="field__meta">A device fetches an image from this followed by the path of its file.</small>
    </label>
    <button
      class="btn btn-secondary"
      type="button"
      disabled={savingUrlBase || urlBase.trim() === data.urlBase}
      onclick={saveUrlBase}
    >
      {savingUrlBase ? 'Saving…' : 'Save'}
    </button>
  </section>

  <!-- A folder of its own each: selection, search and paging start over. -->
  {#key data.folder}
    <ImageDrive
      bind:this={drive}
      folder={data.folder}
      {tree}
      inUse={data.inUse}
      {dragging}
      onstatus={(s) => (statusMessage = s)}
    />
  {/key}
{/if}

<style>
  .url-base {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }

  .url-field {
    flex: 1;
    max-width: 640px;
  }

  .url-field .field__meta {
    margin-top: 4px;
  }
</style>
