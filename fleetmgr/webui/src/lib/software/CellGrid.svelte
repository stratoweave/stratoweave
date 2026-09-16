<script lang="ts">
  import type { DeviceStatusRow, KnownStatus } from '$lib/software/model';

  interface Props {
    rows: DeviceStatusRow[];
    ondevice?: (name: string) => void;
  }

  let { rows, ondevice }: Props = $props();

  // One cell per device. Runs of same-state cells collapse to one rect (a
  // few hundred nodes instead of ~10k), then a pattern overlay re-cuts the
  // per-cell gutters inside each run so the grid still reads as one cell
  // per device. Technique from the design canvas.
  //
  // The grid is a block of roughly 4:3: the column count comes from the
  // device count, then the cell is the largest size from MIN_SIZE to
  // MAX_SIZE that keeps the block inside the container width and
  // MAX_HEIGHT. A handful of devices get big squares, thousands get small
  // ones and a taller block.
  const MIN_SIZE = 4;
  const MAX_SIZE = 10;
  const MAX_HEIGHT = 300;
  // Until the container is measured (server render, first paint).
  const FALLBACK_WIDTH = 960;
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

  let width = $state(0);

  function gutter(size: number): number {
    return Math.max(1, Math.round(size / 8));
  }

  let layout = $derived.by(() => {
    const n = rows.length;
    const w = width > 0 ? width : FALLBACK_WIDTH;
    let cols = Math.max(1, Math.ceil(Math.sqrt((n * 4) / 3)));
    const rowsCount = Math.ceil(n / cols);
    let size = MIN_SIZE;
    for (let s = MAX_SIZE; s >= MIN_SIZE; s--) {
      const pitch = s + gutter(s);
      if ((cols - 1) * pitch + s <= w && (rowsCount - 1) * pitch + s <= MAX_HEIGHT) {
        size = s;
        break;
      }
    }
    const g = gutter(size);
    const pitch = size + g;
    // A narrow container wins over the shape: never overflow it.
    cols = Math.min(cols, Math.max(1, Math.floor((w + g) / pitch)));
    return { size, pitch, cols };
  });

  interface Rect {
    x: number;
    y: number;
    w: number;
    fill: string;
  }

  let grid = $derived.by(() => {
    const { pitch, cols, size } = layout;
    const n = rows.length;
    const rowsCount = Math.ceil(n / cols);
    const rects: Rect[] = [];
    for (let r = 0; r < rowsCount; r++) {
      let c = 0;
      while (c < cols) {
        const i = r * cols + c;
        if (i >= n) break;
        const color = COLOR[rows[i].status];
        let len = 1;
        while (c + len < cols && r * cols + c + len < n && COLOR[rows[r * cols + c + len].status] === color) {
          len++;
        }
        rects.push({ x: c * pitch, y: r * pitch, w: (len - 1) * pitch + size, fill: color });
        c += len;
      }
    }
    return {
      rects,
      w: (Math.min(n, cols) - 1) * pitch + size,
      h: (rowsCount - 1) * pitch + size
    };
  });

  function cellAt(event: MouseEvent): DeviceStatusRow | null {
    const svg = event.currentTarget as SVGSVGElement;
    const bounds = svg.getBoundingClientRect();
    const col = Math.floor((event.clientX - bounds.left) / layout.pitch);
    const row = Math.floor((event.clientY - bounds.top) / layout.pitch);
    const index = row * layout.cols + col;
    return col < layout.cols && index >= 0 && index < rows.length ? rows[index] : null;
  }

  function onClick(event: MouseEvent): void {
    const cell = cellAt(event);
    if (cell && ondevice) ondevice(cell.device);
  }

  function onMove(event: MouseEvent): void {
    const cell = cellAt(event);
    const svg = event.currentTarget as SVGSVGElement;
    svg.querySelector('title')!.textContent = cell ? `${cell.device} — ${cell.status}` : '';
  }
</script>

{#if rows.length > 0}
  <div class="wrap" bind:clientWidth={width}>
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
        <pattern id={uid} width={layout.pitch} height={layout.pitch} patternUnits="userSpaceOnUse">
          <rect x={layout.size} y="0" width={layout.pitch - layout.size} height={layout.pitch} fill={BG} />
          <rect x="0" y={layout.size} width={layout.pitch} height={layout.pitch - layout.size} fill={BG} />
        </pattern>
      </defs>
      <g>
        {#each grid.rects as r, i (i)}
          <rect x={r.x} y={r.y} width={r.w} height={layout.size} fill={r.fill} />
        {/each}
      </g>
      <rect x="0" y="0" width={grid.w} height={grid.h} fill={`url(#${uid})`} pointer-events="none" />
    </svg>
  </div>
{/if}

<style>
  .wrap {
    width: 100%;
  }
</style>
