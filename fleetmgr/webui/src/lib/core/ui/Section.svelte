<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title?: string;
    description?: string;
    yangPath?: string;
    children?: Snippet;
    actions?: Snippet;
  }

  let { title = '', description = '', yangPath = '', children, actions }: Props = $props();
</script>

<section class="section">
  <header class="section__header">
    <div class="section__title-group">
      <!-- The YANG path is for the people who know the model; it stays out
           of the way as the heading's tooltip. -->
      <h2 title={yangPath ? `YANG: ${yangPath}` : undefined}>{title}</h2>
      {#if description}
        <p>{description}</p>
      {/if}
    </div>
    {#if actions}
      <div class="section__meta">
        {@render actions()}
      </div>
    {/if}
  </header>

  <div class="section__content">
    {@render children?.()}
  </div>
</section>

<style>
  .section {
    display: grid;
    gap: 16px;
  }

  :global(.section + .section) {
    padding-top: 20px;
    border-top: 1px solid var(--sw-border-subtle);
  }

  .section__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .section__title-group h2 {
    margin: 0;
    font-size: var(--sw-text-md);
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .section__title-group p {
    max-width: 75ch;
    margin: 4px 0 0;
    font-size: var(--sw-text-sm);
    color: var(--sw-text-secondary);
  }

  .section__meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .section__content {
    display: grid;
    gap: 16px;
  }
</style>
