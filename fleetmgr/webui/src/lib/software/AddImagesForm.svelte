<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { beforeNavigate, goto } from '$app/navigation';

  import { errorText } from '$lib/core/errors';
  import { imageFileError, imageFilesOn, uploadImageFile } from '$lib/core/image-file';
  import { leaveNotice } from '$lib/core/notice';
  import { pageLabel } from '$lib/core/page-label.svelte';
  import { restconfGetOrNull, restconfPatchJson } from '$lib/core/restconf/client';
  import ConfirmDialog from '$lib/core/ui/ConfirmDialog.svelte';
  import FileDrop from '$lib/core/ui/FileDrop.svelte';
  import { focusFirstError } from '$lib/core/ui/focus';
  import TokenSelect from '$lib/core/ui/TokenSelect.svelte';
  import {
    IMAGE_FILE_TYPES,
    OS_NAMES,
    imageCountLabel,
    imageErrors,
    imageFromFileName,
    knownModels,
    previousImage,
    withDraftError,
    withModelsOf,
    type CatalogImage,
    type ImageErrors,
    type TypedImage
  } from '$lib/software/images';
  import { DATA_ROOT, IMAGES_ROOT, imageCreatePatch, parseImages } from '$lib/software/model';

  interface Props {
    /** Image files dropped or chosen. */
    files: File[];
    /** What the one-image form held, for the row of the same name. */
    typed?: TypedImage | null;
    /** Every image, for the name check and the suggestions. */
    images: CatalogImage[];
  }

  let { files, typed = null, images }: Props = $props();

  type Upload =
    | { state: 'waiting' }
    | { state: 'sending'; sent: number }
    | { state: 'adding' }
    | { state: 'failed'; reason: string };

  interface Row extends CatalogImage {
    file: File;
    /** A model typed but not added yet. */
    draft: string;
    /** Where the row is once Upload is pressed. */
    upload?: Upload;
  }

  const uid = $props.id();
  let rows = $state<Row[]>([]);
  // Names read again just before the add, for one added since this page loaded.
  let lateNames = $state<string[]>([]);
  let touched = $state(false);
  let saving = $state(false);
  let dragging = $state(false);
  let statusMessage = $state('');
  // Whether the server has an image folder; null until it answers.
  let filesOn = $state<boolean | null>(null);
  let filesMessage = $state('');
  let card: HTMLElement | null = $state(null);
  let drop: ReturnType<typeof FileDrop> | undefined = $state();
  let running: AbortController | null = null;
  // Names uploaded and added, over every press of Upload.
  const added: string[] = [];
  // Where the operator asked to go while an upload runs.
  let leaveTo = $state<URL | null>(null);
  let leaving = false;

  addFiles(untrack(() => files), untrack(() => typed));

  onMount(() => {
    imageFilesOn().then(
      (on) => {
        filesOn = on;
        if (!on) filesMessage = 'The server has no image folder. Start it with --software.image-dir to upload images.';
      },
      (readError) => {
        filesOn = false;
        filesMessage = errorText(readError, 'Failed to read the image folder.');
      }
    );
  });

  // Leaving the page stops the upload, so it is asked first. A reload or a
  // closed tab gets the browser's own question.
  beforeNavigate(({ cancel, to, willUnload }) => {
    if (running === null || leaving) return;
    cancel();
    if (!willUnload && to) leaveTo = to.url;
  });

  function leave(): void {
    const to = leaveTo;
    leaveTo = null;
    if (!to) return;
    leaving = true;
    running?.abort();
    void goto(to);
  }

  onDestroy(() => running?.abort());

  // The route is named for one image; this page holds any number.
  $effect(() => {
    pageLabel.text = 'Add images';
    return () => {
      pageLabel.text = '';
    };
  });

  let modelOptions = $derived(knownModels(images).map(([value, count]) => ({ value, count })));
  let osOptions = $derived([...new Set([...OS_NAMES, ...images.map((i) => i.os)])]);
  // The name is the file's and cannot be changed here, so its errors say
  // how to get past them instead.
  let errors = $derived.by(() => {
    const taken = new Set([...images.map((i) => i.name), ...lateNames]);
    return rows.map((row) => {
      const e = imageErrors(row, null);
      const name = taken.has(row.name)
        ? 'Already in the image list. Remove this row, or delete that image first.'
        : imageFileError(row.file);
      return withDraftError(name ? { ...e, name } : e, row.draft);
    });
  });
  let invalidCount = $derived(errors.filter((e) => Object.keys(e).length > 0).length);
  let uploadLabel = $derived(
    rows.length === 0 ? 'Upload images' : rows.length === 1 ? 'Upload 1 image' : `Upload ${rows.length} images`
  );

  function percent(sent: number, size: number): number {
    return size > 0 ? Math.floor((sent / size) * 100) : 0;
  }

  /** One row per file name; a name already in a row is skipped. The row
   * named as in `from` starts with what was typed there. */
  function addFiles(next: File[], from: TypedImage | null = null): void {
    const names = new Set(rows.map((r) => r.name));
    for (const file of next) {
      if (names.has(file.name)) continue;
      names.add(file.name);
      const row: Row = { file, name: file.name, models: [], draft: '', ...imageFromFileName(file.name) };
      if (from?.name === file.name) {
        row.os = from.os || row.os;
        row.version = from.version || row.version;
        row.models = [...from.models];
        row.draft = from.draft;
      }
      rows.push(row);
    }
  }

  // Focus goes to the Remove of the row that took this one's place, or of
  // the one before it, or to the file chooser once no row is left.
  async function removeRow(index: number): Promise<void> {
    rows.splice(index, 1);
    await tick();
    const removes = card?.querySelectorAll<HTMLButtonElement>('.row-remove') ?? [];
    const next = removes[index] ?? removes[index - 1];
    if (next) next.focus();
    else drop?.focus();
  }

  // One file at a time: upload it, then add its entry. A row that is done
  // leaves the table; pressing Upload again sends the others from the start.
  async function upload(): Promise<void> {
    touched = true;
    if (invalidCount > 0) {
      await focusFirstError(card);
      return;
    }
    saving = true;
    statusMessage = '';
    try {
      // A PATCH merges into an image of the same name rather than fail.
      const current = parseImages(await restconfGetOrNull<unknown>(IMAGES_ROOT)).map((i) => i.name);
      if (rows.some((r) => current.includes(r.name))) {
        lateNames = current;
        saving = false;
        await focusFirstError(card);
        return;
      }
    } catch (readError) {
      statusMessage = errorText(readError, 'Failed to read the image list.');
      saving = false;
      return;
    }
    const controller = new AbortController();
    running = controller;
    const total = rows.length;
    for (const row of rows) row.upload = { state: 'waiting' };
    for (const row of [...rows]) {
      try {
        row.upload = { state: 'sending', sent: 0 };
        const onSent = (sent: number) => {
          row.upload = { state: 'sending', sent };
        };
        await uploadImageFile(row.name, row.file, onSent, controller.signal);
        row.upload = { state: 'adding' };
        const image = { name: row.name, os: row.os.trim(), version: row.version.trim(), models: row.models };
        await restconfPatchJson(DATA_ROOT, imageCreatePatch([image]));
        added.push(row.name);
        rows.splice(
          rows.findIndex((r) => r.name === row.name),
          1
        );
      } catch (uploadError) {
        if (controller.signal.aborted) return;
        row.upload = { state: 'failed', reason: errorText(uploadError, 'Failed to upload the image.') };
      }
    }
    running = null;
    saving = false;
    if (rows.length === 0) {
      leaveNotice(added.length === 1 ? `Uploaded image ${added[0]}.` : `Uploaded ${added.length} images.`);
      // Not a preload made before the write (hovering Cancel makes one).
      await goto('/images', { invalidateAll: true });
    } else {
      statusMessage = total === 1 ? 'The image was not added.' : `${rows.length} of ${total} images were not added.`;
    }
  }
</script>

<div class="page-header">
  <div>
    <h1>Add images</h1>
  </div>
  <div class="page-actions">
    <FileDrop
      bind:this={drop}
      label="Add files"
      onfiles={addFiles}
      bind:dragging
      disabled={saving}
      accept={IMAGE_FILE_TYPES}
    />
    <!-- While an upload runs, leaving asks first. -->
    <a class="btn btn-secondary" href="/images">Cancel</a>
    <button
      class="btn btn-primary"
      type="button"
      disabled={saving || rows.length === 0 || filesOn !== true}
      onclick={upload}
    >
      {saving ? 'Uploading…' : uploadLabel}
    </button>
  </div>
</div>

{#if filesMessage}
  <div class="error-state status" role="alert">{filesMessage}</div>
{/if}
{#if statusMessage}
  <div class="error-state status" role="alert">{statusMessage}</div>
{/if}

<section bind:this={card} class="card" class:dropping={dragging}>
  {#if dragging}
    <div class="drop-hint-bar"><span class="drop-hint">Drop to add rows for these files</span></div>
  {/if}
  {#if rows.length === 0}
    <div class="empty-state">No files left. Drop image files here, or choose them with Add files.</div>
  {:else}
    {#if touched && invalidCount > 0}
      <p class="invalid-summary">
        {rows.length === 1
          ? 'This image needs changes before it can be added.'
          : `${invalidCount} of ${rows.length} images need changes before they can be added.`}
      </p>
    {/if}
    <datalist id={`${uid}-os`}>
      {#each osOptions as o (o)}<option value={o}></option>{/each}
    </datalist>
    <div class="table-wrap">
      <table class="files">
        <thead>
          <tr>
            <th class="col-name">Name</th>
            <th class="col-os">OS</th>
            <th class="col-version">Version</th>
            <th>Models</th>
            <th class="col-action"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row, index (row.name)}
            {@const shown = touched ? errors[index] : ({ name: errors[index].name } as ImageErrors)}
            {@const previous = previousImage(row, images)}
            {@const id = `${uid}-${index}`}
            {@const modelsMeta = shown.models ?? (row.draft.trim() ? 'Press Enter to add it.' : '')}
            <tr>
              <td class="name-cell">
                <span class="mono name">{row.name}</span>
                {#if shown.name}
                  <small id={`${id}-name`} class="field__meta field__meta--error">{shown.name}</small>
                {:else if row.upload}
                  {@const u = row.upload}
                  {#if u.state === 'sending'}
                    {@const done = percent(u.sent, row.file.size)}
                    <div
                      class="upload-bar"
                      role="progressbar"
                      aria-label={`Upload of ${row.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={done}
                    >
                      <div class="upload-done" style:width={`${done}%`}></div>
                    </div>
                    <small class="field__meta">{done < 100 ? `Uploading, ${done}%` : 'Sent, the server is saving it'}</small>
                  {:else if u.state === 'waiting'}
                    <small class="field__meta">Waiting</small>
                  {:else if u.state === 'adding'}
                    <small class="field__meta">Adding to the list</small>
                  {:else}
                    <small class="field__meta field__meta--error">{u.reason}</small>
                  {/if}
                {/if}
              </td>
              <td class="os-cell" data-label="OS">
                <input
                  class="input compact"
                  class:has-error={!!shown.os}
                  list={`${uid}-os`}
                  aria-label={`OS of ${row.name}`}
                  aria-required="true"
                  aria-invalid={shown.os ? 'true' : undefined}
                  aria-describedby={shown.os ? `${id}-os` : undefined}
                  bind:value={row.os}
                />
                {#if shown.os}<small id={`${id}-os`} class="field__meta field__meta--error">{shown.os}</small>{/if}
              </td>
              <td class="version-cell" data-label="Version">
                <input
                  class="input compact mono"
                  class:has-error={!!shown.version}
                  aria-label={`Version of ${row.name}`}
                  aria-required="true"
                  aria-invalid={shown.version ? 'true' : undefined}
                  aria-describedby={shown.version ? `${id}-version` : undefined}
                  bind:value={row.version}
                />
                {#if shown.version}
                  <small id={`${id}-version`} class="field__meta field__meta--error">{shown.version}</small>
                {/if}
              </td>
              <td class="models-cell" data-label="Models">
                <TokenSelect
                  options={modelOptions}
                  selected={row.models}
                  label={`Models of ${row.name}`}
                  placeholder="add model"
                  countLabel={imageCountLabel}
                  required={true}
                  compact={true}
                  invalid={!!shown.models}
                  describedby={modelsMeta ? `${id}-models` : undefined}
                  bind:draft={row.draft}
                  onchange={(next) => (row.models = next)}
                >
                  {#if previous && previous.models.some((m) => !row.models.includes(m))}
                    <button
                      class="btn btn-secondary"
                      type="button"
                      title={previous.name}
                      disabled={saving}
                      onclick={() => (row.models = withModelsOf(row.models, previous))}
                    >
                      Copy models from {previous.version}
                    </button>
                  {/if}
                </TokenSelect>
                {#if modelsMeta}
                  <small id={`${id}-models`} class="field__meta" class:field__meta--error={!!shown.models}>
                    {modelsMeta}
                  </small>
                {/if}
              </td>
              <td class="col-action action-cell">
                <!-- An image that already exists has no field to fix: Remove is the way out. -->
                <button
                  class="btn btn-ghost btn-sm row-remove"
                  type="button"
                  aria-label={`Remove ${row.name}`}
                  aria-describedby={shown.name ? `${id}-name` : undefined}
                  data-error-focus={shown.name ? '' : undefined}
                  disabled={saving}
                  onclick={() => removeRow(index)}
                >
                  Remove
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<ConfirmDialog
  open={leaveTo !== null}
  title="Stop the upload?"
  message="Leaving this page stops the upload. The images uploaded so far stay in the list; the others are not added."
  confirmLabel="Stop and leave"
  cancelLabel="Keep uploading"
  confirmClass="btn-danger"
  oncancel={() => (leaveTo = null)}
  onconfirm={leave}
/>

<style>
  .invalid-summary {
    margin-bottom: 12px;
    font-size: var(--sw-text-sm);
    color: var(--sw-danger-text);
  }

  .files {
    table-layout: fixed;
    min-width: 860px;
  }

  .files td {
    vertical-align: top;
  }

  .col-name {
    width: 33%;
  }

  .col-os {
    width: 11%;
  }

  .col-version {
    width: 11%;
  }

  .col-action {
    width: 96px;
    text-align: right;
  }

  /* The name and Remove sit on the middle line of the OS, version and
     model fields beside them. */
  .name {
    display: block;
    padding-top: 8px;
    font-size: var(--sw-text-xs);
    overflow-wrap: anywhere;
  }

  .row-remove {
    margin-top: 3px;
  }

  .field__meta {
    display: block;
    margin-top: 4px;
  }

  .upload-bar {
    height: 6px;
    margin-top: 6px;
    border-radius: var(--sw-radius-sm);
    overflow: hidden;
    background: var(--sw-bg-deep);
  }

  .upload-done {
    height: 100%;
    background: var(--sw-accent);
  }

  @media (pointer: coarse) {
    .row-remove {
      margin-top: 1px;
    }
  }

  @media (max-width: 720px) {
    /* Each file becomes a block: its name with Remove, then OS and version
       side by side, then the models, each under its own label. */
    .files {
      min-width: 0;
      table-layout: auto;
    }

    .files thead {
      display: none;
    }

    .files tbody {
      display: block;
    }

    .files tr {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      grid-template-areas:
        'name name'
        'os version'
        'models models';
      gap: 10px 12px;
      padding: 14px 0;
    }

    .files tr + tr {
      border-top: 1px solid var(--sw-border-subtle);
    }

    .files td {
      display: block;
      padding: 0;
      border: none;
    }

    .files td[data-label]::before {
      content: attr(data-label);
      display: block;
      margin-bottom: 4px;
      font-size: var(--sw-text-2xs);
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--sw-text-muted);
    }

    /* Clear of Remove, which sits at the top right. */
    .files .name-cell {
      grid-area: name;
      padding-right: 80px;
    }

    .os-cell {
      grid-area: os;
    }

    .version-cell {
      grid-area: version;
    }

    .models-cell {
      grid-area: models;
    }

    .action-cell {
      position: absolute;
      top: 8px;
      right: 0;
      width: auto;
    }

    .name {
      padding-top: 0;
    }

    .row-remove {
      margin-top: 0;
    }

    tbody tr:hover td {
      background: none;
    }
  }
</style>
