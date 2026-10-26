<script lang="ts" module>
  export interface TokenOption {
    value: string;
    /** Shown after the value, e.g. how many images list it. */
    count?: number;
  }
</script>

<script lang="ts">
  import { tick } from 'svelte';

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
    /** Id of the field, for a label that names it. */
    id?: string;
    onchange: (next: string[]) => void;
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
    id,
    onchange
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
      <!-- What a model is used by helps to pick it, not once it is picked. -->
      <button class="tok on removable" type="button" aria-label={`Remove ${value}`} onclick={() => toggle(value, index)}>
        {value}
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
    {id}
    class="input mono tok-input"
    class:wide={!toggles}
    class:has-error={invalid}
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

  /* An .input otherwise, so it is as tall as the fields beside it. */
  .tok-input {
    width: 7.5em;
    min-width: 0;
  }

  /* A type-ahead field: room for a whole value. */
  .tok-input.wide {
    width: 14em;
  }

  /* Touch screens get targets a finger can hit, as app.css gives chips. */
  @media (pointer: coarse) {
    .tok {
      min-height: 32px;
    }
  }
</style>
