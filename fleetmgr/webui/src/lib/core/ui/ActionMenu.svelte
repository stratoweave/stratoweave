<script lang="ts" module>
  export interface MenuItem {
    label: string;
    run: () => void;
    danger?: boolean;
    disabled?: boolean;
    /** Why it is disabled, read and shown with it. */
    hint?: string;
  }
</script>

<script lang="ts">
  import { tick } from 'svelte';

  // A button that opens a menu of actions, as a menu button does: arrow
  // keys move between the items, Escape or a click elsewhere closes it, and
  // focus goes back to the button. The menu sits in the top layer, so no
  // scrolling card cuts it off. openAt() opens it at a point, for a
  // right-click.
  interface Props {
    items: MenuItem[];
    /** The button's name, e.g. "Actions for c8000v-universalk9.17.18.03a.SPA.bin". */
    label: string;
    disabled?: boolean;
  }

  let { items, label, disabled = false }: Props = $props();

  const id = $props.id();
  let trigger: HTMLButtonElement | null = $state(null);
  let menu: HTMLDivElement | null = $state(null);
  let open = $state(false);

  /** Open the menu with its top left corner at a point of the window. */
  export function openAt(x: number, y: number): void {
    show({ x, y, rightAligned: false, above: y });
  }

  // x and y place the menu's top corner; rightAligned puts its right edge
  // at x instead. Without room below, its bottom goes to `above`.
  function show(at: { x: number; y: number; rightAligned: boolean; above: number }): void {
    if (!menu || disabled) return;
    if (!menu.matches(':popover-open')) menu.showPopover();
    const rect = menu.getBoundingClientRect();
    const left = at.rightAligned ? at.x - rect.width : at.x;
    const top = at.y + rect.height + 8 > window.innerHeight ? at.above - rect.height : at.y;
    menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    void tick().then(() => focusItem(0));
  }

  function toggle(): void {
    if (!trigger || !menu) return;
    if (open) {
      menu.hidePopover();
      return;
    }
    const r = trigger.getBoundingClientRect();
    show({ x: r.right, y: r.bottom + 4, rightAligned: true, above: r.top - 4 });
  }

  function itemButtons(): HTMLButtonElement[] {
    return [...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
  }

  // Focus the item at index, wrapping around at either end.
  function focusItem(index: number): void {
    const buttons = itemButtons();
    if (buttons.length > 0) buttons[(index + buttons.length) % buttons.length].focus();
  }

  function keydown(event: KeyboardEvent): void {
    const buttons = itemButtons();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown') focusItem(at + 1);
    else if (event.key === 'ArrowUp') focusItem(at < 0 ? -1 : at - 1);
    else if (event.key === 'Home') focusItem(0);
    else if (event.key === 'End') focusItem(-1);
    else if (event.key === 'Tab') {
      menu?.hidePopover();
      trigger?.focus();
    } else return;
    event.preventDefault();
  }

  function toggled(event: ToggleEvent): void {
    open = event.newState === 'open';
    // Escape, or a click elsewhere: focus goes back to the button, unless
    // the click put it somewhere.
    if (!open && (menu?.contains(document.activeElement) || document.activeElement === document.body)) {
      trigger?.focus();
    }
  }

  function choose(item: MenuItem): void {
    if (item.disabled) return;
    menu?.hidePopover();
    trigger?.focus();
    item.run();
  }
</script>

<button
  bind:this={trigger}
  class="btn btn-ghost btn-sm menu-trigger"
  class:open
  type="button"
  aria-label={label}
  aria-haspopup="menu"
  aria-expanded={open}
  aria-controls={`${id}-menu`}
  {disabled}
  onclick={toggle}
>
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
    <circle cx="3.5" cy="8" r="1.4" />
    <circle cx="8" cy="8" r="1.4" />
    <circle cx="12.5" cy="8" r="1.4" />
  </svg>
</button>

<div
  bind:this={menu}
  id={`${id}-menu`}
  class="menu"
  role="menu"
  aria-label={label}
  popover="auto"
  tabindex="-1"
  ontoggle={toggled}
  onkeydown={keydown}
>
  {#each items as item, i (item.label)}
    <button
      class="menu-item"
      class:danger={item.danger}
      type="button"
      role="menuitem"
      tabindex="-1"
      aria-disabled={item.disabled ? 'true' : undefined}
      aria-describedby={item.hint ? `${id}-hint-${i}` : undefined}
      onclick={() => choose(item)}
    >
      <span>{item.label}</span>
      {#if item.hint}<small id={`${id}-hint-${i}`} class="hint">{item.hint}</small>{/if}
    </button>
  {/each}
</div>

<style>
  .menu-trigger {
    width: 30px;
    height: 30px;
    padding: 0;
    justify-content: center;
    color: var(--sw-text-muted);
  }

  .menu-trigger:hover:not(:disabled),
  .menu-trigger.open {
    color: var(--sw-text-primary);
  }

  .menu {
    position: fixed;
    inset: auto;
    margin: 0;
    min-width: 180px;
    max-width: min(320px, calc(100vw - 16px));
    padding: 4px;
    border: 1px solid var(--sw-border-default);
    border-radius: var(--sw-radius-md);
    background: var(--sw-bg-elevated);
    box-shadow: var(--sw-shadow-elevated);
    color: var(--sw-text-primary);
  }

  .menu-item {
    display: grid;
    width: 100%;
    gap: 2px;
    padding: 7px 10px;
    border: none;
    border-radius: var(--sw-radius-sm);
    background: none;
    color: inherit;
    font-size: var(--sw-text-sm);
    text-align: left;
    cursor: pointer;
  }

  .menu-item:hover,
  .menu-item:focus-visible {
    background: var(--sw-bg-hover);
    outline: none;
  }

  .menu-item:focus-visible {
    box-shadow: inset 0 0 0 1px var(--sw-accent);
  }

  .menu-item.danger {
    color: var(--sw-danger-text);
  }

  .menu-item.danger:hover,
  .menu-item.danger:focus-visible {
    background: var(--sw-danger-dim);
  }

  .menu-item[aria-disabled='true'] {
    color: var(--sw-text-muted);
    cursor: default;
  }

  .menu-item[aria-disabled='true']:hover {
    background: none;
  }

  .hint {
    font-size: var(--sw-text-xs);
    color: var(--sw-text-muted);
    overflow-wrap: anywhere;
  }

  @media (pointer: coarse) {
    .menu-trigger {
      width: 36px;
      height: 36px;
    }

    .menu-item {
      padding: 10px 12px;
    }
  }
</style>
