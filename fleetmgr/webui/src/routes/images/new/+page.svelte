<script lang="ts">
  import AddImagesForm from '#lib/software/AddImagesForm.svelte';
  import CatalogImageForm from '#lib/software/CatalogImageForm.svelte';
  import { takeImageFiles } from '#lib/software/image-files.ts';
  import type { TypedImage } from '#lib/software/images.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  // Files handed over by the image list, or dropped or chosen here, and
  // what the one-image form held when they came.
  let files = $state.raw(takeImageFiles());
  let typed = $state.raw<TypedImage | null>(null);
</script>

{#if files.length > 0}
  <AddImagesForm {files} {typed} folder={data.folder} images={data.images} loadError={data.loadError} />
{:else}
  <CatalogImageForm
    image={null}
    images={data.images}
    folder={data.folder}
    file={data.file}
    loadError={data.loadError}
    onfiles={(next, held) => {
      typed = held;
      files = next;
    }}
  />
{/if}
