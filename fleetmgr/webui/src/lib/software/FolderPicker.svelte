<script lang="ts">
  import DriveIcon from '#lib/software/DriveIcon.svelte';
  import { baseName } from '#lib/software/image-tree.ts';

  // The folders of the image tree as choices, the top first and each folder
  // under its parent, indented. They are radio buttons, so arrow keys move
  // between them.
  interface Props {
    /** Every folder, by path. */
    folders: string[];
    /** The chosen folder, '' for the top; null for none yet. */
    value: string | null;
    /** Why folder cannot be chosen; '' when it can. */
    refuse: (folder: string) => string;
    onchange: (folder: string) => void;
    label: string;
  }

  let { folders, value, refuse, onchange, label }: Props = $props();

  const uid = $props.id();

  // Each folder right after its parent: compared part by part, so that a
  // and a/b stay together, which plain text order would split with a.x.
  function compareTree(a: string, b: string): number {
    const pa = a.split('/');
    const pb = b.split('/');
    for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
      const c = pa[i].localeCompare(pb[i], undefined, { numeric: true });
      if (c !== 0) return c;
    }
    return pa.length - pb.length;
  }

  let choices = $derived(
    ['', ...[...folders].sort(compareTree)].map((path) => ({
      path,
      depth: path ? path.split('/').length : 0,
      why: refuse(path)
    }))
  );
  let firstOpen = $derived(choices.find((c) => !c.why)?.path ?? null);
</script>

<div class="picker" role="radiogroup" aria-label={label}>
  {#each choices as c (c.path)}
    <label class="choice" class:chosen={value === c.path} class:refused={!!c.why} style:--depth={c.depth}>
      <input
        type="radio"
        name={uid}
        checked={value === c.path}
        disabled={!!c.why}
        aria-describedby={c.why ? `${uid}-${c.path}` : undefined}
        data-autofocus={(value ?? firstOpen) === c.path ? '' : undefined}
        onchange={() => onchange(c.path)}
      />
      <DriveIcon kind="folder" />
      <span class="name" class:mono={c.path !== ''}>{c.path ? baseName(c.path) : 'Images'}</span>
      {#if c.why}<small id={`${uid}-${c.path}`} class="why">{c.why}</small>{/if}
    </label>
  {/each}
</div>

<style>
  .picker {
    display: grid;
    max-height: min(320px, 50vh);
    overflow-y: auto;
    padding: 4px;
    border: 1px solid var(--sw-border-subtle);
    border-radius: var(--sw-radius-md);
    background: var(--sw-bg-input);
  }

  .choice {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 4px 10px 4px calc(10px + var(--depth) * 18px);
    border-radius: var(--sw-radius-sm);
    font-size: var(--sw-text-sm);
    cursor: pointer;
  }

  .choice:hover:not(.refused) {
    background: var(--sw-bg-hover);
  }

  .choice.chosen {
    background: var(--sw-accent-glow);
  }

  .choice.refused {
    color: var(--sw-text-muted);
    cursor: default;
  }

  .choice input {
    flex-shrink: 0;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name.mono {
    font-size: var(--sw-text-xs);
  }

  .why {
    margin-left: auto;
    padding-left: 8px;
    font-size: var(--sw-text-xs);
    white-space: nowrap;
  }
</style>
