<script lang="ts">
  import { untrack } from 'svelte';
  import { invalidate } from '$app/navigation';

  import ConfirmDialog from '$lib/core/ui/ConfirmDialog.svelte';
  import FieldText from '$lib/core/ui/FieldText.svelte';
  import Section from '$lib/core/ui/Section.svelte';
  import { getListEntryPath, restconfDelete, restconfPatchJson } from '$lib/core/restconf/client';
  import {
    CATALOG_IMAGE_ROOT,
    CATALOG_MATRIX_ROOT,
    DATA_ROOT,
    formatBytes,
    imageApprovalPatch,
    imagePatch,
    matrixEntryPatch,
    type CatalogImage,
    type MatrixEntry,
    type NewImage,
    type NewMatrixEntry
  } from '$lib/software/model';

  let {
    data
  }: { data: { images: CatalogImage[]; matrix: MatrixEntry[]; loadError: string } } = $props();

  let statusMessage = $state<{ type: 'success' | 'error'; text: string } | null>(
    untrack(() => (data.loadError ? { type: 'error', text: data.loadError } : null))
  );
  let busy = $state(false);
  let selectedVersion = $state<string>('');
  let imageDraft = $state<NewImage | null>(null);
  let matrixDraft = $state<NewMatrixEntry | null>(null);
  let approver = $state('');
  let changeRef = $state('');
  let deleteTarget = $state<{ kind: 'image' | 'matrix'; label: string; path: string } | null>(null);

  let selected = $derived(
    data.images.find((i) => i.version === selectedVersion) ?? data.images[0] ?? null
  );

  interface Attr {
    key: string;
    value: string;
    stored: boolean;
    note: string;
  }

  function attrs(image: CatalogImage): Attr[] {
    const cleared = data.matrix.filter(
      (m) => m.targetVersion === image.version && m.approval !== 'excluded'
    ).length;
    const storage =
      image.storageMinFlash !== null || image.storageMinFree !== null
        ? `flash ≥ ${formatBytes(image.storageMinFlash)} · free ≥ ${formatBytes(image.storageMinFree)}`
        : '';
    return [
      { key: 'version', value: image.version, stored: true, note: 'as reported by the device after activation' },
      { key: 'file-name', value: image.fileName, stored: image.fileName !== '', note: 'the name the adapter passes to xcopy' },
      { key: 'file-size', value: image.fileSize !== null ? `${image.fileSize.toLocaleString()} bytes` : '', stored: image.fileSize !== null, note: 'checked against free storage before transfer' },
      { key: 'checksum', value: image.checksum ? `${image.checksum.slice(0, 18)}…` : '', stored: image.checksum !== '', note: 'verified on the image server and again on bootflash' },
      { key: 'supported-hardware', value: cleared > 0 ? `${cleared} of ${data.matrix.length} models` : '', stored: cleared > 0, note: 'resolved from the matrix below, not free text' },
      { key: 'storage-requirement', value: storage, stored: storage !== '', note: 'the precheck reads these two numbers' },
      { key: 'rommon-requirement', value: image.rommonMin ? `≥ ${image.rommonMin}` : '', stored: image.rommonMin !== '', note: 'blocks activation, not transfer' },
      { key: 'known-restrictions', value: image.restrictions.length > 0 ? `${image.restrictions.length} recorded` : '', stored: image.restrictions.length > 0, note: 'shown to the operator before run' },
      { key: 'rollback-path', value: image.rollbackTo ? `→ ${image.rollbackTo}` : '', stored: image.rollbackTo !== '', note: 'must itself be a catalogue image' }
    ];
  }

  let selectedAttrs = $derived(selected ? attrs(selected) : []);
  let storedCount = $derived(selectedAttrs.filter((a) => a.stored).length);
  let missing = $derived(selectedAttrs.filter((a) => !a.stored).map((a) => a.key));

  function modelsCleared(version: string): string {
    if (data.matrix.length === 0) return '—';
    const n = data.matrix.filter((m) => m.targetVersion === version && m.approval !== 'excluded').length;
    return `${n} of ${data.matrix.length}`;
  }

  function openRegister(image?: CatalogImage): void {
    imageDraft = image
      ? {
          version: image.version,
          fileName: image.fileName,
          fileSize: image.fileSize !== null ? String(image.fileSize) : '',
          checksum: image.checksum,
          url: image.url,
          rommonMin: image.rommonMin,
          rollbackTo: image.rollbackTo,
          storageMinFlash: image.storageMinFlash !== null ? String(image.storageMinFlash) : '',
          storageMinFree: image.storageMinFree !== null ? String(image.storageMinFree) : '',
          restrictions: image.restrictions.map((r) => `${r.id}: ${r.description}`).join('\n')
        }
      : {
          version: '', fileName: '', fileSize: '', checksum: '', url: '',
          rommonMin: '', rollbackTo: '', storageMinFlash: '', storageMinFree: '', restrictions: ''
        };
    matrixDraft = null;
    statusMessage = null;
  }

  function openMatrixRow(entry?: MatrixEntry): void {
    matrixDraft = entry
      ? {
          model: entry.model,
          revision: entry.revision,
          targetVersion: entry.targetVersion,
          minFlash: entry.minFlash !== null ? String(entry.minFlash) : '',
          minFree: entry.minFree !== null ? String(entry.minFree) : '',
          installModeSupport: entry.installModeSupport,
          approval: entry.approval,
          exclusion: entry.exclusion
        }
      : {
          model: '', revision: '', targetVersion: '', minFlash: '', minFree: '',
          installModeSupport: 'yes', approval: 'conditional', exclusion: ''
        };
    imageDraft = null;
    statusMessage = null;
  }

  async function write(action: () => Promise<unknown>, success: string): Promise<void> {
    try {
      busy = true;
      statusMessage = null;
      await action();
      statusMessage = { type: 'success', text: success };
      imageDraft = null;
      matrixDraft = null;
      await invalidate('data:catalog');
    } catch (error) {
      statusMessage = {
        type: 'error',
        text: error instanceof Error ? error.message : 'The write failed.'
      };
    } finally {
      busy = false;
    }
  }

  function saveImage(): void {
    const draft = imageDraft;
    if (!draft || !draft.version.trim()) {
      statusMessage = { type: 'error', text: 'A version is required.' };
      return;
    }
    void write(
      () => restconfPatchJson(DATA_ROOT, imagePatch(draft)),
      `Saved image ${draft.version}.`
    );
  }

  function saveMatrixRow(): void {
    const draft = matrixDraft;
    if (!draft || !draft.model.trim() || !draft.revision.trim()) {
      statusMessage = { type: 'error', text: 'Model and revision are required.' };
      return;
    }
    void write(
      () => restconfPatchJson(DATA_ROOT, matrixEntryPatch(draft)),
      `Saved matrix row ${draft.model} ${draft.revision}.`
    );
  }

  function setApproval(state: 'approved' | 'withdrawn'): void {
    if (!selected) return;
    const version = selected.version;
    void write(
      () => restconfPatchJson(DATA_ROOT, imageApprovalPatch(version, state, approver, changeRef)),
      `${version} ${state}.`
    );
  }

  async function handleDelete(): Promise<void> {
    const target = deleteTarget;
    deleteTarget = null;
    if (!target) return;
    await write(() => restconfDelete(target.path), `Removed ${target.label}.`);
  }
</script>

<div class="page-header">
  <div>
    <h2>Image catalogue</h2>
    <p style:max-width="760px">
      An image may only be used if at least the version, file name, file size,
      checksum, supported hardware, storage requirements, any ROMMON
      requirement, known restrictions and rollback path are stored and
      approved. The campaign's release picker offers approved images only.
    </p>
  </div>
  <button class="btn btn-primary" type="button" onclick={() => openRegister()} disabled={busy}>
    Register image
  </button>
</div>

{#if statusMessage}
  <div class={statusMessage.type === 'error' ? 'error-state status' : 'success-banner status'}>
    {statusMessage.text}
  </div>
{/if}

<section class="card">
  <div class="split">
    <div>
      {#if data.images.length === 0}
        <div class="empty-state">No images registered.</div>
      {:else}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>File</th>
                <th class="right">Size</th>
                <th>Approval</th>
                <th>Models cleared</th>
                <th>Approved by</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each data.images as image (image.version)}
                <tr class:selected={selected?.version === image.version}>
                  <td>
                    <button class="row-pick mono tn" type="button" onclick={() => (selectedVersion = image.version)}>
                      {image.version}
                    </button>
                  </td>
                  <td class="mono file">{image.fileName || '—'}</td>
                  <td class="tn right">{formatBytes(image.fileSize)}</td>
                  <td>
                    <span class="mark" class:ok={image.approvalState === 'approved'} class:bad={image.approvalState !== 'approved'}>●</span>
                    {image.approvalState}
                  </td>
                  <td class="tn">{modelsCleared(image.version)}</td>
                  <td class="mono">{image.approvedBy || '—'}</td>
                  <td class="col-action">
                    <button class="btn btn-secondary btn-small" type="button" onclick={() => openRegister(image)}>Edit</button>
                    <button
                      class="btn btn-secondary btn-small btn-danger-ghost"
                      type="button"
                      onclick={() =>
                        (deleteTarget = {
                          kind: 'image',
                          label: `image ${image.version}`,
                          path: getListEntryPath(CATALOG_IMAGE_ROOT, image.version)
                        })}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      {#if selected && missing.length > 0}
        <div class="incomplete">
          <div class="incomplete-head">
            <span class="mono tn">{selected.version}</span>
            <span>cannot be used — {missing.length} required attributes missing</span>
          </div>
          <div class="incomplete-body">
            Missing: {missing.join(', ')}. The record can be saved and edited, but the image is
            not offered to any campaign until every attribute is stored and an approver signs it
            off. The gate is enforced in the CFS rather than in the UI.
          </div>
        </div>
      {/if}

      {#if selected && selected.restrictions.length > 0}
        <div class="kick" style:margin="22px 0 10px">Known restrictions — {selected.version}</div>
        {#each selected.restrictions as r (r.id)}
          <div class="restriction">
            <span class="mono rid">{r.id}</span>
            <span class="rtext">{r.description}</span>
          </div>
        {/each}
      {/if}
    </div>

    <div class="rail">
      {#if selected}
        <div class="rail-head">
          <span class="kick">Required attributes — {selected.version}</span>
          <span class="pill" class:pill-run={storedCount === 9}>{storedCount} of 9 stored</span>
        </div>
        {#each selectedAttrs as a (a.key)}
          <div class="attr">
            <span class="mark" class:ok={a.stored} class:idle={!a.stored}>{a.stored ? '●' : '○'}</span>
            <div class="attr-body">
              <div class="attr-row">
                <span class="mono akey">{a.key}</span>
                <span class="mono tn aval">{a.value || '—'}</span>
              </div>
              <div class="anote">{a.note}</div>
            </div>
          </div>
        {/each}

        <div class="approval-box" class:approved={selected.approvalState === 'approved'}>
          {#if selected.approvalState === 'approved'}
            <div class="approval-body">
              <div class="approval-title">Approved for use</div>
              <div class="approval-sub">
                {selected.approvedBy || '—'} · {selected.approvedAt.slice(0, 16) || '—'}{selected.changeRef ? ` · ${selected.changeRef}` : ''}
              </div>
            </div>
            <button class="btn btn-secondary" type="button" disabled={busy} onclick={() => setApproval('withdrawn')}>
              Withdraw
            </button>
          {:else}
            <div class="approval-body">
              <div class="approval-title">{selected.approvalState === 'withdrawn' ? 'Withdrawn' : 'Not approved'}</div>
              <div class="approve-inputs">
                <input class="fld" placeholder="approved by" bind:value={approver} />
                <input class="fld" placeholder="change ref" bind:value={changeRef} />
              </div>
            </div>
            <button
              class="btn btn-primary"
              type="button"
              disabled={busy || missing.length > 0}
              title={missing.length > 0 ? 'store every required attribute first' : undefined}
              onclick={() => setApproval('approved')}
            >
              Approve
            </button>
          {/if}
        </div>
      {:else}
        <div class="empty-state">Register an image to see its attribute checklist.</div>
      {/if}
    </div>
  </div>
</section>

{#if imageDraft}
  <section class="card">
    <Section
      title={data.images.some((i) => i.version === imageDraft?.version) ? `Edit ${imageDraft.version}` : 'Register image'}
      description="Everything the requirement demands; approval is a separate act."
      yangPath="software:software/catalog/image"
    >
      <div class="grid-3">
        <FieldText label="Version" required={true} value={imageDraft.version} mono={true} yangType="string" onchange={(v) => { if (imageDraft) imageDraft = { ...imageDraft, version: v }; }} />
        <FieldText label="File name" value={imageDraft.fileName} mono={true} yangType="string" onchange={(v) => { if (imageDraft) imageDraft = { ...imageDraft, fileName: v }; }} />
        <FieldText label="File size (bytes)" value={imageDraft.fileSize} mono={true} yangType="uint64" onchange={(v) => { if (imageDraft) imageDraft = { ...imageDraft, fileSize: v }; }} />
        <FieldText label="Checksum" value={imageDraft.checksum} mono={true} yangType="string" placeholder="sha512:…" onchange={(v) => { if (imageDraft) imageDraft = { ...imageDraft, checksum: v }; }} />
        <FieldText label="Image server URL" value={imageDraft.url} mono={true} yangType="string" placeholder="scp://user:pw@host:/path" help="Credentials live here, never on campaigns." onchange={(v) => { if (imageDraft) imageDraft = { ...imageDraft, url: v }; }} />
        <FieldText label="ROMMON minimum" value={imageDraft.rommonMin} mono={true} yangType="string" onchange={(v) => { if (imageDraft) imageDraft = { ...imageDraft, rommonMin: v }; }} />
        <FieldText label="Rollback to" value={imageDraft.rollbackTo} mono={true} yangType="leafref" placeholder="another catalogue version" onchange={(v) => { if (imageDraft) imageDraft = { ...imageDraft, rollbackTo: v }; }} />
        <FieldText label="Min flash (bytes)" value={imageDraft.storageMinFlash} mono={true} yangType="uint64" onchange={(v) => { if (imageDraft) imageDraft = { ...imageDraft, storageMinFlash: v }; }} />
        <FieldText label="Min free (bytes)" value={imageDraft.storageMinFree} mono={true} yangType="uint64" onchange={(v) => { if (imageDraft) imageDraft = { ...imageDraft, storageMinFree: v }; }} />
      </div>
      <label class="kick" for="restrictions">Known restrictions — one per line, `id: description`</label>
      <textarea id="restrictions" class="paste mono" rows="3" bind:value={imageDraft.restrictions}></textarea>
      <div class="editor-actions">
        <button class="btn btn-secondary" type="button" onclick={() => (imageDraft = null)} disabled={busy}>Cancel</button>
        <button class="btn btn-primary" type="button" onclick={saveImage} disabled={busy}>
          {busy ? 'Saving…' : 'Save record'}
        </button>
      </div>
    </Section>
  </section>
{/if}

<section class="card">
  <div class="matrix-head">
    <div>
      <h3 class="panel-title">Hardware–image matrix</h3>
      <div class="hint" style:max-width="780px">
        The "Falkenauer list", maintained here as administrable data rather than a document.
        Each row pairs a hardware model and revision with a target version and the conditions
        under which that pairing is permitted. Selection exclusions on the wizard come from
        these rows.
      </div>
    </div>
    <button class="btn btn-primary" type="button" onclick={() => openMatrixRow()} disabled={busy}>
      Add row
    </button>
  </div>

  {#if data.matrix.length === 0}
    <div class="empty-state">No matrix rows.</div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Hardware model</th>
            <th>Revision</th>
            <th>Target version</th>
            <th class="right">Min flash</th>
            <th class="right">Min free</th>
            <th>Install Mode</th>
            <th>Approval</th>
            <th>Exclusion criteria</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each data.matrix as m (m.model + m.revision)}
            <tr>
              <td class="mono model">{m.model}</td>
              <td class="mono">{m.revision}</td>
              <td class="mono tn">{m.targetVersion || '—'}</td>
              <td class="tn right">{formatBytes(m.minFlash)}</td>
              <td class="tn right">{formatBytes(m.minFree)}</td>
              <td>
                <span class="mark" class:ok={m.installModeSupport === 'yes'} class:idle={m.installModeSupport === 'bundle-only'} class:bad={m.installModeSupport === 'no'}>●</span>
                {m.installModeSupport || '—'}
              </td>
              <td>
                <span class="mark" class:ok={m.approval === 'approved'} class:idle={m.approval === 'conditional'} class:bad={m.approval === 'excluded'}>●</span>
                {m.approval}
              </td>
              <td class="excl">{m.exclusion || '—'}</td>
              <td class="col-action">
                <button class="btn btn-secondary btn-small" type="button" onclick={() => openMatrixRow(m)}>Edit</button>
                <button
                  class="btn btn-secondary btn-small btn-danger-ghost"
                  type="button"
                  onclick={() =>
                    (deleteTarget = {
                      kind: 'matrix',
                      label: `matrix row ${m.model} ${m.revision}`,
                      path: getListEntryPath(CATALOG_MATRIX_ROOT, [m.model, m.revision])
                    })}
                >
                  Remove
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if matrixDraft}
    <div class="matrix-form">
      <div class="grid-4">
        <FieldText label="Hardware model" required={true} value={matrixDraft.model} mono={true} yangType="string" onchange={(v) => { if (matrixDraft) matrixDraft = { ...matrixDraft, model: v }; }} />
        <FieldText label="Revision" required={true} value={matrixDraft.revision} mono={true} yangType="string" onchange={(v) => { if (matrixDraft) matrixDraft = { ...matrixDraft, revision: v }; }} />
        <div class="sel-field">
          <span class="kick">target version</span>
          <select class="fld" bind:value={matrixDraft.targetVersion}>
            <option value="">— no upgrade path —</option>
            {#each data.images as image (image.version)}
              <option value={image.version}>{image.version}</option>
            {/each}
          </select>
        </div>
        <div class="sel-field">
          <span class="kick">install mode</span>
          <select class="fld" bind:value={matrixDraft.installModeSupport}>
            <option value="yes">yes</option>
            <option value="bundle-only">bundle only</option>
            <option value="no">no</option>
          </select>
        </div>
        <FieldText label="Min flash (bytes)" value={matrixDraft.minFlash} mono={true} yangType="uint64" onchange={(v) => { if (matrixDraft) matrixDraft = { ...matrixDraft, minFlash: v }; }} />
        <FieldText label="Min free (bytes)" value={matrixDraft.minFree} mono={true} yangType="uint64" onchange={(v) => { if (matrixDraft) matrixDraft = { ...matrixDraft, minFree: v }; }} />
        <div class="sel-field">
          <span class="kick">approval</span>
          <select class="fld" bind:value={matrixDraft.approval}>
            <option value="approved">approved</option>
            <option value="conditional">conditional</option>
            <option value="excluded">excluded</option>
          </select>
        </div>
        <FieldText label="Exclusion criteria" value={matrixDraft.exclusion} yangType="string" onchange={(v) => { if (matrixDraft) matrixDraft = { ...matrixDraft, exclusion: v }; }} />
      </div>
      <div class="editor-actions">
        <button class="btn btn-secondary" type="button" onclick={() => (matrixDraft = null)} disabled={busy}>Cancel</button>
        <button class="btn btn-primary" type="button" onclick={saveMatrixRow} disabled={busy}>
          {busy ? 'Saving…' : 'Save row'}
        </button>
      </div>
    </div>
  {/if}

  <div class="matrix-note">
    Editing is a change, not a save: rows are configuration like any other, and loosening a
    constraint re-evaluates campaign selections at the next expansion.
  </div>
</section>

<ConfirmDialog
  open={deleteTarget !== null}
  title="Remove from catalogue"
  message={`Remove ${deleteTarget?.label ?? ''}? Campaigns referencing it fall back to their own image-url or stop matching.`}
  confirmLabel="Remove"
  oncancel={() => (deleteTarget = null)}
  onconfirm={handleDelete}
/>

<style>
  .status {
    margin-bottom: 12px;
  }

  .success-banner {
    padding: 10px 14px;
    border-radius: var(--sw-radius-md);
    border: 1px solid rgba(37, 99, 235, 0.35);
    background: rgba(37, 99, 235, 0.08);
    color: var(--sw-text-primary);
    font-size: 13px;
  }

  .card {
    padding: 20px;
    margin-bottom: 16px;
  }

  .split {
    display: grid;
    grid-template-columns: 1fr 470px;
    gap: 28px;
  }

  @media (max-width: 1100px) {
    .split {
      grid-template-columns: 1fr;
    }
  }

  .table-wrap {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  th {
    text-align: left;
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--sw-text-muted);
    padding: 9px 10px;
    border-bottom: 1px solid var(--sw-border-subtle);
    white-space: nowrap;
  }

  th.right {
    text-align: right;
  }

  td {
    padding: 11px 10px;
    border-bottom: 1px solid rgba(226, 232, 240, 0.07);
    vertical-align: middle;
  }

  td.right {
    text-align: right;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  tr.selected td {
    background: rgba(37, 99, 235, 0.06);
  }

  .row-pick {
    background: none;
    border: none;
    padding: 0;
    color: #93b4fc;
    font-size: 12.5px;
    cursor: pointer;
  }

  .file {
    color: var(--sw-text-secondary);
    font-size: 12px;
    word-break: break-all;
  }

  .model {
    color: #93b4fc;
  }

  .mark {
    font-size: 11px;
  }

  .mark.ok {
    color: var(--sw-accent);
  }

  .mark.bad {
    color: #f87171;
  }

  .mark.idle {
    color: var(--sw-text-muted);
  }

  .col-action {
    text-align: right;
    white-space: nowrap;
  }

  .btn-small {
    padding: 4px 10px;
    font-size: 12px;
  }

  .btn-danger-ghost {
    color: var(--sw-danger);
  }

  .incomplete {
    margin-top: 20px;
    border: 1px solid rgba(239, 68, 68, 0.28);
    background: rgba(239, 68, 68, 0.06);
    border-radius: 8px;
    padding: 13px 15px;
  }

  .incomplete-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 6px;
    color: #f87171;
    font-weight: 500;
    font-size: 13px;
  }

  .incomplete-body {
    font-size: 12.5px;
    color: var(--sw-text-secondary);
    line-height: 1.65;
  }

  .restriction {
    display: flex;
    gap: 13px;
    padding: 10px 0;
    border-bottom: 1px solid rgba(226, 232, 240, 0.07);
  }

  .rid {
    width: 92px;
    flex-shrink: 0;
    color: #a78bfa;
    font-size: 12px;
  }

  .rtext {
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--sw-text-secondary);
  }

  .rail {
    border-left: 1px solid var(--sw-border-subtle);
    padding-left: 26px;
  }

  @media (max-width: 1100px) {
    .rail {
      border-left: none;
      padding-left: 0;
    }
  }

  .rail-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .attr {
    display: flex;
    gap: 11px;
    padding: 9px 0;
    border-bottom: 1px solid rgba(226, 232, 240, 0.07);
  }

  .attr-body {
    flex: 1;
    min-width: 0;
  }

  .attr-row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    justify-content: space-between;
  }

  .akey {
    color: var(--sw-text-muted);
    flex-shrink: 0;
    font-size: 12px;
  }

  .aval {
    text-align: right;
    word-break: break-all;
    font-size: 12px;
  }

  .anote {
    font-size: 11.5px;
    color: var(--sw-text-muted);
    margin-top: 2px;
    line-height: 1.5;
  }

  .approval-box {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 18px;
    padding: 12px 14px;
    border: 1px solid var(--sw-border-default);
    border-radius: 8px;
  }

  .approval-box.approved {
    border-color: rgba(34, 211, 238, 0.3);
    background: rgba(34, 211, 238, 0.05);
  }

  .approval-body {
    flex: 1;
  }

  .approval-title {
    font-size: 13px;
    font-weight: 500;
  }

  .approval-box.approved .approval-title {
    color: var(--sw-accent);
  }

  .approval-sub {
    font-size: 12px;
    color: var(--sw-text-secondary);
    margin-top: 2px;
  }

  .approve-inputs {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  .fld {
    background: var(--sw-bg-input);
    border: 1px solid var(--sw-border-default);
    border-radius: 6px;
    color: var(--sw-text-primary);
    padding: 7px 10px;
    font-size: 12px;
    outline: none;
    width: 100%;
  }

  .grid-3 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  }

  .grid-4 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
  }

  .sel-field {
    display: grid;
    gap: 5px;
    align-content: start;
  }

  .paste {
    width: 100%;
    padding: 9px 12px;
    background: var(--sw-bg-input);
    border: 1px solid var(--sw-border-default);
    border-radius: 6px;
    color: var(--sw-text-primary);
    font-size: 12px;
    resize: vertical;
    outline: none;
    margin-top: 5px;
  }

  .editor-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }

  .matrix-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 16px;
  }

  .panel-title {
    margin: 0 0 4px;
    font-size: 16px;
  }

  .matrix-form {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--sw-border-subtle);
  }

  .matrix-note {
    margin-top: 16px;
    border: 1px solid rgba(139, 92, 246, 0.35);
    background: rgba(139, 92, 246, 0.06);
    border-radius: 8px;
    padding: 13px 15px;
    font-size: 12.5px;
    color: var(--sw-text-secondary);
    line-height: 1.65;
  }

  .excl {
    color: var(--sw-text-secondary);
    font-size: 12.5px;
  }

  .hint {
    font-size: 13px;
    color: var(--sw-text-muted);
    line-height: 1.6;
  }

  .mono {
    font-family: var(--sw-font-mono, ui-monospace, monospace);
  }

  .tn {
    font-variant-numeric: tabular-nums;
  }
</style>
