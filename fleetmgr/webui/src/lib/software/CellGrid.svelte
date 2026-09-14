<script lang="ts">
  import type { DeviceStatusRow, KnownStatus } from '$lib/software/model';

  interface Props {
    rows: DeviceStatusRow[];
    ondevice?: (name: string) => void;
  }

  let { rows, ondevice }: Props = $props();

  // One cell per device. Runs of same-state cells collapse to one rect (a
  // few hundred nodes instead of ~10k), then a 1px pattern overlay re-cuts
  // the per-cell gutters inside each run so the grid still reads as one
  // cell per device. Technique from the design canvas.
  const COLS = 40;
  const PITCH = 6;
  const SIZE = 5;
  const BG = '#0f1a30';

  const COLOR: Record<KnownStatus, string> = {
    pending: '#1d2c49',
    unknown: '#1d2c49',
    'up-to-date': '#1d2c49',
    'upgrade-needed': '#3f3080',
    'in-progress': '#22d3ee',
    succeeded: '#2563eb',
    failed: '#ef4444',
    'rolled-back': '#94a3b8'
  };

  const uid = `gut-${Math.random().toString(36).slice(2, 9)}`;

  interface Rect {
    x: number;
    y: number;
    w: number;
    fill: string;
  }

  let grid = $derived.by(() => {
    const n = rows.length;
    const rowsCount = Math.ceil(n / COLS);
    const rects: Rect[] = [];
    for (let r = 0; r < rowsCount; r++) {
      let c = 0;
      while (c < COLS) {
        const i = r * COLS + c;
        if (i >= n) break;
        const color = COLOR[rows[i].status];
        let len = 1;
        while (c + len < COLS && r * COLS + c + len < n && COLOR[rows[r * COLS + c + len].status] === color) {
          len++;
        }
        rects.push({ x: c * PITCH, y: r * PITCH, w: len * PITCH - 1, fill: color });
        c += len;
      }
    }
    return {
      rects,
      w: Math.min(n, COLS) * PITCH - 1,
      h: rowsCount * PITCH - 1
    };
  });

  function onClick(event: MouseEvent): void {
    if (!ondevice) return;
    const svg = event.currentTarget as SVGSVGElement;
    const bounds = svg.getBoundingClientRect();
    const col = Math.floor((event.clientX - bounds.left) / PITCH);
    const row = Math.floor((event.clientY - bounds.top) / PITCH);
    const index = row * COLS + col;
    if (index >= 0 && index < rows.length) {
      ondevice(rows[index].device);
    }
  }

  function onMove(event: MouseEvent): void {
    const svg = event.currentTarget as SVGSVGElement;
    const bounds = svg.getBoundingClientRect();
    const col = Math.floor((event.clientX - bounds.left) / PITCH);
    const row = Math.floor((event.clientY - bounds.top) / PITCH);
    const index = row * COLS + col;
    const cell = index >= 0 && index < rows.length ? rows[index] : null;
    svg.querySelector('title')!.textContent = cell ? `${cell.device} — ${cell.status}` : '';
  }
</script>

{#if rows.length > 0}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <svg
    width={grid.w}
    height={grid.h}
    viewBox={`0 0 ${grid.w} ${grid.h}`}
    shape-rendering="crispEdges"
    style:display="block"
    style:cursor={ondevice ? 'pointer' : 'default'}
    role="img"
    onclick={onClick}
    onmousemove={onMove}
  >
    <title></title>
    <defs>
      <pattern id={uid} width={PITCH} height={PITCH} patternUnits="userSpaceOnUse">
        <rect x={SIZE} y="0" width={PITCH - SIZE} height={PITCH} fill={BG} />
        <rect x="0" y={SIZE} width={PITCH} height={PITCH - SIZE} fill={BG} />
      </pattern>
    </defs>
    <g>
      {#each grid.rects as r, i (i)}
        <rect x={r.x} y={r.y} width={r.w} height={SIZE} fill={r.fill} />
      {/each}
    </g>
    <rect x="0" y="0" width={grid.w} height={grid.h} fill={`url(#${uid})`} pointer-events="none" />
  </svg>
{/if}
