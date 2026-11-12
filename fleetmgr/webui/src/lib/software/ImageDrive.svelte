<script lang="ts">
  import { tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { goto, invalidate } from '$app/navigation';

  import { errorText } from '#lib/core/errors.ts';
  import { makeImageFolder, nameError } from '#lib/core/image-file.ts';
  import ActionMenu, { type MenuItem } from '#lib/core/ui/ActionMenu.svelte';
  import ConfirmDialog from '#lib/core/ui/ConfirmDialog.svelte';
  import Pager, { paginate } from '#lib/core/ui/Pager.svelte';
  import DriveIcon from '#lib/software/DriveIcon.svelte';
  import FolderPicker from '#lib/software/FolderPicker.svelte';
  import { deleteEntries, moveEntries, type Move } from '#lib/software/image-drive.ts';
  import {
    ancestors,
    baseName,
    childCounts,
    folderContents,
    folderHref,
    imageHref,
    imagesInUse,
    imagesInside,
    isInside,
    joinPath,
    outermost,
    parentOf,
    searchTree,
    sizeText,
    sortEntries,
    taken,
    type DriveEntry,
    type DriveSortKey,
    type ImageTree
  } from '#lib/software/image-tree.ts';

  // One folder of the image tree, Drive style: its folders and images, a
  // trail of the folders above it, and the changes a file manager makes.
  // A move or rename changes where an image's file is, never the image's
  // name, so the campaigns that install it follow.
  // Open a folder by its name; select rows to move or delete them
  // together; drag rows onto a folder, or onto a folder in the trail, to
  // move them there. Each row's menu, also on a right-click, renames,
  // moves and deletes. The filter searches this folder and every folder in
  // it.
  interface Props {
    folder: string;
    tree: ImageTree;
    /** The campaigns that name each image; null when they could not be
     * read. A move reads them again before it starts. */
    inUse: Map<string, string[]> | null;
    /** Files dragged over the window, to upload into this folder. */
    dragging: boolean;
    onstatus: (status: { type: 'success' | 'error'; text: string } | null) => void;
  }

  let { folder, tree, inUse, dragging, onstatus }: Props = $props();

  const COLUMNS: { key: DriveSortKey; label: string }[] = [
    { key: 'name', label: 'Name' },
    { key: 'os', label: 'OS' },
    { key: 'family', label: 'Family' },
    { key: 'models', label: 'Models' },
    { key: 'version', label: 'Version' },
    { key: 'size', label: 'Size' }
  ];
  const MAX_PATH = 400;
  const DRAG_TYPE = 'application/x-stratoweave-image-paths';

  const uid = $props.id();
  let sortKey = $state<DriveSortKey>('name');
  let ascending = $state(true);
  let text = $state('');
  let pageNo = $state(1);
  const selected = new SvelteSet<string>();
  // Where a shift-click selects from.
  let anchor: string | null = null;
  // What a change is doing now, e.g. "Moving, 2 of 5…"; '' when idle.
  let busy = $state('');
  let table: HTMLTableElement | null = $state(null);
  let filter: HTMLInputElement | null = $state(null);
  let dragLabel: HTMLElement | null = $state(null);
  const menus: Record<string, ReturnType<typeof ActionMenu> | undefined> = $state({});

  type Dialog =
    | { kind: 'new-folder'; name: string }
    | { kind: 'rename'; entry: DriveEntry; name: string }
    | { kind: 'move'; entries: DriveEntry[]; to: string | null }
    | { kind: 'delete'; entries: DriveEntry[] };
  let dialog = $state<Dialog | null>(null);
  // What had focus when the dialog opened, to get it back: a dialog that
  // goes away with its {#if} does not return focus as closing it does.
  let opener: HTMLElement | null = null;

  // Rows dragged now, by path; null when no row is.
  let dragPaths = $state<string[] | null>(null);
  // The folder a drop would move them into; null for none.
  let dropTarget = $state<string | null>(null);

  let exists = $derived(folder === '' || tree.folders.has(folder));
  let counts = $derived(childCounts(tree));
  let searching = $derived(text.trim() !== '');
  let rows = $derived(
    sortEntries(searching ? searchTree(tree, folder, text) : folderContents(tree, folder), sortKey, ascending)
  );
  let paged = $derived(paginate(rows, pageNo, 50));
  let selectedRows = $derived(rows.filter((r) => selected.has(r.path)));
  let pageSelected = $derived(paged.rows.filter((r) => selected.has(r.path)).length);
  let trail = $derived(folder ? [...ancestors(folder), folder] : []);
  let allFolders = $derived([...tree.folders.keys()]);

  /** Show the dialog that makes a folder here. */
  export function newFolder(): void {
    if (!tree.filesOn || busy) return;
    openDialog({ kind: 'new-folder', name: 'new-folder' });
  }

  function openDialog(next: Dialog): void {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog = next;
  }

  async function closeDialog(): Promise<void> {
    dialog = null;
    await tick();
    if (opener?.isConnected) opener.focus();
    opener = null;
  }

  function lookup(path: string): DriveEntry | undefined {
    return tree.folders.get(path) ?? tree.images.get(path);
  }

  function sortBy(key: DriveSortKey): void {
    if (key === sortKey) {
      ascending = !ascending;
    } else {
      sortKey = key;
      // A version column reads best newest first, a size column largest.
      ascending = key !== 'version' && key !== 'size';
    }
    pageNo = 1;
  }

  function ariaSort(key: DriveSortKey): 'ascending' | 'descending' | 'none' {
    if (key !== sortKey) return 'none';
    return ascending ? 'ascending' : 'descending';
  }

  function campaignsText(names: string[]): string {
    return names.length === 1 ? `Campaign ${names[0]}` : `Campaigns ${names.join(', ')}`;
  }

  /** Why entries cannot move or be renamed, short, for a menu; '' when
   * they can. Without an image folder the files are elsewhere and would
   * not move with their paths. */
  function moveRefusal(entries: DriveEntry[]): string {
    return tree.filesOn || entries.length === 0 ? '' : 'The server has no image folder.';
  }

  /** What a move of entries does to the campaigns that install their
   * images, for its dialog; '' when none does. */
  function campaignsNote(entries: DriveEntry[]): string {
    const used = inUse ? imagesInUse(tree, entries, inUse) : [];
    if (used.length === 0) return '';
    const campaigns = [...new Set(used.flatMap((u) => u.campaigns))].sort();
    const one = used.length === 1;
    return `${campaignsText(campaigns)} ${campaigns.length === 1 ? 'installs' : 'install'} ${one ? 'this image' : `${used.length} of these images`}: devices that have not fetched ${one ? 'it' : 'them'} yet fetch ${one ? 'it' : 'them'} from the new path.`;
  }

  function open(entry: DriveEntry): void {
    if (entry.kind === 'folder') void goto(folderHref(entry.path));
    else if (entry.image) void goto(imageHref(entry.image.name));
    else void goto(addHref(entry.path));
  }

  /** The add page for a file the list does not have. */
  function addHref(path: string): string {
    return `/images/new?${new URLSearchParams({ file: path })}`;
  }

  function menuItems(entry: DriveEntry): MenuItem[] {
    const why = moveRefusal([entry]);
    const items: MenuItem[] = [
      entry.kind === 'folder'
        ? { label: 'Open', run: () => open(entry) }
        : entry.image
          ? { label: 'Edit', run: () => open(entry) }
          : { label: 'Add to the image list', run: () => open(entry) },
      { label: 'Rename', run: () => startRename(entry), disabled: !!why, hint: why || undefined },
      { label: 'Move to…', run: () => startMove([entry]), disabled: !!why, hint: why || undefined },
      { label: 'Delete', run: () => openDialog({ kind: 'delete', entries: [entry] }), danger: true }
    ];
    return items;
  }

  function contextMenu(event: MouseEvent, entry: DriveEntry): void {
    if (busy) return;
    const menu = menus[entry.path];
    if (!menu) return;
    event.preventDefault();
    menu.openAt(event.clientX, event.clientY);
  }

  // ── Selection ──

  function toggle(entry: DriveEntry, on: boolean, range: boolean): void {
    const from = anchor === null ? -1 : rows.findIndex((r) => r.path === anchor);
    const to = rows.findIndex((r) => r.path === entry.path);
    if (range && from >= 0 && to >= 0) {
      for (const r of rows.slice(Math.min(from, to), Math.max(from, to) + 1)) {
        if (on) selected.add(r.path);
        else selected.delete(r.path);
      }
    } else if (on) {
      selected.add(entry.path);
    } else {
      selected.delete(entry.path);
    }
    anchor = entry.path;
  }

  function togglePage(on: boolean): void {
    for (const r of paged.rows) {
      if (on) selected.add(r.path);
      else selected.delete(r.path);
    }
  }

  function interactive(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('a, button, input, label, [role="menu"]') !== null;
  }

  // ── Changes ──

  // The text field of the new-folder and rename dialogs: what keeps the
  // name from being used in `parent`; '' when nothing does. `current` is
  // the path being renamed, which may keep its name.
  function nameProblem(name: string, parent: string, current: string | null): string {
    const n = name.trim();
    const error = nameError(n);
    if (error) return error;
    const path = joinPath(parent, n);
    if (path === current) return '';
    if (lookup(path)) return 'There is already something of this name here.';
    const longest = current
      ? Math.max(path.length, ...imagesInside(tree, current).map((i) => path.length + i.path.length - current.length))
      : path.length;
    if (longest > MAX_PATH) return `A path would be over ${MAX_PATH} characters.`;
    return '';
  }

  async function settle(focusIndex: number | null): Promise<void> {
    await invalidate('data:images');
    await tick();
    if (focusIndex === null) return;
    // The dialog gave focus back to the menu of a row that may be gone; it
    // goes to the row that took its place.
    if (document.activeElement && document.activeElement !== document.body) return;
    const names = table?.querySelectorAll<HTMLElement>('.entry-name') ?? [];
    const next = names[Math.min(focusIndex, names.length - 1)];
    if (next) next.focus();
    else filter?.focus();
  }

  async function createFolder(name: string): Promise<void> {
    const path = joinPath(folder, name.trim());
    await closeDialog();
    busy = 'Creating the folder…';
    onstatus(null);
    try {
      await makeImageFolder(path);
      onstatus({ type: 'success', text: `Created folder ${name.trim()}.` });
    } catch (makeError) {
      onstatus({ type: 'error', text: errorText(makeError, 'Failed to create the folder.') });
    } finally {
      busy = '';
    }
    await settle(null);
  }

  function startRename(entry: DriveEntry): void {
    if (moveRefusal([entry]) || busy) return;
    openDialog({ kind: 'rename', entry, name: entry.name });
  }

  function startMove(entries: DriveEntry[]): void {
    if (moveRefusal(entries) || busy) return;
    openDialog({ kind: 'move', entries: outermost(entries), to: null });
  }

  // Why the entries cannot go into target, for the folder picker; '' when
  // they can.
  function targetRefusal(entries: DriveEntry[], target: string): string {
    for (const e of entries) {
      if (e.path === target || isInside(target, e.path)) return 'Moving';
    }
    if (entries.every((e) => parentOf(e.path) === target)) return 'Already here';
    for (const e of entries) {
      if (parentOf(e.path) !== target && lookup(joinPath(target, e.name))) return `Has a ${e.name}`;
    }
    for (const e of entries) {
      const to = joinPath(target, e.name);
      const longest =
        e.kind === 'folder'
          ? Math.max(to.length, ...imagesInside(tree, e.path).map((i) => to.length + i.path.length - e.path.length))
          : to.length;
      if (longest > MAX_PATH) return 'Path too long';
    }
    return '';
  }

  function movedText(moves: Move[], target: string | null): string {
    const what = moves.length === 1 ? moves[0].entry.name : `${moves.length} items`;
    if (target === null) return `Renamed ${moves[0].entry.name} to ${baseName(moves[0].to)}.`;
    return `Moved ${what} to ${target ? baseName(target) : 'Images'}.`;
  }

  // target: the folder they go into; null for a rename.
  async function runMoves(moves: Move[], target: string | null): Promise<void> {
    if (moves.length === 0) return;
    const focusIndex = paged.rows.findIndex((r) => r.path === moves[0].entry.path);
    busy = moves.length === 1 ? 'Moving…' : `Moving, 0 of ${moves.length}…`;
    onstatus(null);
    try {
      await moveEntries(moves, (done) => {
        if (moves.length > 1) busy = `Moving, ${done} of ${moves.length}…`;
      });
      onstatus({ type: 'success', text: movedText(moves, target) });
      for (const m of moves) selected.delete(m.entry.path);
    } catch (moveError) {
      onstatus({ type: 'error', text: errorText(moveError, 'Failed to move.') });
    } finally {
      busy = '';
    }
    // Also after an error: part of the change may have been made.
    await settle(focusIndex < 0 ? null : focusIndex);
  }

  async function confirmRename(entry: DriveEntry, name: string): Promise<void> {
    await closeDialog();
    const to = joinPath(parentOf(entry.path), name.trim());
    if (to !== entry.path) await runMoves([{ entry, to }], null);
  }

  async function moveInto(entries: DriveEntry[], target: string): Promise<void> {
    if (dialog) await closeDialog();
    const moves = outermost(entries)
      .filter((e) => parentOf(e.path) !== target)
      .map((e) => ({ entry: e, to: joinPath(target, e.name) }));
    await runMoves(moves, target);
  }

  function deleteText(entries: DriveEntry[]): string {
    const outer = outermost(entries);
    const images = outer.flatMap((e) => (e.kind === 'image' ? [e] : imagesInside(tree, e.path)));
    let text: string;
    if (outer.length === 1) {
      const e = outer[0];
      if (e.kind === 'image') text = e.image ? `Delete ${e.name} and its file?` : `Delete the file ${e.name}?`;
      else if (images.length > 0) {
        text = `Delete the folder ${e.name} and the ${images.length === 1 ? 'image' : `${images.length} images`} in it?`;
      } else text = (counts.get(e.path) ?? 0) > 0 ? `Delete the folder ${e.name} and its folders?` : `Delete the empty folder ${e.name}?`;
    } else {
      text = `Delete ${outer.length} items${images.length > 0 ? `, with ${images.length === 1 ? '1 image' : `${images.length} images`} in all` : ''}?`;
    }
    const used = inUse ? imagesInUse(tree, outer, inUse) : [];
    if (used.length > 0) {
      const campaigns = [...new Set(used.flatMap((u) => u.campaigns))].sort();
      const which = outer.length === 1 && outer[0].kind === 'image' ? 'it' : used.length === 1 ? 'one of them' : `${used.length} of them`;
      text += ` ${campaignsText(campaigns)} ${campaigns.length === 1 ? 'installs' : 'install'} ${which}, and will report ${used.length === 1 ? 'it' : 'them'} missing.`;
    }
    return text;
  }

  async function confirmDelete(entries: DriveEntry[]): Promise<void> {
    await closeDialog();
    const outer = outermost(entries);
    const focusIndex = paged.rows.findIndex((r) => r.path === outer[0]?.path);
    busy = outer.length === 1 ? 'Deleting…' : `Deleting, 0 of ${outer.length}…`;
    onstatus(null);
    try {
      await deleteEntries(outer, (done) => {
        if (outer.length > 1) busy = `Deleting, ${done} of ${outer.length}…`;
      });
      onstatus({ type: 'success', text: outer.length === 1 ? `Deleted ${outer[0].name}.` : `Deleted ${outer.length} items.` });
      for (const e of outer) selected.delete(e.path);
    } catch (deleteError) {
      onstatus({ type: 'error', text: errorText(deleteError, 'Failed to delete.') });
    } finally {
      busy = '';
    }
    await settle(focusIndex < 0 ? null : focusIndex);
  }

  // ── Dragging rows onto folders ──

  function canDrag(entry: DriveEntry): boolean {
    return tree.filesOn && !busy && !(selected.has(entry.path) ? moveRefusal(selectedRows) : moveRefusal([entry]));
  }

  function dragStart(event: DragEvent, entry: DriveEntry): void {
    if (!event.dataTransfer || !canDrag(entry)) {
      event.preventDefault();
      return;
    }
    const moving = outermost(selected.has(entry.path) ? selectedRows : [entry]);
    dragPaths = moving.map((e) => e.path);
    event.dataTransfer.setData(DRAG_TYPE, dragPaths.join('\n'));
    event.dataTransfer.effectAllowed = 'move';
    if (dragLabel) {
      dragLabel.textContent = moving.length === 1 ? moving[0].name : `${moving.length} items`;
      event.dataTransfer.setDragImage(dragLabel, 14, 14);
    }
  }

  function dragEnd(): void {
    dragPaths = null;
    dropTarget = null;
  }

  function dropAllowed(target: string): boolean {
    if (!dragPaths) return false;
    const entries = dragPaths.map(lookup).filter((e) => e !== undefined);
    return targetRefusal(entries, target) === '';
  }

  function dragOver(event: DragEvent, target: string): void {
    if (!dropAllowed(target) || !event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    dropTarget = target;
  }

  function dragLeave(event: DragEvent, target: string): void {
    const into = event.relatedTarget;
    if (dropTarget === target && !(into instanceof Node && (event.currentTarget as Node).contains(into))) {
      dropTarget = null;
    }
  }

  function dropOn(event: DragEvent, target: string): void {
    const paths = dragPaths;
    dragEnd();
    if (!paths) return;
    event.preventDefault();
    const entries = paths.map(lookup).filter((e) => e !== undefined);
    if (targetRefusal(entries, target) === '') void moveInto(entries, target);
  }
</script>

<section class="card drive" class:dropping={dragging}>
  {#if dragging}
    <div class="drop-hint-bar">
      <span class="drop-hint">Drop to upload into {folder ? baseName(folder) : 'Images'}</span>
    </div>
  {/if}

  <div class="toolbar">
    <nav class="trail" aria-label="Folders">
      <ol>
        <li>
          {#if folder === ''}
            <!-- Rows dragged here move to the top; Move to… does it from the keyboard. -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
              class="crumb current"
              class:drop={dropTarget === ''}
              aria-current="page"
              ondragover={(e) => dragOver(e, '')}
              ondragleave={(e) => dragLeave(e, '')}
              ondrop={(e) => dropOn(e, '')}>Images</span
            >
          {:else}
            <a
              class="crumb"
              class:drop={dropTarget === ''}
              href="/images"
              ondragover={(e) => dragOver(e, '')}
              ondragleave={(e) => dragLeave(e, '')}
              ondrop={(e) => dropOn(e, '')}>Images</a
            >
          {/if}
        </li>
        {#each trail as f (f)}
          <li>
            <span class="sep" aria-hidden="true">/</span>
            {#if f === folder}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span
                class="crumb current mono"
                class:drop={dropTarget === f}
                aria-current="page"
                ondragover={(e) => dragOver(e, f)}
                ondragleave={(e) => dragLeave(e, f)}
                ondrop={(e) => dropOn(e, f)}>{baseName(f)}</span
              >
            {:else}
              <a
                class="crumb mono"
                class:drop={dropTarget === f}
                href={folderHref(f)}
                ondragover={(e) => dragOver(e, f)}
                ondragleave={(e) => dragLeave(e, f)}
                ondrop={(e) => dropOn(e, f)}>{baseName(f)}</a
              >
            {/if}
          </li>
        {/each}
      </ol>
    </nav>

    {#if exists}
      <div class="tools">
        <input
          bind:this={filter}
          class="input compact"
          placeholder={folder ? `Search in ${baseName(folder)}` : 'Search images'}
          aria-label={folder ? `Search in ${folder} and its folders` : 'Search images'}
          bind:value={text}
          oninput={() => {
            pageNo = 1;
            selected.clear();
          }}
        />
        {#if selectedRows.length > 0}
          {@const why = moveRefusal(selectedRows)}
          <div class="selection" role="group" aria-label="Selected">
            <span class="count tn">{selectedRows.length} selected</span>
            <button
              class="btn btn-secondary btn-sm"
              type="button"
              disabled={!!busy || !!why}
              title={why || undefined}
              onclick={() => startMove(selectedRows)}
            >
              Move to…
            </button>
            <button
              class="btn btn-secondary btn-sm btn-danger-ghost"
              type="button"
              disabled={!!busy}
              onclick={() => openDialog({ kind: 'delete', entries: selectedRows })}
            >
              Delete
            </button>
            <button class="btn btn-ghost btn-sm" type="button" onclick={() => selected.clear()}>Clear</button>
          </div>
        {:else}
          <span class="count tn">
            {busy || (searching ? `${rows.length} ${rows.length === 1 ? 'match' : 'matches'}` : `${rows.length} ${rows.length === 1 ? 'item' : 'items'}`)}
          </span>
        {/if}
      </div>
    {/if}
  </div>

  {#if !tree.filesOn}
    <p class="note">
      The server has no image folder, so images cannot be uploaded, moved or kept in new folders. Start it with
      <span class="mono">--software.image-dir</span> to use one.
    </p>
  {/if}

  {#if !exists}
    {@const up = [...ancestors(folder)].reverse().find((f) => tree.folders.has(f)) ?? ''}
    <div class="empty-state">
      No folder named <span class="mono">{folder}</span>.
      <a href={folderHref(up)}>Open {up ? baseName(up) : 'Images'}</a>
    </div>
  {:else if rows.length === 0 && !searching}
    <div class="empty-state">
      {#if folder}
        This folder is empty. Drop image files here to upload them into it.
      {:else}
        No images yet. Add one by hand, or drop image files anywhere on this page.
      {/if}
    </div>
  {:else}
    <div class="table-wrap">
      <table bind:this={table} class="entries" aria-busy={busy ? 'true' : undefined}>
        <caption class="sr-only">
          {searching ? `Matches for ${text.trim()} in ${folder || 'Images'}` : `Contents of ${folder || 'Images'}`}
        </caption>
        <thead>
          <tr>
            <th class="col-check">
              <input
                type="checkbox"
                aria-label="Select all on this page"
                checked={paged.rows.length > 0 && pageSelected === paged.rows.length}
                indeterminate={pageSelected > 0 && pageSelected < paged.rows.length}
                disabled={paged.rows.length === 0}
                onchange={(e) => togglePage(e.currentTarget.checked)}
              />
            </th>
            {#each COLUMNS as c (c.key)}
              <th class={`col-${c.key}`} aria-sort={ariaSort(c.key)}>
                <button class="sort" class:active={c.key === sortKey} type="button" onclick={() => sortBy(c.key)}>
                  {c.label}
                  <svg
                    class="arrow"
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                    focusable="false"
                  >
                    {#if c.key !== sortKey}
                      <path d="m3 4 2-2 2 2M3 6l2 2 2-2" />
                    {:else if ascending}
                      <path d="m2.5 6.5 2.5-2.5 2.5 2.5" />
                    {:else}
                      <path d="m2.5 3.5 2.5 2.5 2.5-2.5" />
                    {/if}
                  </svg>
                </button>
              </th>
            {/each}
            <th class="col-action"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {#each paged.rows as entry (entry.path)}
            {@const isSelected = selected.has(entry.path)}
            <tr
              class:selected={isSelected}
              class:drop={entry.kind === 'folder' && dropTarget === entry.path}
              class:dragged={dragPaths?.includes(entry.path)}
              draggable={tree.filesOn && !busy ? 'true' : undefined}
              ondragstart={(e) => dragStart(e, entry)}
              ondragend={dragEnd}
              ondragover={entry.kind === 'folder' ? (e) => dragOver(e, entry.path) : undefined}
              ondragleave={entry.kind === 'folder' ? (e) => dragLeave(e, entry.path) : undefined}
              ondrop={entry.kind === 'folder' ? (e) => dropOn(e, entry.path) : undefined}
              oncontextmenu={(e) => contextMenu(e, entry)}
              ondblclick={(e) => {
                if (!interactive(e.target)) open(entry);
              }}
            >
              <td class="check-cell">
                <input
                  type="checkbox"
                  aria-label={`Select ${entry.name}`}
                  checked={isSelected}
                  onclick={(e) => toggle(entry, e.currentTarget.checked, e.shiftKey)}
                />
              </td>
              <td class="name-cell">
                <div class="name-line">
                  <DriveIcon kind={entry.kind === 'folder' ? 'folder' : entry.image ? 'image' : 'file'} />
                  {#if entry.kind === 'folder'}
                    <a class="entry-name mono" href={folderHref(entry.path)}>{entry.name}</a>
                  {:else if entry.image}
                    <a class="entry-name mono" href={imageHref(entry.image.name)}>{entry.name}</a>
                    {#if entry.image.isDefault}<span class="tag default">default</span>{/if}
                  {:else}
                    <span class="entry-name mono plain" tabindex="-1">{entry.name}</span>
                    <a class="tag unlisted" href={addHref(entry.path)} title="This file is not in the image list. Add it.">
                      not listed · add
                    </a>
                  {/if}
                </div>
                {#if entry.kind === 'image' && entry.image && entry.image.name !== entry.name}
                  <span class="listed">image <span class="mono">{entry.image.name}</span></span>
                {/if}
                {#if entry.kind === 'image' && entry.alsoListed.length > 0}
                  <span class="listed">also image <span class="mono">{entry.alsoListed.join(', ')}</span></span>
                {/if}
                {#if searching && parentOf(entry.path) !== folder}
                  <a class="where" href={folderHref(parentOf(entry.path))}>
                    in <span class="mono">{parentOf(entry.path).slice(folder ? folder.length + 1 : 0)}</span>
                  </a>
                {/if}
              </td>
              {#if entry.kind === 'folder'}
                <td class="os-cell"></td>
                <td class="family-cell"></td>
                <td class="models-cell"></td>
                <td class="version-cell"></td>
                {@const n = counts.get(entry.path) ?? 0}
                <td class="size-cell dim tn">{n === 0 ? 'empty' : n === 1 ? '1 item' : `${n} items`}</td>
              {:else}
                <td class="os-cell nowrap">{entry.image?.os ?? ''}</td>
                <td class="family-cell mono" title={entry.image?.family}>{entry.image?.family ?? ''}</td>
                <td class="models-cell">
                  <span class="chips">
                    {#each entry.image?.models ?? [] as m (m)}<span class="tag mono">{m}</span>{/each}
                  </span>
                </td>
                <td class="version-cell mono nowrap">{entry.image?.version ?? ''}</td>
                <td class="size-cell tn nowrap">
                  {#if entry.file}
                    <span title={`${entry.file.size.toLocaleString()} bytes`}>{sizeText(entry.file.size)}</span>
                  {:else if tree.filesOn}
                    <span class="dim" title="The image folder has no file of this name.">no file</span>
                  {/if}
                </td>
              {/if}
              <td class="col-action action-cell">
                <ActionMenu
                  bind:this={menus[entry.path]}
                  items={menuItems(entry)}
                  label={`Actions for ${entry.name}`}
                  disabled={!!busy}
                />
              </td>
            </tr>
          {:else}
            <tr class="empty-row"><td colspan="8" class="dim">Nothing matches.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
    <Pager page={paged.page} pageCount={paged.pageCount} onchange={(p) => (pageNo = p)} />
  {/if}
</section>

<!-- What a dragged row shows under the pointer. -->
<div class="drag-label" bind:this={dragLabel} aria-hidden="true"></div>

{#if dialog?.kind === 'new-folder'}
  {@const d = dialog}
  {@const problem = nameProblem(d.name, folder, null)}
  <ConfirmDialog
    open={true}
    title="New folder"
    message={folder ? `In ${folder}` : ''}
    confirmLabel="Create"
    confirmClass="btn-primary"
    confirmDisabled={!!problem}
    oncancel={closeDialog}
    onconfirm={() => createFolder(d.name)}
  >
    <label class="field dialog-field">
      <span class="field__label">Name</span>
      <input
        class="input mono"
        class:has-error={!!problem}
        type="text"
        data-autofocus
        aria-invalid={problem ? 'true' : undefined}
        aria-describedby={`${uid}-new-error`}
        value={d.name}
        oninput={(e) => (d.name = e.currentTarget.value)}
      />
      <small id={`${uid}-new-error`} class="field__meta" class:field__meta--error={!!problem}>{problem || ' '}</small>
    </label>
  </ConfirmDialog>
{:else if dialog?.kind === 'rename'}
  {@const d = dialog}
  {@const problem = nameProblem(d.name, parentOf(d.entry.path), d.entry.path)}
  {@const dot = d.entry.kind === 'image' ? d.entry.name.lastIndexOf('.') : -1}
  <ConfirmDialog
    open={true}
    title={d.entry.kind === 'folder' ? 'Rename folder' : 'Rename image'}
    message={d.entry.kind === 'image'
      ? d.entry.image
        ? `Only the file is renamed: the image keeps its name, ${d.entry.image.name}. ${campaignsNote([d.entry])}`.trim()
        : ''
      : imagesInside(tree, d.entry.path).some((i) => i.image)
        ? `The images in it keep their names. ${campaignsNote([d.entry])}`.trim()
        : ''}
    confirmLabel="Rename"
    confirmClass="btn-primary"
    confirmDisabled={!!problem || d.name.trim() === d.entry.name}
    oncancel={closeDialog}
    onconfirm={() => confirmRename(d.entry, d.name)}
  >
    <label class="field dialog-field">
      <span class="field__label">Name</span>
      <input
        class="input mono"
        class:has-error={!!problem}
        type="text"
        data-autofocus
        data-select={dot > 0 ? dot : undefined}
        aria-invalid={problem ? 'true' : undefined}
        aria-describedby={`${uid}-rename-error`}
        value={d.name}
        oninput={(e) => (d.name = e.currentTarget.value)}
      />
      <small id={`${uid}-rename-error`} class="field__meta" class:field__meta--error={!!problem}>
        {problem || ' '}
      </small>
    </label>
  </ConfirmDialog>
{:else if dialog?.kind === 'move'}
  {@const d = dialog}
  <ConfirmDialog
    open={true}
    title={d.entries.length === 1 ? `Move ${d.entries[0].name}` : `Move ${d.entries.length} items`}
    message={`Choose the folder to move to. ${campaignsNote(d.entries)}`.trim()}
    confirmLabel={d.to === null ? 'Move' : `Move to ${d.to ? baseName(d.to) : 'Images'}`}
    confirmClass="btn-primary"
    confirmDisabled={d.to === null}
    oncancel={closeDialog}
    onconfirm={() => d.to !== null && moveInto(d.entries, d.to)}
  >
    <FolderPicker
      folders={allFolders}
      value={d.to}
      label="Folders"
      refuse={(target) => targetRefusal(d.entries, target)}
      onchange={(target) => (d.to = target)}
    />
  </ConfirmDialog>
{:else if dialog?.kind === 'delete'}
  {@const d = dialog}
  <ConfirmDialog
    open={true}
    title={outermost(d.entries).length === 1 && d.entries[0].kind === 'folder' ? 'Delete folder' : 'Delete'}
    message={deleteText(d.entries)}
    confirmLabel="Delete"
    confirmClass="btn-danger"
    oncancel={closeDialog}
    onconfirm={() => confirmDelete(d.entries)}
  />
{/if}

<style>
  .drive {
    padding-top: 14px;
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
    margin-bottom: 14px;
  }

  .trail {
    flex: 1 1 260px;
    min-width: 0;
  }

  .trail ol {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    list-style: none;
  }

  .trail li {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }

  .sep {
    color: var(--sw-text-muted);
  }

  .crumb {
    padding: 3px 8px;
    border-radius: var(--sw-radius-sm);
    color: var(--sw-text-secondary);
    font-size: var(--sw-text-md);
    font-weight: 500;
    text-decoration: none;
    overflow-wrap: anywhere;
  }

  .crumb.mono {
    font-size: var(--sw-text-sm);
  }

  a.crumb:hover {
    background: var(--sw-bg-hover);
    color: var(--sw-text-primary);
  }

  .crumb.current {
    color: var(--sw-text-primary);
    font-weight: 600;
  }

  .crumb.drop,
  tr.drop td {
    background: var(--sw-accent-glow-strong);
  }

  .crumb.drop {
    box-shadow: inset 0 0 0 1px var(--sw-accent);
  }

  tr.drop td:first-child {
    box-shadow: inset 2px 0 0 var(--sw-accent);
  }

  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-left: auto;
  }

  .tools .input {
    width: 240px;
  }

  .selection {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .count {
    font-size: var(--sw-text-sm);
    color: var(--sw-text-secondary);
    white-space: nowrap;
  }

  .selection .count {
    margin-right: 4px;
    color: var(--sw-text-primary);
  }

  .note {
    margin-bottom: 14px;
    font-size: var(--sw-text-sm);
    color: var(--sw-text-secondary);
  }

  .entries {
    table-layout: fixed;
    min-width: 920px;
  }

  .col-check,
  .check-cell {
    width: 40px;
    padding-right: 0;
  }

  .col-check input,
  .check-cell input {
    display: block;
    cursor: pointer;
  }

  .col-name {
    width: 32%;
  }

  .col-os {
    width: 8%;
  }

  .col-family {
    width: 17%;
  }

  .col-version {
    width: 10%;
  }

  .col-size {
    width: 9%;
  }

  .col-action {
    width: 52px;
    text-align: right;
  }

  .sort {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    color: inherit;
    cursor: pointer;
  }

  .sort:hover,
  .sort.active {
    color: var(--sw-text-primary);
  }

  .arrow {
    flex-shrink: 0;
    color: var(--sw-text-muted);
  }

  .sort.active .arrow {
    color: var(--sw-accent);
  }

  tbody tr.selected td {
    background: var(--sw-accent-glow);
  }

  tbody tr.dragged td {
    opacity: 0.5;
  }

  tbody tr[draggable='true'] {
    cursor: default;
  }

  .name-line {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .entry-name {
    min-width: 0;
    font-size: var(--sw-text-xs);
    color: var(--sw-accent-bright);
    text-decoration: none;
    overflow-wrap: anywhere;
  }

  a.entry-name:hover {
    text-decoration: underline;
  }

  .entry-name.plain {
    color: var(--sw-text-secondary);
  }

  .listed {
    display: block;
    margin: 2px 0 0 26px;
    font-size: var(--sw-text-xs);
    color: var(--sw-text-muted);
    overflow-wrap: anywhere;
  }

  .where {
    display: block;
    margin: 2px 0 0 26px;
    font-size: var(--sw-text-xs);
    color: var(--sw-text-muted);
    text-decoration: none;
    overflow-wrap: anywhere;
  }

  .where:hover {
    color: var(--sw-text-secondary);
    text-decoration: underline;
  }

  .chips {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .tag {
    flex-shrink: 0;
    padding: 2px 8px;
    border: 1px solid var(--sw-border-default);
    border-radius: var(--sw-radius-xs);
    background: var(--sw-bg-elevated);
    font-size: var(--sw-text-xs);
    white-space: nowrap;
  }

  /* Green as the success pills, so that it stands apart from the cyan
     name links. */
  .tag.default {
    border-color: rgb(var(--sw-success-rgb) / 0.25);
    background: var(--sw-success-dim);
    color: var(--sw-success);
  }

  .tag.unlisted {
    border-style: dashed;
    color: var(--sw-text-secondary);
    text-decoration: none;
  }

  .tag.unlisted:hover {
    border-color: var(--sw-accent);
    color: var(--sw-text-primary);
  }

  .family-cell {
    font-size: var(--sw-text-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .nowrap {
    white-space: nowrap;
  }

  .dim {
    color: var(--sw-text-muted);
  }

  .action-cell {
    padding-top: 4px;
    padding-bottom: 4px;
  }

  /* The menu shows on the row pointed at or focused, and always where
     nothing can point, as row Delete buttons do elsewhere. */
  .action-cell :global(.menu-trigger:not(.open)) {
    opacity: 0;
  }

  tbody tr:hover .action-cell :global(.menu-trigger),
  tbody tr:focus-within .action-cell :global(.menu-trigger),
  tbody tr.selected .action-cell :global(.menu-trigger) {
    opacity: 1;
  }

  @media (hover: none) {
    .action-cell :global(.menu-trigger:not(.open)) {
      opacity: 1;
    }
  }

  .drag-label {
    position: fixed;
    top: -100px;
    left: 0;
    padding: 4px 10px;
    border: 1px solid var(--sw-accent);
    border-radius: var(--sw-radius-sm);
    background: var(--sw-bg-elevated);
    color: var(--sw-text-primary);
    font-family: var(--sw-font-mono);
    font-size: var(--sw-text-xs);
    white-space: nowrap;
    pointer-events: none;
  }

  .dialog-field {
    margin-top: 4px;
  }

  @media (pointer: coarse) {
    .sort {
      min-height: 32px;
    }

    .entry-name {
      display: inline-block;
      padding: 6px 0;
    }
  }

  @media (max-width: 720px) {
    .tools {
      width: 100%;
      margin-left: 0;
    }

    .tools .input {
      flex: 1;
      width: auto;
      min-width: 0;
    }

    /* Each entry becomes a block: the checkbox and its name, then its
       version and OS, then its family and its models. The header stays,
       as a row of sort buttons. */
    .entries {
      min-width: 0;
      table-layout: auto;
    }

    .entries caption + thead,
    .entries tbody {
      display: block;
    }

    .entries thead tr {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0 16px;
      padding: 0 10px;
      border-bottom: 1px solid var(--sw-border-subtle);
      background: var(--sw-bg-surface);
    }

    .entries th {
      display: block;
      width: auto;
      padding: 9px 0;
      border: none;
      background: none;
    }

    .entries th.col-action {
      display: none;
    }

    .entries tbody tr {
      position: relative;
      display: grid;
      grid-template-columns: 28px auto minmax(0, 1fr);
      grid-template-areas:
        'check name name'
        '. version os'
        '. family family'
        '. models models'
        '. size size';
      gap: 4px 12px;
      padding: 12px 0;
    }

    .entries tbody tr + tr {
      border-top: 1px solid var(--sw-border-subtle);
    }

    .entries td {
      display: block;
      width: auto;
      padding: 0;
      border: none;
    }

    .entries td:empty {
      display: none;
    }

    .check-cell {
      grid-area: check;
      padding-top: 2px;
    }

    /* Clear of the menu, which sits at the top right. */
    .entries .name-cell {
      grid-area: name;
      padding-right: 44px;
    }

    .action-cell {
      position: absolute;
      top: 6px;
      right: 0;
    }

    .version-cell {
      grid-area: version;
    }

    .os-cell {
      grid-area: os;
      color: var(--sw-text-secondary);
    }

    .family-cell {
      grid-area: family;
      color: var(--sw-text-secondary);
    }

    .models-cell {
      grid-area: models;
    }

    .size-cell {
      grid-area: size;
      color: var(--sw-text-secondary);
    }

    .empty-row td {
      grid-column: 1 / -1;
    }

    tbody tr:hover td {
      background: none;
    }
  }
</style>
