<script lang="ts">
  interface Props {
    steps: string[];
    /** The step shown now, from 1. */
    current: number;
  }

  let { steps, current }: Props = $props();
</script>

<ol class="steps">
  {#each steps as label, i (label)}
    {@const n = i + 1}
    <li class="step" class:done={n < current} class:now={n === current} aria-current={n === current ? 'step' : undefined}>
      <span class="num tn">{n}</span>
      <span class="label">{label}</span>
    </li>
  {/each}
</ol>

<style>
  .steps {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 24px;
    margin: 0 0 16px;
    padding: 0;
    list-style: none;
  }

  .step {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: var(--sw-text-sm);
    color: var(--sw-text-muted);
  }

  .num {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 1px solid var(--sw-border-default);
    border-radius: 50%;
    font-size: var(--sw-text-xs);
  }

  .step.done {
    color: var(--sw-text-secondary);
  }

  .step.done .num {
    border-color: var(--sw-accent-glow-strong);
    color: var(--sw-accent);
  }

  .step.now {
    color: var(--sw-text-primary);
    font-weight: 500;
  }

  .step.now .num {
    border-color: var(--sw-accent);
    background: var(--sw-accent-glow);
    color: var(--sw-accent-bright);
  }
</style>
