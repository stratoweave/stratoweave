<script lang="ts">
  // A button for the file chooser, and the whole window as a drop target for
  // files. Only the File objects are passed on; nothing here reads their
  // contents.
  interface Props {
    onfiles: (files: File[]) => void;
    /** The button's text. */
    label?: string;
    /** True while files that would be taken are dragged over the window. */
    dragging?: boolean;
    disabled?: boolean;
    /** File types the chooser offers, as the input's accept attribute. A
     * drop takes any file. */
    accept?: string;
  }

  let { onfiles, label = 'Upload images', dragging = $bindable(false), disabled = false, accept }: Props = $props();

  let button: HTMLButtonElement | null = $state(null);
  let input: HTMLInputElement | null = $state(null);
  // dragenter and dragleave fire for every element the drag crosses.
  let depth = 0;
  // A drag that starts in the page, such as an image, can carry Files too.
  let inPage = false;

  /** For a caller that removed what had focus. */
  export function focus(): void {
    button?.focus();
  }

  // Text dragged into a field is left to the browser.
  function carriesFiles(event: DragEvent): boolean {
    return !inPage && (event.dataTransfer?.types.includes('Files') ?? false);
  }

  function enter(event: DragEvent): void {
    if (!carriesFiles(event)) return;
    depth++;
    dragging = !disabled;
  }

  function leave(event: DragEvent): void {
    if (!carriesFiles(event)) return;
    depth = Math.max(0, depth - 1);
    dragging = depth > 0 && !disabled;
  }

  function over(event: DragEvent): void {
    if (!carriesFiles(event)) return;
    depth = Math.max(depth, 1);
    dragging = !disabled;
    // Otherwise the browser opens the dropped file in place of the page.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
  }

  function drop(event: DragEvent): void {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth = 0;
    dragging = false;
    if (disabled) return;
    // A dropped folder arrives as a file item too.
    const files = [...(event.dataTransfer?.items ?? [])]
      .filter((item) => item.kind === 'file' && !item.webkitGetAsEntry()?.isDirectory)
      .map((item) => item.getAsFile())
      .filter((file) => file !== null);
    if (files.length > 0) onfiles(files);
  }

  function chosen(): void {
    const files = [...(input?.files ?? [])];
    // Cleared so that choosing the same file again fires change again.
    if (input) input.value = '';
    if (files.length > 0) onfiles(files);
  }
</script>

<svelte:window
  ondragstart={() => (inPage = true)}
  ondragend={() => (inPage = false)}
  ondragenter={enter}
  ondragover={over}
  ondragleave={leave}
  ondrop={drop}
/>

<button bind:this={button} class="btn btn-secondary" type="button" {disabled} onclick={() => input?.click()}>
  {label}
</button>
<input
  bind:this={input}
  class="file-input"
  type="file"
  multiple
  {accept}
  tabindex="-1"
  aria-hidden="true"
  onchange={chosen}
/>

<style>
  .file-input {
    display: none;
  }
</style>
