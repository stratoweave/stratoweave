<script lang="ts">
  import '#lib/fonts.css';
  import '../app.css';

  import { refreshAll } from '$app/navigation';
  import { navigating, page } from '$app/state';
  import { onMount, type Snippet } from 'svelte';

  import CommandPalette from '#lib/core/command-palette/CommandPalette.svelte';
  import { pageLabel } from '#lib/core/page-label.svelte.ts';
  import { dropReadCache } from '#lib/core/restconf/client.ts';
  import NavIcon from '#lib/core/ui/NavIcon.svelte';
  import logoUrl from '#lib/assets/stratoweave-logo.svg';

  let { children }: { children?: Snippet } = $props();

  let paletteOpen = $state(false);

  onMount(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        paletteOpen = !paletteOpen;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  /** Reload every page load from the server, cached fleet included. */
  function refresh(): void {
    dropReadCache();
    void refreshAll();
  }

  const PAGE_LABELS: Record<string, string> = {
    '/devices': 'Devices',
    '/campaigns': 'Campaigns',
    '/campaigns/new': 'New campaign',
    '/images': 'Images',
    '/images/new': 'Add image',
    '/schedules': 'Schedules',
    '/schedules/new': 'New schedule',
    '/config': 'Config',
    '/apply': 'Apply config'
  };
  // Detail pages sit under their list: /campaigns/<name>, /devices/<name>,
  // /images/<name>, /schedules/<name>.
  const PARENTS: Record<string, string> = {
    '/campaigns/': 'Campaigns',
    '/images/': 'Images',
    '/devices/': 'Devices',
    '/schedules/': 'Schedules'
  };

  let currentPathname = $derived(page.url.pathname);
  // While a page loads, the sidebar already marks it and the old page dims.
  let activePathname = $derived(navigating.to?.url.pathname ?? currentPathname);
  let leaving = $derived(activePathname !== currentPathname);
  let parent = $derived.by(() => {
    if (PAGE_LABELS[currentPathname] !== undefined) return null;
    for (const [prefix, label] of Object.entries(PARENTS)) {
      if (currentPathname.startsWith(prefix)) {
        return { href: prefix.slice(0, -1), label, name: decodeURIComponent(currentPathname.slice(prefix.length)) };
      }
    }
    return null;
  });
  let currentLabel = $derived(pageLabel.text || (parent?.name ?? PAGE_LABELS[currentPathname] ?? 'Campaigns'));
  let pageTitle = $derived(`${currentLabel} · fleetmgr`);
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<div class="app-shell">
  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-logo">
      <a class="logo-link" href="/campaigns" aria-label="fleetmgr — go to campaigns">
        <img
          class="logo-img"
          src={logoUrl}
          alt="StratoWeave fleetmgr"
          width="1732"
          height="397"
        />
      </a>
    </div>
    <nav class="sidebar-nav" aria-label="Primary navigation">
      <div class="nav-section">
        <div class="nav-section-label">Software</div>
        <a
          class="nav-item"
          class:active={activePathname.startsWith('/campaigns')}
          href="/campaigns"
        >
          <span class="nav-icon"><NavIcon name="campaigns" /></span>
          Campaigns
        </a>
        <a
          class="nav-item"
          class:active={activePathname.startsWith('/images')}
          href="/images"
        >
          <span class="nav-icon"><NavIcon name="images" /></span>
          Images
        </a>
      </div>
      <div class="nav-section">
        <div class="nav-section-label">Inventory</div>
        <a
          class="nav-item"
          class:active={activePathname.startsWith('/devices')}
          href="/devices"
        >
          <span class="nav-icon"><NavIcon name="devices" /></span>
          Devices
        </a>
      </div>
      <div class="nav-section">
        <div class="nav-section-label">Maintenance</div>
        <a
          class="nav-item"
          class:active={activePathname.startsWith('/schedules')}
          href="/schedules"
        >
          <span class="nav-icon"><NavIcon name="schedules" /></span>
          Schedules
        </a>
      </div>
      <div class="nav-section">
        <div class="nav-section-label">Configuration</div>
        <a class="nav-item" class:active={activePathname === '/config'} href="/config">
          <span class="nav-icon"><NavIcon name="config" /></span>
          Config
        </a>
        <a class="nav-item" class:active={activePathname === '/apply'} href="/apply">
          <span class="nav-icon"><NavIcon name="apply" /></span>
          Apply config
        </a>
      </div>
    </nav>
  </aside>

  <!-- Main area -->
  <div class="app-main-wrap">
    <header class="app-header">
      <nav class="yang-path" aria-label="Breadcrumb">
        {#if parent !== null}
          <a class="segment" href={parent.href}>{parent.label}</a>
          <span class="separator">›</span>
        {/if}
        <span class="segment current" aria-current="page">{currentLabel}</span>
      </nav>

      <div class="header-actions">
        <button class="btn btn-ghost btn-sm cmdk-trigger" type="button" onclick={() => (paletteOpen = true)} aria-label="Search">
          Search <kbd>⌘K</kbd>
        </button>
        <button class="btn btn-ghost btn-sm" type="button" onclick={refresh}>
          <NavIcon name="refresh" size={16} /> Refresh
        </button>
      </div>
    </header>

    {#if navigating.to}
      <div class="nav-progress" role="progressbar" aria-label="Loading the page"></div>
    {/if}

    <main class="app-content" class:leaving>
      {#key currentPathname}
        <div class="page-enter">
          {@render children?.()}
        </div>
      {/key}
    </main>
  </div>
</div>

<CommandPalette bind:open={paletteOpen} />

<style>
  /* Shows only when a page takes more than a moment to load. */
  .nav-progress {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 1000;
    height: 2px;
    overflow: hidden;
    pointer-events: none;
    opacity: 0;
    animation: nav-show 0s linear 120ms forwards;
  }

  .nav-progress::after {
    content: '';
    position: absolute;
    inset: 0;
    width: 40%;
    background: var(--sw-accent);
    animation: nav-slide 1.1s ease-in-out infinite;
  }

  @keyframes nav-show {
    to {
      opacity: 1;
    }
  }

  @keyframes nav-slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(250%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .nav-progress::after {
      width: 100%;
      animation: none;
    }
  }

  .leaving .page-enter {
    opacity: 0.5;
    transition: opacity 150ms 150ms;
  }

  .cmdk-trigger {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .cmdk-trigger kbd {
    display: inline-block;
    padding: 1px 5px;
    border: 1px solid var(--sw-border-subtle);
    border-radius: 4px;
    background: var(--sw-bg-card);
    font-family: var(--sw-font-mono);
    font-size: 11px;
    color: var(--sw-text-muted);
  }
</style>
