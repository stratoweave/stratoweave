<script lang="ts">
  import CatalogImageForm from '$lib/software/CatalogImageForm.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

{#if data.loadError}
  <div class="error-state status">{data.loadError}</div>
{/if}

{#if data.image !== null}
  {#key data.image.name}
    <CatalogImageForm image={data.image} images={data.images} />
  {/key}
{:else if !data.loadError}
  <section class="card">
    <div class="empty-state">No image named {data.name}. <a href="/images">Back to images</a></div>
  </section>
{/if}
