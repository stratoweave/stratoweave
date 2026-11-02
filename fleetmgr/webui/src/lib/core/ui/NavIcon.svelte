<script lang="ts" module>
  export type NavIconName =
    | 'campaigns'
    | 'images'
    | 'devices'
    | 'schedules'
    | 'config'
    | 'apply'
    | 'refresh'
    | 'wrap'
    | 'copy'
    | 'check';
</script>

<script lang="ts">
  // Line icons on a 24 px grid, drawn in the current text colour. Ported from
  // the sorespo web UI; `campaigns` and `config` are fleetmgr's own.
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
  {:else if name === 'images'}
    <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3z" />
    <path d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5" />
  {:else if name === 'devices'}
    <rect x="3" y="4" width="18" height="6" rx="1.5" />
    <rect x="3" y="14" width="18" height="6" rx="1.5" />
    <path d="M6 7h.01M6 17h.01M16 7h2M16 17h2" />
  {:else if name === 'schedules'}
    <rect x="3" y="5" width="18" height="16" rx="1.5" />
    <path d="M3 10h18M8 3v4M16 3v4M7 14h3v3H7z" />
  {:else if name === 'config'}
    <path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h5" />
  {:else if name === 'apply'}
    <path d="M14 3H5v18h14V8zM14 3v5h5m-11 6 3 3 5-6" />
  {:else if name === 'refresh'}
    <path d="M20 4v5h-5M4 20v-5h5M20 9a8 8 0 0 0-14-3M4 15a8 8 0 0 0 14 3" />
  {:else if name === 'wrap'}
    <path d="M3 6h18M3 12h13a3 3 0 0 1 0 6h-3M3 18h6" />
    <path d="m15 15-2 3 2 3" />
  {:else if name === 'copy'}
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  {:else if name === 'check'}
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  {/if}
</svg>
