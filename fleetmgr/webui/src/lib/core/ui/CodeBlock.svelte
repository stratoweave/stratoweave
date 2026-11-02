<script lang="ts">
  // Read-only text with line numbers, a wrap toggle and a copy button.
  // Ported from the sorespo web UI without its diff colouring.
  import NavIcon from '$lib/core/ui/NavIcon.svelte';

  let {
    content = '',
    minHeight = '',
    maxHeight = '',
    label = 'Code'
  }: {
    content?: string;
    minHeight?: string;
    maxHeight?: string;
    label?: string;
  } = $props();

  // A trailing newline does not add an empty line.
  let lines = $derived.by(() => {
    if (content === '') return [];
    const parts = content.split('\n');
    if (parts[parts.length - 1] === '') parts.pop();
    return parts;
  });
  let gutterWidth = $derived(`${Math.max(2, String(lines.length).length)}ch`);

  let wrap = $state(false);
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
</script>

<div class="code" style={`${minHeight ? `min-height: ${minHeight};` : ''}${maxHeight ? `max-height: ${maxHeight};` : ''}`}>
  <div class="code__toolbar">
    <span class="code__meta">{lines.length} line{lines.length === 1 ? '' : 's'}</span>
    <button
      class="code__tool"
      class:active={wrap}
      type="button"
      onclick={() => (wrap = !wrap)}
      aria-pressed={wrap}
      title={wrap ? 'Disable line wrap' : 'Wrap long lines'}
    >
      <NavIcon name="wrap" size={14} /> Wrap
    </button>
    <button class="code__tool" type="button" onclick={copy} title={`Copy ${label.toLowerCase()} to clipboard`}>
      <NavIcon name={copyResult === 'copied' ? 'check' : 'copy'} size={14} />
      {copyResult === 'copied' ? 'Copied' : copyResult === 'failed' ? 'Copy failed' : 'Copy'}
    </button>
  </div>

  <div class="code__scroll" class:code__scroll--wrap={wrap}>
    {#if lines.length === 0}
      <div class="code__empty">Empty</div>
    {:else}
      <pre class="code__pre" style={`--gutter: ${gutterWidth}`}>{#each lines as line, index}<div
          class="code__line"
        ><span class="code__gutter" aria-hidden="true">{index + 1}</span><span class="code__text">{line || ' '}</span></div>{/each}</pre>
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

  .code__tool.active {
    color: var(--sw-accent);
    background: var(--sw-accent-glow);
  }

  .code__scroll {
    flex: 1;
    min-height: 0;
    max-width: 100%;
    overflow: auto;
    scrollbar-width: thin;
  }

  .code__pre {
    margin: 0;
    padding: 10px 0;
    border: none;
    border-radius: 0;
    background: transparent;
    min-width: max-content;
    font-family: var(--sw-font-mono);
    font-size: 12.5px;
    line-height: 1.6;
    tab-size: 2;
  }

  .code__scroll--wrap .code__pre {
    min-width: 0;
  }

  .code__line {
    display: flex;
    align-items: flex-start;
    padding-right: 16px;
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
    min-width: 0;
    white-space: pre;
    color: var(--sw-text-secondary);
  }

  .code__scroll--wrap .code__text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .code__empty {
    padding: 24px;
    text-align: center;
    color: var(--sw-text-muted);
    font-size: 13px;
  }
</style>
