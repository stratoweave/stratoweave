<script lang="ts" module>
  export type NavIconName =
    | 'campaigns'
    | 'devices'
    | 'refresh'
    | 'alert'
    | 'check'
    | 'chevron-left'
    | 'chevron-right';
</script>

<script lang="ts">
  // Line icons on a 24 px grid, drawn in the current text colour. Ported from
  // the sorespo web UI; `campaigns` is fleetmgr's own.
  let { name, size = 18 }: { name: NavIconName; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.6"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  {#if name === 'campaigns'}
    <path d="M12 16V4m-5 5 5-5 5 5" />
    <path d="M4 20h16" />
  {:else if name === 'devices'}
    <rect x="3" y="4" width="18" height="6" rx="1.5" />
    <rect x="3" y="14" width="18" height="6" rx="1.5" />
    <path d="M6 7h.01M6 17h.01M16 7h2M16 17h2" />
  {:else if name === 'refresh'}
    <path d="M20 4v5h-5M4 20v-5h5M20 9a8 8 0 0 0-14-3M4 15a8 8 0 0 0 14 3" />
  {:else if name === 'alert'}
    <path d="M12 3 2.5 20h19z" />
    <path d="M12 10v4M12 17h.01" />
  {:else if name === 'check'}
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  {:else if name === 'chevron-left'}
    <path d="m15 5-7 7 7 7" />
  {:else if name === 'chevron-right'}
    <path d="m9 5 7 7-7 7" />
  {/if}
</svg>
