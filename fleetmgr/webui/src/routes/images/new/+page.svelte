<script lang="ts">
  import AddImagesForm from '$lib/software/AddImagesForm.svelte';
  import CatalogImageForm from '$lib/software/CatalogImageForm.svelte';
  import { takeImageFiles } from '$lib/software/image-files';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  // Files handed over by the image list, or dropped or chosen here.
  let files = $state.raw(takeImageFiles());
</script>

{#if data.loadError}
  <div class="error-state status">{data.loadError}</div>
{/if}

{#if files.length > 0}
  <AddImagesForm {files} images={data.images} />
{:else}
  <CatalogImageForm image={null} images={data.images} onfiles={(next) => (files = next)} />
{/if}
