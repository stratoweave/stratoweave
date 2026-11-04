<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';

  import { errorText } from '$lib/core/errors';
  import { leaveNotice } from '$lib/core/notice';
  import {
    getListEntryPath,
    restconfGetOrNull,
    restconfPatchJson,
    restconfPutJson,
    wrapListEntryBody
  } from '$lib/core/restconf/client';
  import ConfirmDialog from '$lib/core/ui/ConfirmDialog.svelte';
  import FieldText from '$lib/core/ui/FieldText.svelte';
  import FileDrop from '$lib/core/ui/FileDrop.svelte';
  import { focusFirstError } from '$lib/core/ui/focus';
  import TokenSelect from '$lib/core/ui/TokenSelect.svelte';
  import { deleteImage } from '$lib/software/delete-image';
  import {
    IMAGE_FILE_TYPES,
    OS_NAMES,
    familyFromName,
    imageCountLabel,
    imageErrors,
    imageFromFileName,
    knownModels,
    otherDefaults,
    previousImage,
    versionFromName,
    withDraftError,
    withModelsOf,
    type CatalogImage,
    type ImageErrors,
    type TypedImage
  } from '$lib/software/images';
  import {
    DATA_ROOT,
    IMAGES_ROOT,
    IMAGE_LIST_ROOT,
    defaultsClearPatch,
    imageCreatePatch,
    imageToJson,
    parseImages
  } from '$lib/software/model';

  interface Props {
    /** null adds a new image. */
    image: CatalogImage | null;
    /** Every image, for the name check and the suggestions. */
    images: CatalogImage[];
    /** Given, a new image can also come from dropped or chosen files.
     * `typed` is what this form held, for the file of the same name. */
    onfiles?: (files: File[], typed: TypedImage | null) => void;
  }

  let { image, images, onfiles }: Props = $props();

  const uid = $props.id();
  const isNew = untrack(() => image === null);
  const stored = untrack(() => image?.name ?? null);

  let name = $state(untrack(() => image?.name ?? ''));
  let os = $state(untrack(() => image?.os ?? ''));
  let version = $state(untrack(() => image?.version ?? ''));
  let models = $state<string[]>(untrack(() => [...(image?.models ?? [])]));
  let family = $state(untrack(() => image?.family ?? ''));
  let isDefault = $state(untrack(() => image?.isDefault ?? false));
  let modelDraft = $state('');
  // A new image takes its OS, version and family from the name until they
  // are typed.
  let osTyped = $state(!isNew);
  let versionTyped = $state(!isNew);
  let familyTyped = $state(!isNew);
  // Names read again just before an add, for one added since this page loaded.
  let lateNames = $state<string[]>([]);
  let touched = $state(false);
  let saving = $state(false);
  let deleting = $state(false);
  let confirmDelete = $state(false);
  // Files that would take the place of what is typed here, until confirmed.
  let pendingFiles = $state.raw<File[] | null>(null);
  let statusMessage = $state('');
  let form: HTMLElement | null = $state(null);

  let modelOptions = $derived(knownModels(images).map(([value, count]) => ({ value, count })));
  let osOptions = $derived([...new Set([...OS_NAMES, ...images.map((i) => i.os)])]);
  let familyOptions = $derived([...new Set(images.map((i) => i.family).filter((f) => f))]);

  // What is typed, as it would be saved.
  let current = $derived<CatalogImage>({
    name: stored ?? name.trim(),
    os: os.trim(),
    version: version.trim(),
    models,
    family: family.trim(),
    isDefault
  });
  let taken = $derived(new Set([...images.map((i) => i.name), ...lateNames]));
  let errors = $derived(withDraftError(imageErrors(current, isNew ? taken : null), modelDraft));
  let shown = $derived(touched ? errors : ({} as ImageErrors));
  let modelsMeta = $derived(shown.models ?? (modelDraft.trim() ? 'Press Enter to add it.' : ''));
  let previous = $derived(previousImage(current, images));
  // The default this image takes over; saving clears it.
  let replaces = $derived(isDefault ? otherDefaults(current, images).map((i) => i.name) : []);
  let defaultMeta = $derived(replaces.length > 0 ? `Replaces ${replaces.join(', ')} as the default.` : '');
  // An OS, version or family taken from the name comes back from the name.
  let typedAnything = $derived(
    !!name.trim() ||
      (osTyped && !!os.trim()) ||
      (versionTyped && !!version.trim()) ||
      (familyTyped && !!family.trim()) ||
      isDefault ||
      models.length > 0 ||
      !!modelDraft.trim()
  );

  function setName(next: string): void {
    name = next;
    if (!osTyped) os = imageFromFileName(next.trim()).os;
    if (!versionTyped) version = versionFromName(next.trim());
    if (!familyTyped) family = familyFromName(next.trim());
  }

  // Files take this page over, one row each. What is typed here goes to the
  // row of the same name; with no such row it would be lost, so ask first.
  function takeFiles(files: File[]): void {
    const typed = { ...current, models: [...models], draft: modelDraft };
    if (files.some((f) => f.name === typed.name)) onfiles?.(files, typed);
    else if (typedAnything) pendingFiles = files;
    else onfiles?.(files, null);
  }

  function takePendingFiles(): void {
    const files = pendingFiles;
    pendingFiles = null;
    if (files) onfiles?.(files, null);
  }

  async function save(): Promise<void> {
    touched = true;
    if (Object.keys(errors).length > 0) {
      await focusFirstError(form);
      return;
    }
    const saved = current;
    try {
      saving = true;
      statusMessage = '';
      // The list as it is now: for the name check, and for the default this
      // image takes over.
      const list = parseImages(await restconfGetOrNull<unknown>(IMAGES_ROOT));
      const clear = saved.isDefault ? otherDefaults(saved, list).map((i) => i.name) : [];
      if (stored === null) {
        // A PATCH merges into an image of the same name rather than fail.
        if (list.some((i) => i.name === saved.name)) {
          lateNames = list.map((i) => i.name);
          saving = false;
          await focusFirstError(form);
          return;
        }
        // One write adds the image and clears the old default.
        await restconfPatchJson(DATA_ROOT, imageCreatePatch([saved], clear));
      } else {
        // The old default goes first, so that the family never has two.
        if (clear.length > 0) await restconfPatchJson(DATA_ROOT, defaultsClearPatch(clear));
        // PUT replaces the whole entry, so a removed model disappears.
        await restconfPutJson(
          getListEntryPath(IMAGE_LIST_ROOT, stored),
          wrapListEntryBody(IMAGE_LIST_ROOT, imageToJson(saved))
        );
      }
      leaveNotice(stored === null ? `Added image ${saved.name}.` : `Saved image ${saved.name}.`);
      // Not a preload made before the write (hovering Cancel makes one).
      await goto('/images', { invalidateAll: true });
    } catch (saveError) {
      statusMessage = errorText(saveError, 'Failed to save the image.');
    } finally {
      saving = false;
    }
  }

  async function remove(): Promise<void> {
    confirmDelete = false;
    if (stored === null) return;
    try {
      deleting = true;
      statusMessage = '';
      await deleteImage(stored);
      leaveNotice(`Deleted image ${stored}.`);
      await goto('/images', { invalidateAll: true });
    } catch (deleteError) {
      statusMessage = errorText(deleteError, 'Failed to delete the image.');
    } finally {
      deleting = false;
    }
  }
</script>

<div class="page-header">
  <div>
    <h1 class:mono={!isNew}>{isNew ? 'Add image' : stored}</h1>
  </div>
  <div class="page-actions">
    {#if !isNew}
      <button
        class="btn btn-secondary btn-danger-ghost"
        type="button"
        disabled={saving || deleting}
        onclick={() => (confirmDelete = true)}
      >
        Delete
      </button>
    {/if}
    {#if isNew && onfiles}
      <FileDrop onfiles={takeFiles} disabled={saving} accept={IMAGE_FILE_TYPES} />
    {/if}
    <a class="btn btn-secondary" href="/images">Cancel</a>
    <button class="btn btn-primary" type="button" disabled={saving || deleting} onclick={save}>
      {saving ? 'Saving…' : isNew ? 'Add image' : 'Save'}
    </button>
  </div>
</div>

{#if statusMessage}
  <div class="error-state status" role="alert">{statusMessage}</div>
{/if}

<section bind:this={form} class="card form">
  <FieldText
    label="Name"
    required={isNew}
    value={name}
    error={shown.name}
    mono={true}
    disabled={!isNew}
    placeholder="e.g. c1100-universalk9.17.18.03a.SPA.bin"
    onchange={setName}
    ontouch={() => (touched = true)}
  />
  <div class="grid">
    <FieldText
      label="OS"
      required={true}
      value={os}
      error={shown.os}
      suggestions={osOptions}
      placeholder="e.g. IOS XE"
      onchange={(v) => {
        osTyped = true;
        os = v;
      }}
      ontouch={() => (touched = true)}
    />
    <FieldText
      label="Version"
      required={true}
      value={version}
      error={shown.version}
      mono={true}
      placeholder="e.g. 17.18.03a"
      onchange={(v) => {
        versionTyped = true;
        version = v;
      }}
      ontouch={() => (touched = true)}
    />
  </div>
  <div class="field">
    <label class="field__label" for={`${uid}-models`}>
      Models <span class="field__required" aria-hidden="true">*</span>
    </label>
    <TokenSelect
      id={`${uid}-models`}
      options={modelOptions}
      selected={models}
      label="Models"
      placeholder="add model"
      countLabel={imageCountLabel}
      required={true}
      invalid={!!shown.models}
      describedby={modelsMeta ? `${uid}-models-meta` : undefined}
      bind:draft={modelDraft}
      onchange={(next) => (models = next)}
    >
      {#if previous && previous.models.some((m) => !models.includes(m))}
        <button
          class="btn btn-secondary"
          type="button"
          title={previous.name}
          onclick={() => previous && (models = withModelsOf(models, previous))}
        >
          Copy models from {previous.version}
        </button>
      {/if}
    </TokenSelect>
    <small id={`${uid}-models-meta`} class="field__meta" class:field__meta--error={!!shown.models}>
      {modelsMeta || ' '}
    </small>
  </div>
  <div class="grid">
    <FieldText
      label="Family"
      required={isDefault}
      value={family}
      error={shown.family}
      suggestions={familyOptions}
      mono={true}
      placeholder="e.g. c1100-universalk9"
      onchange={(v) => {
        familyTyped = true;
        family = v;
      }}
      ontouch={() => (touched = true)}
    />
    <div class="field">
      <span class="field__label">Default</span>
      <label class="default-toggle">
        <input
          type="checkbox"
          bind:checked={isDefault}
          aria-describedby={defaultMeta ? `${uid}-default-meta` : undefined}
        />
        <span>Default of {family.trim() || 'its family'}</span>
      </label>
      <small id={`${uid}-default-meta`} class="field__meta">{defaultMeta || ' '}</small>
    </div>
  </div>
</section>

<ConfirmDialog
  open={confirmDelete}
  title="Delete image"
  message={`Delete ${stored} and its file?`}
  confirmLabel="Delete"
  confirmClass="btn-danger"
  oncancel={() => (confirmDelete = false)}
  onconfirm={remove}
/>

<ConfirmDialog
  open={pendingFiles !== null}
  title="Add these files instead?"
  message={name.trim()
    ? `No file is named ${name.trim()}, so what is typed in this form is not kept.`
    : 'What is typed in this form is not kept.'}
  confirmLabel="Add the files"
  cancelLabel="Keep this form"
  confirmClass="btn-primary"
  oncancel={() => (pendingFiles = null)}
  onconfirm={takePendingFiles}
/>

<style>
  .form {
    max-width: 820px;
    display: grid;
    gap: 6px;
  }

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
  }

  /* As tall as a text input, so that it lines up with Family. */
  .default-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    font-size: var(--sw-text-sm);
    cursor: pointer;
    overflow-wrap: anywhere;
  }
</style>
