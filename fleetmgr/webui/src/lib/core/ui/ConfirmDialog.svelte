<script lang="ts">
  import { tick } from 'svelte';

  interface Props {
    open?: boolean;
    title?: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    confirmClass?: string;
    oncancel?: () => void;
    onconfirm?: () => void;
  }

  let {
    open = false,
    title = 'Confirm action',
    message = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    confirmClass = 'btn-danger',
    oncancel,
    onconfirm
  }: Props = $props();

  let cancelButton: HTMLButtonElement | null = $state(null);

  function handleKeydown(event: KeyboardEvent): void {
    if (open && event.key === 'Escape') {
      oncancel?.();
    }
  }

  $effect(() => {
    if (open) {
      tick().then(() => cancelButton?.focus());
    }
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div class="confirm-dialog__overlay">
    <button class="confirm-dialog__scrim" type="button" aria-label="Close confirmation dialog" onclick={() => oncancel?.()}></button>

    <div class="confirm-dialog__panel card" role="dialog" aria-modal="true" aria-label={title}>
      <div class="confirm-dialog__body">
        <h3>{title}</h3>
        <p>{message}</p>
      </div>

      <div class="confirm-dialog__actions">
        <button class="btn" type="button" bind:this={cancelButton} onclick={() => oncancel?.()}>
          {cancelLabel}
        </button>
        <button class={`btn ${confirmClass}`.trim()} type="button" onclick={() => onconfirm?.()}>
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .confirm-dialog__overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    padding: 1.5rem;
  }

  .confirm-dialog__scrim {
    position: absolute;
    inset: 0;
    border: 0;
    background: rgba(10, 14, 20, 0.8);
    cursor: default;
  }

  .confirm-dialog__panel {
    position: relative;
    z-index: 1;
    width: min(100%, 30rem);
    padding: 1.4rem;
    border: 1px solid var(--sw-border-default);
    background: var(--sw-bg-surface);
    box-shadow: var(--sw-shadow-elevated);
  }

  .confirm-dialog__body {
    display: grid;
    gap: 0.65rem;
  }

  .confirm-dialog__body h3 {
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

  @media (max-width: 640px) {
    .confirm-dialog__overlay {
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
