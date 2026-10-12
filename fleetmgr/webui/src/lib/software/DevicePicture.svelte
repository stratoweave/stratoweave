<script lang="ts">
  // A generic 1U router front panel, for looks only.

  const PORT_X = [55, 67, 79, 91, 103, 115];
  // Which of each port's two link lights are on, top row then bottom.
  const LIT = [
    [3, 1, 1, 1, 0, 1],
    [3, 3, 0, 3, 0, 1]
  ];
</script>

<svg class="device-picture" viewBox="0 0 190 44" aria-hidden="true">
  <defs>
    <linearGradient id="device-picture-face" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a4560" />
      <stop offset="1" stop-color="#2a3450" />
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="189" height="43" rx="3" fill="url(#device-picture-face)" stroke="#55607a" />
  <path d="M7.5 1v42M182.5 1v42" stroke="#55607a" />
  {#each [3.8, 186.2] as x (x)}
    <circle cx={x} cy="10" r="1.3" fill="#0a0f1c" />
    <circle cx={x} cy="34" r="1.3" fill="#0a0f1c" />
  {/each}

  <circle cx="16" cy="14.5" r="4" fill="#4ade80" opacity="0.25" />
  <circle cx="16" cy="14.5" r="2.4" fill="#4ade80" />
  <circle cx="16" cy="25.5" r="3.2" fill="#4ade80" opacity="0.2" />
  <circle cx="16" cy="25.5" r="1.9" fill="#4ade80" />
  {#each [11, 16.5, 22, 27.5, 33] as y (y)}
    <rect x="25" {y} width="21" height="1.6" rx="0.8" fill="#0a0f1c" />
  {/each}

  {#each PORT_X as x, i (x)}
    <rect x={x + 2.5} y="8" width="4.5" height="2" fill="#0a0f1c" />
    <rect {x} y="9.5" width="9.5" height="8" rx="0.6" fill="#0a0f1c" />
    <rect x={x + 1.5} y="15" width="2.6" height="1.2" fill={LIT[0][i] & 1 ? '#4ade80' : '#3b4458'} />
    <rect x={x + 5.4} y="15" width="2.6" height="1.2" fill={LIT[0][i] & 2 ? '#4ade80' : '#3b4458'} />

    <rect {x} y="25" width="9.5" height="8" rx="0.6" fill="#0a0f1c" />
    <rect x={x + 2.5} y="32.5" width="4.5" height="2" fill="#0a0f1c" />
    <rect x={x + 1.5} y="26.8" width="2.6" height="1.2" fill={LIT[1][i] & 1 ? '#4ade80' : '#3b4458'} />
    <rect x={x + 5.4} y="26.8" width="2.6" height="1.2" fill={LIT[1][i] & 2 ? '#4ade80' : '#3b4458'} />
  {/each}

  {#each [133, 155] as x (x)}
    {#each [10.5, 26] as y (y)}
      <rect {x} {y} width="19" height="7" rx="1" fill="#0a0f1c" stroke="#6b7590" stroke-width="0.8" />
    {/each}
  {/each}
</svg>

<style>
  .device-picture {
    display: block;
    width: 190px;
    height: 44px;
    flex: none;
  }
</style>
