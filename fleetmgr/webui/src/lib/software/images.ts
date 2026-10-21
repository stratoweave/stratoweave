// The software image list: images keyed by name, each with the OS it runs,
// the hardware models it is for and its version.

export interface CatalogImage {
  name: string;
  os: string;
  models: string[];
  version: string;
}

export type SortKey = 'name' | 'os' | 'models' | 'version';

export const OS_NAMES = ['IOS XE', 'IOS XR', 'NX-OS', 'Junos', 'EOS'];

/** What the file chooser offers: the image files of those systems. */
export const IMAGE_FILE_TYPES = '.bin,.pkg,.iso,.tar,.tgz,.swi';

/** Release-aware: 17.9.4a before 17.12.3, 7.11.2 before 23.4R2. */
export function compareVersions(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function compareModels(a: string[], b: string[]): number {
  return [...a].sort().join(' ').localeCompare([...b].sort().join(' '), undefined, { numeric: true });
}

export function compareBy(key: SortKey, a: CatalogImage, b: CatalogImage): number {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    case 'os':
      return a.os.localeCompare(b.os);
    case 'models':
      return compareModels(a.models, b.models);
    case 'version':
      return compareVersions(a.version, b.version);
  }
}

/** Sorted by key; within one OS the newest version comes first, then the
 * name keeps equal rows in a stable order. */
export function sortImages(images: CatalogImage[], key: SortKey, ascending: boolean): CatalogImage[] {
  const sign = ascending ? 1 : -1;
  return [...images].sort(
    (a, b) =>
      sign * compareBy(key, a, b) ||
      (key === 'os' ? -compareBy('version', a, b) : 0) ||
      compareBy('name', a, b)
  );
}

export function matchesFilter(image: CatalogImage, text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  return [image.name, image.os, image.version, ...image.models].some((v) => v.toLowerCase().includes(t));
}

/** The version an IOS XE style name carries: the run of dot-separated
 * components that start with a digit. */
export function versionFromName(name: string): string {
  const parts = name.split('.');
  const start = parts.findIndex((p) => /^\d/.test(p));
  if (start <= 0) return '';
  let end = start;
  while (end < parts.length && /^\d/.test(parts[end])) end++;
  return end - start >= 2 ? parts.slice(start, end).join('.') : '';
}

const IOS_XE_IMAGE = /^([A-Za-z0-9][\w-]*)\.(\d+\.\d+\.\d+[a-z]?)\.SPA\.bin$/;

/** The OS and version an image file name carries. Only IOS XE names are
 * recognized for now, <family>.<version>.SPA.bin; any other name leaves
 * both empty rather than guess. */
export function imageFromFileName(name: string): { os: string; version: string } {
  const xe = IOS_XE_IMAGE.exec(name);
  return xe ? { os: 'IOS XE', version: xe[2] } : { os: '', version: '' };
}

/** The newest image of the same IOS XE family (e.g. c8000v-universalk9) with
 * an older version, to copy models from; null when there is none. */
export function previousImage(image: CatalogImage, images: CatalogImage[]): CatalogImage | null {
  const family = IOS_XE_IMAGE.exec(image.name)?.[1];
  if (family === undefined) return null;
  let previous: CatalogImage | null = null;
  for (const i of images) {
    if (IOS_XE_IMAGE.exec(i.name)?.[1] !== family || compareVersions(i.version, image.version) >= 0) continue;
    if (previous === null || compareVersions(i.version, previous.version) > 0) previous = i;
  }
  return previous;
}

/** `models` plus those of `from` it lacks. */
export function withModelsOf(models: string[], from: CatalogImage): string[] {
  return [...models, ...from.models.filter((m) => !models.includes(m))];
}

export type ImageErrors = Partial<Record<'name' | 'os' | 'version' | 'models', string>>;

/** What keeps an image from being saved. `taken` holds the names already in
 * the list; null skips the name, which an edit does not change. */
export function imageErrors(image: CatalogImage, taken: Set<string> | null): ImageErrors {
  const e: ImageErrors = {};
  const name = image.name.trim();
  if (taken !== null) {
    if (!name) e.name = 'Required.';
    else if (taken.has(name)) e.name = 'Already exists.';
  }
  if (!image.os.trim()) e.os = 'Required.';
  if (!image.version.trim()) e.version = 'Required.';
  if (image.models.length === 0) e.models = 'At least one model.';
  return e;
}

/** A model typed but not added yet keeps the image from being saved, so
 * that it is not lost. */
export function withDraftError(errors: ImageErrors, draft: string): ImageErrors {
  const d = draft.trim();
  return d ? { ...errors, models: `Press Enter to add ${d}, or clear the field.` } : errors;
}

/** What a model's count in a pick list means. */
export function imageCountLabel(count: number): string {
  return count === 1 ? 'in 1 image' : `in ${count} images`;
}

/** Models in use, most used first, for pick lists. */
export function knownModels(images: CatalogImage[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const i of images) for (const m of i.models) counts.set(m, (counts.get(m) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
