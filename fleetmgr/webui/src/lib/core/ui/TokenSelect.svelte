<script lang="ts" module>
  export interface TokenOption {
    value: string;
    /** Shown after the value, e.g. how many images list it. */
    count?: number;
  }
</script>

<script lang="ts">
  import { tick, type Snippet } from 'svelte';

  // Pick any of a set of values. A short list shows every option as a
  // toggle; a long one shows the picked values, each with a remove button,
  // and a field that suggests the rest. Either way a value no option lists
  // can be typed in: Enter adds what is typed, and so does picking a
  // suggestion or leaving the field on an exact one. Other typed text stays
  // in the field as `draft` for the form to deal with.
  interface Props {
    options: TokenOption[];
    selected: string[];
    label: string;
    placeholder?: string;
    /** What an option's count means, e.g. "in 5 images". */
    countLabel?: (count: number) => string;
    /** Text typed but not added. */
    draft?: string;
    required?: boolean;
    invalid?: boolean;
    /** Id of the element that describes the field, such as its error. */
    describedby?: string;
    onchange: (next: string[]) => void;
    /** More controls in the same row, after the field. They are sized like
     * the tokens. */
    children?: Snippet;
  }

  let {
    options,
    selected,
    label,
    placeholder = 'other…',
    countLabel = (count) => String(count),
    draft = $bindable(''),
    required = false,
    invalid = false,
    describedby,
    onchange,
    children
  }: Props = $props();

  const uid = $props.id();
  const listId = `${uid}-options`;
  const TOGGLE_MAX = 16;

  let root: HTMLElement | null = $state(null);
  let input: HTMLInputElement | null = $state(null);
  let counts = $derived(new Map(options.map((o) => [o.value, o.count])));
  let toggles = $derived(options.length <= TOGGLE_MAX);
  let shown = $derived(
    toggles
      ? [...options.map((o) => o.value), ...selected.filter((v) => !counts.has(v))]
      : selected
  );

  /** A suggestion typed in another case is the suggestion. */
  function known(text: string): string | undefined {
    const t = text.trim().toLowerCase();
    return options.find((o) => o.value.toLowerCase() === t)?.value;
  }

  // A press that removes its own button moves focus to the token that took
  // its place, or to the field after the last one.
  async function toggle(value: string, index: number): Promise<void> {
    onchange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
    await tick();
    if (root?.contains(document.activeElement)) return;
    (root?.querySelectorAll<HTMLButtonElement>('button.tok')[index] ?? input)?.focus();
  }

  function add(text: string): void {
    const value = known(text) ?? text.trim();
    draft = '';
    if (value && !selected.includes(value)) onchange([...selected, value]);
  }

  // A picked suggestion replaces the text in one go; typing does not.
  function picked(event: Event): void {
    const replaced = !(event instanceof InputEvent) || event.inputType === 'insertReplacementText';
    if (replaced && known(draft) !== undefined) add(draft);
  }

  function left(): void {
    if (known(draft) !== undefined) add(draft);
  }
</script>

<span bind:this={root} class="tokens" role="group" aria-label={label}>
  {#each shown as value, index (value)}
    {@const count = counts.get(value)}
    {#if toggles}
      <button
        class="tok"
        class:on={selected.includes(value)}
        type="button"
        aria-pressed={selected.includes(value)}
        aria-label={count === undefined ? undefined : `${value}, ${countLabel(count)}`}
        onclick={() => toggle(value, index)}
      >
        {value}
        {#if count !== undefined}
          <span class="count" title={countLabel(count)} aria-hidden="true">{count}</span>
        {/if}
      </button>
    {:else}
      <button
        class="tok on removable"
        type="button"
        aria-label={`Remove ${value}`}
        title={count === undefined ? undefined : countLabel(count)}
        onclick={() => toggle(value, index)}
      >
        {value}
        {#if count !== undefined}
          <span class="count" aria-hidden="true">{count}</span>
        {/if}
        <svg
          class="x"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="m2 2 6 6M8 2 2 8" />
        </svg>
      </button>
    {/if}
  {/each}
  <input
    bind:this={input}
    class="tok-input"
    class:wide={!toggles}
    class:invalid
    {placeholder}
    list={toggles ? undefined : listId}
    aria-label={`${label}: add a value`}
    aria-invalid={invalid ? 'true' : undefined}
    aria-required={required && selected.length === 0 ? 'true' : undefined}
    aria-describedby={describedby}
    bind:value={draft}
    oninput={picked}
    onkeydown={(event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        add(draft);
      }
    }}
    onblur={left}
  />
  {@render children?.()}
  {#if !toggles}
    <datalist id={listId}>
      {#each options as o (o.value)}
        {#if !selected.includes(o.value)}
          <option value={o.value} label={o.count === undefined ? undefined : countLabel(o.count)}></option>
        {/if}
      {/each}
    </datalist>
  {/if}
</span>

<style>
  .tokens {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    min-width: 0;
  }

  .tok {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: 1px dashed var(--sw-border-default);
    border-radius: var(--sw-radius-xs);
    padding: 3px 8px;
    font-family: var(--sw-font-mono);
    font-size: var(--sw-text-xs);
    color: var(--sw-text-secondary);
    cursor: pointer;
  }

  .tok:hover {
    border-color: var(--sw-text-muted);
  }

  .tok.on {
    background: var(--sw-accent-glow);
    border: 1px solid var(--sw-accent-glow-strong);
    color: var(--sw-accent-bright);
  }

  .count {
    color: var(--sw-text-muted);
    font-size: var(--sw-text-2xs);
  }

  .tok.on .count {
    color: var(--sw-accent);
  }

  .x {
    flex-shrink: 0;
    color: var(--sw-accent);
  }

  .removable:hover .x,
  .removable:focus-visible .x {
    color: var(--sw-text-primary);
  }

  .tok-input {
    width: 7.5em;
    min-width: 0;
    background: var(--sw-bg-input);
    border: 1px solid var(--sw-border-default);
    border-radius: var(--sw-radius-xs);
    color: var(--sw-text-primary);
    padding: 3px 8px;
    font-family: var(--sw-font-mono);
    font-size: var(--sw-text-xs);
    outline: none;
  }

  /* A type-ahead field: room for a whole value, less when the row is
     shared with other controls. */
  .tok-input.wide {
    flex: 1 1 8em;
    max-width: 14em;
  }

  .tok-input::placeholder {
    color: var(--sw-text-muted);
  }

  .tok-input:focus-visible {
    border-color: var(--sw-accent);
    box-shadow: 0 0 0 3px var(--sw-accent-glow);
  }

  .tok-input.invalid {
    border-color: var(--sw-danger-text);
    box-shadow: 0 0 0 3px var(--sw-danger-dim);
  }

  .tok-input.invalid:focus-visible {
    box-shadow: 0 0 0 3px rgb(var(--sw-danger-rgb) / 0.4);
  }

  .tokens > :global(.btn) {
    padding: 3px 8px;
    border-radius: var(--sw-radius-xs);
    font-size: var(--sw-text-xs);
  }

  /* Touch screens get targets a finger can hit, as app.css gives chips. */
  @media (pointer: coarse) {
    .tok,
    .tok-input,
    .tokens > :global(.btn) {
      min-height: 32px;
    }
  }
</style>
