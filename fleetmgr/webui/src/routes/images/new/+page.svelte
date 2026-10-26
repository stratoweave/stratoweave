<script lang="ts">
  import CatalogImageForm from '$lib/software/CatalogImageForm.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

{#if data.loadError}
  <div class="error-state status">{data.loadError}</div>
{/if}

<CatalogImageForm image={null} images={data.images} />
