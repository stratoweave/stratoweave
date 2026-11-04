<script lang="ts">
  import { goto } from '$app/navigation';
  import { navigating } from '$app/state';

  import { CONTENT_OPTIONS, FORMAT_OPTIONS, type LayerContent, type LayerFormat } from '#lib/core/layer-config.ts';
  import CodeBlock from '#lib/core/ui/CodeBlock.svelte';
  import SegmentedControl from '#lib/core/ui/SegmentedControl.svelte';

  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  // The old text stays, dimmed, until the new one has loaded.
  let loading = $derived(navigating.to?.url.pathname === '/config');

  function show(content: LayerContent, format: LayerFormat): void {
    const query = new URLSearchParams({ content, format });
    void goto(`/config?${query}`, { replace: true, reset: false });
  }
</script>

<div class="page-header">
  <div>
    <h1>Config</h1>
  </div>
</div>

<section class="card viewer">
  <div class="viewer__controls">
    <SegmentedControl
      label="Content"
      options={CONTENT_OPTIONS}
      value={data.content}
      onchange={(content) => show(content, data.format)}
    />
    <SegmentedControl
      label="Format"
      options={FORMAT_OPTIONS}
      value={data.format}
      onchange={(format) => show(data.content, format)}
    />
  </div>

  {#if data.loadError}
    <div class="error-state">{data.loadError}</div>
  {:else}
    <div class:loading aria-busy={loading}>
      <CodeBlock content={data.text} minHeight="26rem" maxHeight="calc(100vh - 220px)" label="Config" />
    </div>
  {/if}
</section>

<style>
  .viewer {
    display: grid;
    gap: 16px;
    padding: 20px;
    min-width: 0;
  }

  .viewer__controls {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
  }

  .viewer > div {
    min-width: 0;
  }

  .loading {
    opacity: 0.5;
    transition: opacity var(--sw-dur-fast) var(--sw-ease);
  }
</style>
