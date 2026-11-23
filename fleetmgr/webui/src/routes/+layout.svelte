<script lang="ts">
  import '#lib/fonts.css';
  import '../app.css';

  import { navigating, page } from '$app/state';
  import { onMount, type Snippet } from 'svelte';

  import CommandPalette from '#lib/core/command-palette/CommandPalette.svelte';
  import { pageLabel } from '#lib/core/page-label.svelte.ts';
  import { reload } from '#lib/core/reload.ts';
  import NavIcon from '#lib/core/ui/NavIcon.svelte';
  import { campaignHref } from '#lib/software/links.ts';
  import logoUrl from '#lib/assets/stratoweave-logo.svg';

  let { children }: { children?: Snippet } = $props();

  let paletteOpen = $state(false);
  let nav: HTMLElement | null = $state(null);
  let moreBefore = $state(false);
  let moreAfter = $state(false);

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

  function refresh(): void {
    void reload();
  }

  const PAGE_LABELS: Record<string, string> = {
    '/devices': 'Devices',
    '/campaigns': 'Campaigns',
    '/campaigns/new': 'New campaign',
    '/images': 'Images',
    '/images/new': 'Add image',
    '/schedules': 'Schedules',
    '/schedules/new': 'New schedule',
    '/groups': 'Redundancy groups',
    '/groups/new': 'New group',
    '/config': 'Config',
    '/apply': 'Apply config'
  };
  // Detail pages sit under their list: /campaigns/<name>, /devices/<name>,
  // /images/<name>, /schedules/<name>, /groups/<name>.
  const PARENTS: Record<string, string> = {
    '/campaigns/': 'Campaigns',
    '/images/': 'Images',
    '/devices/': 'Devices',
    '/schedules/': 'Schedules',
    '/groups/': 'Redundancy groups'
  };
  // A device as a campaign shows it sits under that campaign.
  const CAMPAIGN_DEVICE = /^\/campaigns\/([^/]+)\/devices\/([^/]+)$/;

  interface Crumb {
    href: string;
    label: string;
    /** A name, which gives way before the current page's. */
    name?: boolean;
  }

  let currentPathname = $derived(page.url.pathname);
  // While a page loads, the sidebar already marks it and the old page dims.
  let activePathname = $derived(navigating.to?.url.pathname ?? currentPathname);
  let leaving = $derived(activePathname !== currentPathname);
  /** The pages a detail page sits under, and its name. */
  let detail = $derived.by((): { trail: Crumb[]; name: string } | null => {
    if (PAGE_LABELS[currentPathname] !== undefined) return null;
    const inCampaign = CAMPAIGN_DEVICE.exec(currentPathname);
    if (inCampaign) {
      const campaign = decodeURIComponent(inCampaign[1]);
      return {
        trail: [
          { href: '/campaigns', label: 'Campaigns' },
          { href: campaignHref(campaign), label: campaign, name: true }
        ],
        name: decodeURIComponent(inCampaign[2])
      };
    }
    for (const [prefix, label] of Object.entries(PARENTS)) {
      if (currentPathname.startsWith(prefix)) {
        const name = decodeURIComponent(currentPathname.slice(prefix.length));
        return { trail: [{ href: prefix.slice(0, -1), label }], name };
      }
    }
    return null;
  });
  let currentLabel = $derived(pageLabel.text || (detail?.name ?? PAGE_LABELS[currentPathname] ?? 'Campaigns'));
  let pageTitle = $derived(`${currentLabel} · fleetmgr`);

  // The width of the faded ends of the navigation strip, as app.css draws
  // them.
  const FADE = 32;

  // On a narrow screen the navigation is a strip that scrolls sideways.
  // Which ends have more items past them, for app.css to fade.
  function measureStrip(): void {
    if (!nav) return;
    const end = nav.scrollWidth - nav.clientWidth;
    moreBefore = nav.scrollLeft > 1;
    moreAfter = nav.scrollLeft < end - 1;
  }

  // The current page's item comes into view in the strip, clear of the
  // faded ends. Only the strip scrolls, never the page.
  function revealActive(): void {
    const item = nav?.querySelector<HTMLElement>('.nav-item.active');
    if (!nav || !item || nav.scrollWidth <= nav.clientWidth) return;
    const strip = nav.getBoundingClientRect();
    const box = item.getBoundingClientRect();
    if (box.left < strip.left + FADE) nav.scrollLeft -= strip.left + FADE - box.left;
    else if (box.right > strip.right - FADE) nav.scrollLeft += box.right - (strip.right - FADE);
  }

  function updateStrip(): void {
    revealActive();
    measureStrip();
  }

  // On every navigation.
  $effect(() => {
    void activePathname;
    updateStrip();
  });

  // And when the strip changes size, as on turning a phone, and once the
  // web font, which sets the items' widths, has loaded.
  onMount(() => {
    if (!nav) return;
    const observer = new ResizeObserver(updateStrip);
    observer.observe(nav);
    void document.fonts.ready.then(updateStrip);
    return () => observer.disconnect();
  });
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<a class="btn btn-primary skip-link" href="#main">Skip to content</a>

<div class="app-shell">
  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-logo">
      <a class="logo-link" href="/campaigns" aria-label="fleetmgr, go to campaigns">
        <img
          class="logo-img"
          src={logoUrl}
          alt="StratoWeave fleetmgr"
          width="1732"
          height="397"
        />
      </a>
    </div>
    <nav
      bind:this={nav}
      class="sidebar-nav"
      class:more-before={moreBefore}
      class:more-after={moreAfter}
      aria-label="Primary navigation"
      onscroll={measureStrip}
    >
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
        <a
          class="nav-item"
          class:active={activePathname.startsWith('/groups')}
          href="/groups"
        >
          <span class="nav-icon"><NavIcon name="groups" /></span>
          Redundancy groups
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
        {#each detail?.trail ?? [] as crumb (crumb.href)}
          <a class="segment" class:name={crumb.name} href={crumb.href}>{crumb.label}</a>
          <span class="separator">›</span>
        {/each}
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

    <main id="main" class="app-content" class:leaving tabindex="-1">
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
  /* The keyboard's first stop, past the navigation to the page. It shows
     only while it has focus. */
  .skip-link {
    position: fixed;
    top: 8px;
    left: 8px;
    z-index: 1001;
  }

  .skip-link:not(:focus) {
    transform: translateY(calc(-100% - 16px));
  }

  /* The skip link's target. It takes focus only to start the keyboard
     there, so it draws no ring. */
  main:focus {
    outline: none;
  }

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

  /* A name before the current page's takes only the room that one leaves,
     down to its ellipsis, so it gives way first. */
  .yang-path a.segment.name {
    flex: 1 1 0;
    min-width: 1em;
    max-width: max-content;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    font-variant-ligatures: none;
    font-size: var(--sw-text-2xs);
    color: var(--sw-text-muted);
  }

  /* No keyboard to press it on. */
  @media (hover: none) {
    .cmdk-trigger kbd {
      display: none;
    }
  }
</style>
