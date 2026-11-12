<script lang="ts">
  import { tick, type Snippet } from 'svelte';

  interface Props {
    open?: boolean;
    title?: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    confirmClass?: string;
    /** Confirm does nothing, as when a field below needs a fix. */
    confirmDisabled?: boolean;
    oncancel?: () => void;
    onconfirm?: () => void;
    /** Fields under the message; Enter in one confirms. The element with
     * data-autofocus gets focus, and a text field its text selected: all
     * of it, or as many characters as its data-select says. */
    children?: Snippet;
  }

  let {
    open = false,
    title = 'Confirm action',
    message = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    confirmClass = 'btn-danger',
    confirmDisabled = false,
    oncancel,
    onconfirm,
    children
  }: Props = $props();

  let dialog: HTMLDialogElement | null = $state(null);
  let cancelButton: HTMLButtonElement | null = $state(null);
  const id = $props.id();

  // showModal() traps focus and restores it to the opener on close.
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      void tick().then(focusFirst);
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  function focusFirst(): void {
    const field = dialog?.querySelector<HTMLElement>('[data-autofocus]');
    if (!field) {
      cancelButton?.focus();
      return;
    }
    field.focus();
    if (field instanceof HTMLInputElement && field.type === 'text') {
      const end = Number(field.dataset.select ?? field.value.length);
      field.setSelectionRange(0, Number.isFinite(end) ? end : field.value.length);
    }
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (!confirmDisabled) onconfirm?.();
  }

  function handleCancel(event: Event): void {
    // Escape: let the parent flip `open` instead of the browser closing us.
    event.preventDefault();
    oncancel?.();
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === dialog) oncancel?.();
  }
</script>

<dialog
  bind:this={dialog}
  class="confirm-dialog"
  aria-labelledby="{id}-title"
  aria-describedby={message ? `${id}-message` : undefined}
  oncancel={handleCancel}
  onclick={handleBackdropClick}
>
  <form class="confirm-dialog__panel card" onsubmit={submit}>
    <div class="confirm-dialog__body">
      <h2 id="{id}-title">{title}</h2>
      {#if message}
        <p id="{id}-message">{message}</p>
      {/if}
      {@render children?.()}
    </div>

    <div class="confirm-dialog__actions">
      <button class="btn" type="button" bind:this={cancelButton} onclick={() => oncancel?.()}>
        {cancelLabel}
      </button>
      <button class={`btn ${confirmClass}`.trim()} type="submit" disabled={confirmDisabled}>
        {confirmLabel}
      </button>
    </div>
  </form>
</dialog>

<style>
  .confirm-dialog {
    padding: 1.5rem;
    border: 0;
    background: transparent;
    color: inherit;
    max-width: 100vw;
    max-height: 100vh;
  }

  .confirm-dialog::backdrop {
    background: rgb(var(--sw-navy-rgb) / 0.8);
    animation: confirm-fade var(--sw-dur-base) var(--sw-ease);
  }

  .confirm-dialog__panel {
    width: min(calc(100vw - 3rem), 30rem);
    padding: 1.4rem;
    border: 1px solid var(--sw-border-default);
    background: var(--sw-bg-surface);
    box-shadow: var(--sw-shadow-elevated);
    animation: confirm-pop var(--sw-dur-base) var(--sw-ease);
  }

  @keyframes confirm-fade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  @keyframes confirm-pop {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to   { opacity: 1; transform: none; }
  }

  .confirm-dialog__body {
    display: grid;
    gap: 0.65rem;
  }

  .confirm-dialog__body h2 {
    margin: 0;
    font-size: 1.05rem;
    color: var(--sw-text-primary);
  }

  .confirm-dialog__body p {
    margin: 0;
    color: var(--sw-text-secondary);
  }

  .confirm-dialog__actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 1.25rem;
  }

  @media (max-width: 720px) {
    .confirm-dialog {
      padding: 1rem;
    }

    .confirm-dialog__actions {
      flex-direction: column-reverse;
    }

    .confirm-dialog__actions :global(.btn) {
      width: 100%;
    }
  }
</style>
