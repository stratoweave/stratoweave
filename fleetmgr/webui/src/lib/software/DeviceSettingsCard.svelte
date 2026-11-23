<script lang="ts" generics="D">
  // One card of a device's settings: its fields, and a Save and a Reset for
  // them alone. It shows the settings as last read until they are edited,
  // and a poll never overwrites an edit.
  import { untrack, type Snippet } from 'svelte';

  import { errorText } from '#lib/core/errors.ts';
  import ConfirmDialog from '#lib/core/ui/ConfirmDialog.svelte';
  import { focusFirstError } from '#lib/core/ui/focus.ts';
  import type { CardFields, Errors } from '#lib/software/device-config.ts';

  interface Props {
    title: string;
    yangPath?: string;
    /** Its heading folds it; `open` says whether it starts open. */
    fold?: boolean;
    open?: boolean;
    /** The settings as last read. */
    read: D;
    same: (a: D, b: D) => boolean;
    validate: (draft: D) => Errors;
    /** Writes what `draft` changed from `base`, the read it was edited from. */
    save: (draft: D, base: D) => Promise<void>;
    /** Reads the device again; resolves once `read` has the new read. */
    reload: () => Promise<void>;
    /** A question to answer before each save. */
    confirm?: { title: string; message: string; label: string };
    /** Whether it has changes to save. */
    dirty?: boolean;
    fields: Snippet<[CardFields<D>]>;
  }

  let {
    title,
    yangPath = '',
    fold = false,
    open: openAtFirst = true,
    read,
    same,
    validate,
    save,
    reload,
    confirm,
    dirty = $bindable(false),
    fields
  }: Props = $props();

  let open = $state(untrack(() => openAtFirst));
  // null follows the device as polled; an edit holds until it is saved or reset.
  let edit = $state.raw<D | null>(null);
  // The read the edit started from. A save writes only what the edit changed
  // from it, so that what someone else changed meanwhile stays.
  let base: D | null = null;
  let touched = $state(false);
  let saving = $state(false);
  let confirming = $state(false);
  let message = $state<{ type: 'success' | 'error'; text: string } | null>(null);
  let card: HTMLElement | null = $state(null);

  let draft = $derived(edit ?? read);
  let changed = $derived(edit !== null && !same(edit, read));
  let errors = $derived(validate(draft));

  $effect(() => {
    dirty = changed;
  });

  function set(next: D): void {
    if (edit === null) base = read;
    edit = next;
    message = null;
  }

  function reset(): void {
    edit = null;
    base = null;
    touched = false;
    message = null;
  }

  async function trySave(): Promise<void> {
    touched = true;
    if (Object.keys(errors).length > 0) {
      await focusFirstError(card);
      return;
    }
    if (confirm) confirming = true;
    else await commit();
  }

  async function commit(): Promise<void> {
    confirming = false;
    const next = edit;
    if (next === null) return;
    try {
      saving = true;
      message = null;
      await save(next, base ?? read);
      // The edit shows until the read after the write is in.
      await reload();
      edit = null;
      base = null;
      touched = false;
      message = { type: 'success', text: 'Saved.' };
    } catch (saveError) {
      message = { type: 'error', text: errorText(saveError, 'Failed to save.') };
    } finally {
      saving = false;
    }
  }
</script>

<section class="card" bind:this={card}>
  {#if fold}
    <h2 class="fold-heading" title={yangPath ? `YANG: ${yangPath}` : undefined}>
      <button class="fold" type="button" aria-expanded={open} onclick={() => (open = !open)}>{title}</button>
      {#if !open && changed}
        <span class="unsaved">Unsaved changes</span>
      {/if}
    </h2>
  {:else}
    <h2 class="panel-title" title={yangPath ? `YANG: ${yangPath}` : undefined}>{title}</h2>
  {/if}
  {#if open}
    <div class="body" class:below-fold={fold}>
      {@render fields({
        draft,
        set,
        errors: touched ? errors : {},
        touch: () => (touched = true),
        disabled: saving
      })}
    </div>
    <div class="actions">
      <!-- In place before any message, so that a screen reader reads each one. -->
      <span role="status">
        {#if message?.type === 'success'}<span class="save-ok">{message.text}</span>{/if}
      </span>
      <span role="alert">
        {#if message?.type === 'error'}<span class="save-error">{message.text}</span>{/if}
      </span>
      <button class="btn btn-secondary" type="button" disabled={saving || !changed} onclick={reset}>Reset</button>
      <button class="btn btn-primary" type="button" disabled={saving || !changed} onclick={trySave}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  {/if}
</section>

{#if confirm}
  <ConfirmDialog
    open={confirming}
    title={confirm.title}
    message={confirm.message}
    confirmLabel={confirm.label}
    confirmClass="btn-primary"
    oncancel={() => (confirming = false)}
    onconfirm={commit}
  />
{/if}

<style>
  .fold-heading {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin: 0;
    font-size: inherit;
  }

  .unsaved {
    font-size: var(--sw-text-xs);
    font-weight: 400;
    color: var(--sw-text-muted);
  }

  .below-fold {
    margin-top: var(--sw-space-4);
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 4px;
  }

  .save-ok {
    font-size: var(--sw-text-xs);
    color: var(--sw-text-secondary);
  }

  .save-error {
    font-size: var(--sw-text-xs);
    color: var(--sw-danger-text);
  }
</style>
