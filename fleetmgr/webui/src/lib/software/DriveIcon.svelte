<script lang="ts">
  // A folder, or an image file; a file the image list does not have is drawn
  // with a dashed outline.
  interface Props {
    kind: 'folder' | 'image' | 'file';
  }

  let { kind }: Props = $props();
</script>

<svg
  class={`drive-icon ${kind}`}
  width="18"
  height="18"
  viewBox="0 0 18 18"
  fill="none"
  stroke="currentColor"
  stroke-width="1.4"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  {#if kind === 'folder'}
    <path d="M2 5.2c0-.9.7-1.7 1.7-1.7h3.4l1.6 1.8h5.6c.9 0 1.7.7 1.7 1.7v6.3c0 .9-.7 1.7-1.7 1.7H3.7c-.9 0-1.7-.7-1.7-1.7V5.2Z" />
  {:else}
    <path
      d="M4.5 2.5h5.8l3.2 3.2v9a.8.8 0 0 1-.8.8H4.5a.8.8 0 0 1-.8-.8V3.3c0-.4.4-.8.8-.8Z"
      stroke-dasharray={kind === 'file' ? '2 1.6' : undefined}
    />
    <path d="M10.2 2.6v3.2h3.2" />
    {#if kind === 'image'}<path d="M6.3 10.2h5.4M6.3 12.6h3.6" />{/if}
  {/if}
</svg>

<style>
  .drive-icon {
    flex-shrink: 0;
    color: var(--sw-text-muted);
  }

  .drive-icon.folder {
    color: var(--sw-accent);
  }
</style>
