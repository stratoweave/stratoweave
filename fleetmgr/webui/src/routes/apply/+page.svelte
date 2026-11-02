<script lang="ts">
  import { errorText } from '$lib/core/errors';
  import { restconfPatchText } from '$lib/core/restconf/client';
  import ConfirmDialog from '$lib/core/ui/ConfirmDialog.svelte';
  import SegmentedControl from '$lib/core/ui/SegmentedControl.svelte';

  type Format = 'xml' | 'json';

  const CONTENT_TYPES: Record<Format, string> = {
    xml: 'application/yang-data+xml',
    json: 'application/yang-data+json'
  };
  const FORMAT_OPTIONS: { value: Format; label: string }[] = [
    { value: 'xml', label: 'XML' },
    { value: 'json', label: 'JSON' }
  ];
  const PLACEHOLDERS: Record<Format, string> = {
    xml: '<schedules xmlns="urn:fleetmgr:maintenance">\n  ...\n</schedules>',
    json: '{\n  "maintenance:schedules": {\n    ...\n  }\n}'
  };
  const APPLY_TIMEOUT_MS = 30_000;

  let body = $state('');
  let format = $state<Format>('xml');
  let applying = $state(false);
  let confirmOpen = $state(false);
  let dragging = $state(false);
  let statusMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);

  let canApply = $derived(!applying && body.trim().length > 0);

  function setFormat(next: Format): void {
    format = next;
    statusMessage = null;
  }

  function formatOfFile(name: string): Format | null {
    const ext = name.toLowerCase().split('.').pop() ?? '';
    if (ext === 'xml') return 'xml';
    if (ext === 'json') return 'json';
    return null;
  }

  async function handleDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    dragging = false;
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    try {
      body = await file.text();
      format = formatOfFile(file.name) ?? format;
      statusMessage = null;
    } catch (err) {
      statusMessage = { type: 'error', text: errorText(err, 'Failed to read the file.') };
    }
  }

  function handleDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    dragging = true;
  }

  function handleDragLeave(event: DragEvent): void {
    // Moving onto a child element is not leaving the drop zone.
    if (event.currentTarget instanceof Element && event.relatedTarget instanceof Node) {
      if (event.currentTarget.contains(event.relatedTarget)) return;
    }
    dragging = false;
  }

  // An XML PATCH of the datastore needs one <data> root around the top-level
  // nodes: the top answers 204 to a bare top-level node and drops it. Wrap
  // when it is missing, so that XML copied from the config view applies.
  function xmlPayload(text: string): string {
    const declaration = text.match(/^\s*<\?xml[^>]*\?>/)?.[0] ?? '';
    const rest = text.slice(declaration.length);
    return /^\s*<data[\s>/]/.test(rest) ? text : `${declaration}<data>${rest}</data>`;
  }

  function requestApply(): void {
    statusMessage = null;
    if (format === 'json') {
      try {
        JSON.parse(body);
      } catch (err) {
        statusMessage = { type: 'error', text: `Invalid JSON: ${errorText(err, 'parse error')}` };
        return;
      }
    }
    confirmOpen = true;
  }

  async function confirmApply(): Promise<void> {
    confirmOpen = false;
    applying = true;
    statusMessage = null;
    const abort = new AbortController();
    const timer = window.setTimeout(() => abort.abort(), APPLY_TIMEOUT_MS);
    try {
      const payload = format === 'xml' ? xmlPayload(body) : body;
      await restconfPatchText('data', payload, CONTENT_TYPES[format], abort.signal);
      statusMessage = { type: 'success', text: 'Applied.' };
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'AbortError';
      statusMessage = {
        type: 'error',
        text: timedOut
          ? 'No answer within 30 seconds. The change may still be applied.'
          : errorText(err, 'Failed to apply the config.')
      };
    } finally {
      window.clearTimeout(timer);
      applying = false;
    }
  }

  function reset(): void {
    body = '';
    statusMessage = null;
  }
</script>

<div class="page-header">
  <div>
    <h1>Apply config</h1>
  </div>
  <div class="page-actions">
    <button class="btn btn-secondary" type="button" disabled={!body || applying} onclick={reset}>
      Reset
    </button>
    <button class="btn btn-primary" type="button" disabled={!canApply} onclick={requestApply}>
      {applying ? 'Applying…' : 'Apply'}
    </button>
  </div>
</div>

<!-- In place before any message, so that a screen reader reads each one. -->
<div role="status">
  {#if statusMessage}
    <div class={statusMessage.type === 'error' ? 'error-state status' : 'success-banner status'}>
      {statusMessage.text}
    </div>
  {/if}
</div>

<div class="toolbar">
  <SegmentedControl
    ariaLabel="Payload format"
    options={FORMAT_OPTIONS}
    value={format}
    onchange={setFormat}
  />
  <span class="toolbar__meta">{body.length.toLocaleString()} chars</span>
</div>

<label class="sr-only" for="config-payload">Configuration payload</label>
<div class="dropzone" class:dragging>
  <textarea
    id="config-payload"
    class="editor"
    bind:value={body}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
    placeholder={PLACEHOLDERS[format]}
    spellcheck="false"
    autocapitalize="off"
    autocomplete="off"
  ></textarea>
  {#if dragging}
    <div class="dropzone__overlay">Drop file to load its contents</div>
  {/if}
</div>

<ConfirmDialog
  open={confirmOpen}
  title="Apply config?"
  message="The payload is merged into the configuration."
  confirmLabel="Apply"
  confirmClass="btn-primary"
  oncancel={() => (confirmOpen = false)}
  onconfirm={confirmApply}
/>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }

  .toolbar__meta {
    margin-left: auto;
    color: var(--sw-text-muted);
    font-size: 12px;
    font-family: var(--sw-font-mono);
  }

  .dropzone {
    position: relative;
    border: 1px solid var(--sw-border-subtle);
    border-radius: var(--sw-radius-md);
    background: var(--sw-bg-card);
    overflow: hidden;
    transition: border-color var(--sw-dur-fast) var(--sw-ease);
  }

  .dropzone.dragging,
  .dropzone:focus-within {
    border-color: var(--sw-accent);
    box-shadow: 0 0 0 3px var(--sw-accent-glow);
  }

  .editor {
    display: block;
    width: 100%;
    min-height: 480px;
    box-sizing: border-box;
    padding: 14px 16px;
    background: transparent;
    border: 0;
    outline: 0;
    resize: vertical;
    color: var(--sw-text-primary);
    font-family: var(--sw-font-mono);
    font-size: 13px;
    line-height: 1.55;
  }

  .editor::placeholder {
    color: var(--sw-text-muted);
  }

  .dropzone__overlay {
    position: absolute;
    inset: 6px;
    border: 2px dashed var(--sw-accent);
    border-radius: var(--sw-radius-md);
    background: var(--sw-accent-glow);
    color: var(--sw-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 500;
    pointer-events: none;
  }
</style>
