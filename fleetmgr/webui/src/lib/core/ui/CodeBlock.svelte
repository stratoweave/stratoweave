<script lang="ts">
  // Read-only text with line numbers, a copy button and, given a file name,
  // a download button. Ported from the sorespo web UI without its diff
  // colouring or line wrap.
  import NavIcon from '#lib/core/ui/NavIcon.svelte';

  // A whole layer runs to hundreds of thousands of lines, so the text goes in
  // chunks of plain text, one node each, that the browser skips laying out
  // while they are off screen. Find in page and selection still see it all.
  const CHUNK_LINES = 500;

  let {
    content = '',
    minHeight = '',
    maxHeight = '',
    label = 'Code',
    filename = ''
  }: {
    content?: string;
    minHeight?: string;
    maxHeight?: string;
    label?: string;
    filename?: string;
  } = $props();

  // A trailing newline does not add an empty line.
  let lines = $derived.by(() => {
    if (content === '') return [];
    const parts = content.split('\n');
    if (parts[parts.length - 1] === '') parts.pop();
    return parts;
  });
  let gutterWidth = $derived(`${Math.max(2, String(lines.length).length)}ch`);

  // Every chunk is as wide as the longest line, so the horizontal scroll
  // range does not change as chunks come on screen.
  let longest = $derived(lines.reduce((max, line) => Math.max(max, line.length), 0));

  let chunks = $derived.by(() => {
    const result: { count: number; numbers: string; text: string }[] = [];
    for (let start = 0; start < lines.length; start += CHUNK_LINES) {
      const part = lines.slice(start, start + CHUNK_LINES);
      const numbers = part.map((_, index) => start + index + 1).join('\n');
      result.push({ count: part.length, numbers, text: part.join('\n') });
    }
    return result;
  });

  let copyResult = $state<'copied' | 'failed' | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  // navigator.clipboard exists only on HTTPS and localhost, so over plain
  // HTTP from another machine copy through a hidden textarea.
  function copyThroughTextarea(text: string): boolean {
    const focused = document.activeElement;
    const area = document.createElement('textarea');
    area.value = text;
    area.readOnly = true;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      area.remove();
      if (focused instanceof HTMLElement) focused.focus();
    }
  }

  async function copy(): Promise<void> {
    let ok = false;
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(content);
        ok = true;
      } catch {
        ok = false;
      }
    }
    if (!ok) ok = copyThroughTextarea(content);
    copyResult = ok ? 'copied' : 'failed';
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copyResult = null), 1600);
  }

  function download(): void {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    // Safari still reads the URL a moment after the click.
    setTimeout(() => URL.revokeObjectURL(url), 40_000);
  }
</script>

<div class="code" style={`${minHeight ? `min-height: ${minHeight};` : ''}${maxHeight ? `max-height: ${maxHeight};` : ''}`}>
  <div class="code__toolbar">
    <span class="code__meta">{lines.length} line{lines.length === 1 ? '' : 's'}</span>
    <button class="code__tool" type="button" onclick={copy} title={`Copy ${label.toLowerCase()} to clipboard`}>
      <NavIcon name={copyResult === 'copied' ? 'check' : 'copy'} size={14} />
      {copyResult === 'copied' ? 'Copied' : copyResult === 'failed' ? 'Copy failed' : 'Copy'}
    </button>
    {#if filename}
      <button class="code__tool" type="button" onclick={download} title={`Download as ${filename}`}>
        <NavIcon name="download" size={14} /> Download
      </button>
    {/if}
  </div>

  <div class="code__scroll">
    {#if lines.length === 0}
      <div class="code__empty">Empty</div>
    {:else}
      <div class="code__body" style={`--gutter: ${gutterWidth}; --longest: ${longest}`}>
        {#each chunks as chunk}
          <div class="code__chunk" style={`--count: ${chunk.count}`}>
            <pre class="code__gutter" aria-hidden="true">{chunk.numbers}</pre>
            <pre class="code__text">{chunk.text}</pre>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .code {
    display: flex;
    flex-direction: column;
    min-width: 0;
    max-width: 100%;
    border: 1px solid var(--sw-border-subtle);
    border-radius: var(--sw-radius-md);
    background: var(--sw-bg-deep);
    overflow: hidden;
  }

  .code__toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px 4px 12px;
    border-bottom: 1px solid var(--sw-border-subtle);
    background: var(--sw-bg-chrome);
  }

  .code__meta {
    margin-right: auto;
    font-family: var(--sw-font-mono);
    font-size: 11px;
    color: var(--sw-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .code__tool {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    border: 1px solid transparent;
    border-radius: var(--sw-radius-sm);
    background: transparent;
    color: var(--sw-text-secondary);
    font-size: 12px;
    cursor: pointer;
    transition: background var(--sw-dur-fast), color var(--sw-dur-fast);
  }

  .code__tool:hover {
    background: var(--sw-bg-hover);
    color: var(--sw-text-primary);
  }

  .code__scroll {
    flex: 1;
    min-height: 0;
    max-width: 100%;
    overflow: auto;
    scrollbar-width: thin;
  }

  .code__body {
    min-width: max-content;
    padding: 10px 0;
    font-family: var(--sw-font-mono);
    font-size: 12.5px;
    line-height: 1.6;
    tab-size: 2;
  }

  /* An off-screen chunk is not laid out but keeps its height, so the
     scrollbar stays true. */
  .code__chunk {
    display: flex;
    min-width: calc(var(--gutter) + 24px + var(--longest) * 1ch + 16px);
    padding-right: 16px;
    content-visibility: auto;
    contain-intrinsic-block-size: auto calc(var(--count) * 1lh);
  }

  .code__gutter,
  .code__text {
    margin: 0;
    font: inherit;
  }

  .code__gutter {
    flex: 0 0 auto;
    width: calc(var(--gutter) + 24px);
    padding-right: 12px;
    text-align: right;
    color: var(--sw-text-muted);
    opacity: 0.6;
    user-select: none;
    font-variant-numeric: tabular-nums;
  }

  .code__text {
    flex: 1 1 auto;
    color: var(--sw-text-secondary);
  }

  .code__empty {
    padding: 24px;
    text-align: center;
    color: var(--sw-text-muted);
    font-size: 13px;
  }
</style>
