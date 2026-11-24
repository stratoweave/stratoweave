<script lang="ts">
  import LoadError from '#lib/core/ui/LoadError.svelte';
  import CatalogImageForm from '#lib/software/CatalogImageForm.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

{#if data.loadError}
  <LoadError message={data.loadError} />
{:else if data.image !== null}
  {#key data.image.name}
    <CatalogImageForm image={data.image} images={data.images} />
  {/key}
{:else}
  <section class="card">
    <div class="empty-state">No image named {data.name}. <a href="/images">Back to images</a></div>
  </section>
{/if}
