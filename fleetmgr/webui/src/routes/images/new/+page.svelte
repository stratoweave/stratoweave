<script lang="ts">
  import AddImagesForm from '$lib/software/AddImagesForm.svelte';
  import CatalogImageForm from '$lib/software/CatalogImageForm.svelte';
  import { takeImageFiles } from '$lib/software/image-files';
  import type { TypedImage } from '$lib/software/images';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  // Files handed over by the image list, or dropped or chosen here, and
  // what the one-image form held when they came.
  let files = $state.raw(takeImageFiles());
  let typed = $state.raw<TypedImage | null>(null);
</script>

{#if data.loadError}
  <div class="error-state status">{data.loadError}</div>
{/if}

{#if files.length > 0}
  <AddImagesForm {files} {typed} images={data.images} />
{:else}
  <CatalogImageForm
    image={null}
    images={data.images}
    onfiles={(next, held) => {
      typed = held;
      files = next;
    }}
  />
{/if}
