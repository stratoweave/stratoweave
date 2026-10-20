<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';

  import { errorText } from '$lib/core/errors';
  import {
    getListEntryPath,
    restconfDelete,
    restconfGetOrNull,
    restconfPatchJson,
    restconfPutJson,
    wrapListEntryBody
  } from '$lib/core/restconf/client';
  import ConfirmDialog from '$lib/core/ui/ConfirmDialog.svelte';
  import FieldText from '$lib/core/ui/FieldText.svelte';
  import { focusFirstError } from '$lib/core/ui/focus';
  import TokenSelect from '$lib/core/ui/TokenSelect.svelte';
  import { OS_NAMES, imageCountLabel, knownModels, versionFromName, type CatalogImage } from '$lib/software/images';
  import {
    DATA_ROOT,
    IMAGES_ROOT,
    IMAGE_LIST_ROOT,
    imageCreatePatch,
    imageToJson,
    parseImages
  } from '$lib/software/model';

  interface Props {
    /** null adds a new image. */
    image: CatalogImage | null;
    /** Every image, for the name check and the suggestions. */
    images: CatalogImage[];
  }

  let { image, images }: Props = $props();

  const uid = $props.id();
  const isNew = untrack(() => image === null);
  const stored = untrack(() => image?.name ?? null);

  let name = $state(untrack(() => image?.name ?? ''));
  let os = $state(untrack(() => image?.os ?? ''));
  let version = $state(untrack(() => image?.version ?? ''));
  let models = $state<string[]>(untrack(() => [...(image?.models ?? [])]));
  let modelDraft = $state('');
  // A new image takes its version from the name until the version is typed.
  let versionTyped = $state(!isNew);
  // Names read again just before an add, for one added since this page loaded.
  let lateNames = $state<string[]>([]);
  let touched = $state(false);
  let saving = $state(false);
  let deleting = $state(false);
  let confirmDelete = $state(false);
  let statusMessage = $state('');
  let form: HTMLElement | null = $state(null);

  let modelOptions = $derived(knownModels(images).map(([value, count]) => ({ value, count })));
  let osOptions = $derived([...new Set([...OS_NAMES, ...images.map((i) => i.os)])]);

  let errors = $derived.by(() => {
    const e: Record<string, string> = {};
    const n = name.trim();
    if (isNew) {
      if (!n) e.name = 'Required.';
      else if (images.some((i) => i.name === n) || lateNames.includes(n)) e.name = 'Already exists.';
    }
    if (!os.trim()) e.os = 'Required.';
    if (!version.trim()) e.version = 'Required.';
    if (models.length === 0) e.models = 'At least one model.';
    // A model typed but not added yet keeps the image from being saved, so
    // that it is not lost.
    const d = modelDraft.trim();
    if (d) e.models = `Press Enter to add ${d}, or clear the field.`;
    return e;
  });
  let shown = $derived(touched ? errors : ({} as Record<string, string>));
  let modelsMeta = $derived(shown.models ?? (modelDraft.trim() ? 'Press Enter to add it.' : ''));

  function setName(next: string): void {
    name = next;
    if (!versionTyped) version = versionFromName(next.trim());
  }

  async function save(): Promise<void> {
    touched = true;
    if (Object.keys(errors).length > 0) {
      await focusFirstError(form);
      return;
    }
    const saved = { name: stored ?? name.trim(), os: os.trim(), version: version.trim(), models };
    try {
      saving = true;
      statusMessage = '';
      if (stored === null) {
        // A PATCH merges into an image of the same name rather than fail.
        const current = parseImages(await restconfGetOrNull<unknown>(IMAGES_ROOT)).map((i) => i.name);
        if (current.includes(saved.name)) {
          lateNames = current;
          saving = false;
          await focusFirstError(form);
          return;
        }
        await restconfPatchJson(DATA_ROOT, imageCreatePatch(saved));
      } else {
        // PUT replaces the whole entry, so a removed model disappears.
        await restconfPutJson(
          getListEntryPath(IMAGE_LIST_ROOT, stored),
          wrapListEntryBody(IMAGE_LIST_ROOT, imageToJson(saved))
        );
      }
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
      await restconfDelete(getListEntryPath(IMAGE_LIST_ROOT, stored));
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
      onchange={(v) => (os = v)}
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
    <span class="field__label">Models <span class="field__required" aria-hidden="true">*</span></span>
    <TokenSelect
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
    />
    <small id={`${uid}-models-meta`} class="field__meta" class:field__meta--error={!!shown.models}>
      {modelsMeta || ' '}
    </small>
  </div>
</section>

<ConfirmDialog
  open={confirmDelete}
  title="Delete image"
  message={`Delete ${stored}?`}
  confirmLabel="Delete"
  confirmClass="btn-danger"
  oncancel={() => (confirmDelete = false)}
  onconfirm={remove}
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
</style>
