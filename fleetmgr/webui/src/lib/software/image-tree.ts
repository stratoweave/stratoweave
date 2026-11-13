// The image list and the image folder as one tree of folders. An image in
// the list has a name, which campaigns use, and a file: the path of its
// file in the image folder, its folders and its file name joined by '/'.
// The tree places each image at its file; the folders come from those paths
// and from the folders the image folder holds, empty ones too. A path can
// have a list entry, a file, or both.

import type { ImageFileInfo, ImageFolderListing } from '#lib/core/image-file.ts';
import { compareBy, matchesFilter, type CatalogImage, type SortKey } from '#lib/software/images.ts';
import type { CampaignConfig } from '#lib/software/model.ts';

/** The folder that path is in, '' for the top. */
export function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** The last part of path: the file or folder's own name. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

/** Whether path is inside folder, at any depth. Everything is inside the
 * top, ''. */
export function isInside(path: string, folder: string): boolean {
  return folder === '' ? path !== '' : path.startsWith(`${folder}/`);
}

/** The folders on the way to path, the top one first: a and a/b for a/b/c. */
export function ancestors(path: string): string[] {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** The images page of folder; the top's is /images. */
export function folderHref(folder: string): string {
  return folder ? `/images?folder=${folder.split('/').map(encodeURIComponent).join('/')}` : '/images';
}

/** The page of the image name. */
export function imageHref(name: string): string {
  return `/images/${encodeURIComponent(name)}`;
}

export interface ImageEntry {
  kind: 'image';
  /** Where the file is, or would be, in the image folder. */
  path: string;
  /** The file name, the last part of path. */
  name: string;
  /** The list entry whose file this is; null for a file the list does not
   * have. */
  image: CatalogImage | null;
  /** The names of other list entries with the same file. */
  alsoListed: string[];
  /** The file; null for a list entry whose file is not in the image
   * folder, or when the server has no image folder. */
  file: ImageFileInfo | null;
}

export interface FolderEntry {
  kind: 'folder';
  path: string;
  name: string;
  /** Whether the image folder has it. Otherwise it is only on the path of
   * list entries. */
  onDisk: boolean;
}

export type DriveEntry = ImageEntry | FolderEntry;

export interface ImageTree {
  folders: Map<string, FolderEntry>;
  images: Map<string, ImageEntry>;
  /** Whether the server has an image folder. Without one there are only
   * list entries, and their folders. */
  filesOn: boolean;
}

export function buildTree(images: CatalogImage[], listing: ImageFolderListing | null): ImageTree {
  const folders = new Map<string, FolderEntry>();
  const entries = new Map<string, ImageEntry>();
  const addFolder = (path: string, onDisk: boolean) => {
    const known = folders.get(path);
    if (known) known.onDisk ||= onDisk;
    else folders.set(path, { kind: 'folder', path, name: baseName(path), onDisk });
  };
  for (const folder of listing?.folders ?? []) addFolder(folder, true);
  for (const file of listing?.files ?? []) {
    entries.set(file.name, { kind: 'image', path: file.name, name: baseName(file.name), image: null, alsoListed: [], file });
    for (const a of ancestors(file.name)) addFolder(a, true);
  }
  for (const image of images) {
    const known = entries.get(image.file);
    if (known?.image) known.alsoListed.push(image.name);
    else if (known) known.image = image;
    else {
      const name = baseName(image.file);
      entries.set(image.file, { kind: 'image', path: image.file, name, image, alsoListed: [], file: null });
    }
    for (const a of ancestors(image.file)) addFolder(a, false);
  }
  return { folders, images: entries, filesOn: listing !== null };
}

/** Whether something in the tree has path: a folder, a list entry or a file. */
export function taken(tree: ImageTree, path: string): boolean {
  return tree.folders.has(path) || tree.images.has(path);
}

/** What is directly in folder. */
export function folderContents(tree: ImageTree, folder: string): DriveEntry[] {
  const out: DriveEntry[] = [];
  for (const f of tree.folders.values()) if (parentOf(f.path) === folder) out.push(f);
  for (const i of tree.images.values()) if (parentOf(i.path) === folder) out.push(i);
  return out;
}

/** How many entries each folder has directly in it. */
export function childCounts(tree: ImageTree): Map<string, number> {
  const counts = new Map<string, number>();
  for (const path of [...tree.folders.keys(), ...tree.images.keys()]) {
    const parent = parentOf(path);
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  return counts;
}

/** The images inside folder, at any depth. */
export function imagesInside(tree: ImageTree, folder: string): ImageEntry[] {
  return [...tree.images.values()].filter((i) => isInside(i.path, folder));
}

/** The folders and images in folder, at any depth, that match text: a
 * folder by its name, an image as the image list's filter matches it, a
 * file the list does not have by its name. */
export function searchTree(tree: ImageTree, folder: string, text: string): DriveEntry[] {
  const t = text.trim().toLowerCase();
  const out: DriveEntry[] = [];
  for (const f of tree.folders.values()) {
    if (isInside(f.path, folder) && f.name.toLowerCase().includes(t)) out.push(f);
  }
  for (const i of tree.images.values()) {
    if (!isInside(i.path, folder)) continue;
    if (i.image ? matchesFilter(i.image, t) || i.name.toLowerCase().includes(t) : i.name.toLowerCase().includes(t)) {
      out.push(i);
    }
  }
  return out;
}

export type DriveSortKey = SortKey | 'size';

function asImage(e: ImageEntry): CatalogImage {
  return e.image ?? { name: e.name, file: e.path, os: '', models: [], version: '', family: '', isDefault: false };
}

function byName(a: DriveEntry, b: DriveEntry): number {
  return (
    a.name.localeCompare(b.name, undefined, { numeric: true }) ||
    a.path.localeCompare(b.path, undefined, { numeric: true })
  );
}

/** Folders first, by name; then the images by key, as the image list sorts
 * them, with the name keeping equal rows in a stable order. */
export function sortEntries(entries: DriveEntry[], key: DriveSortKey, ascending: boolean): DriveEntry[] {
  const sign = ascending ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    if (a.kind === 'folder' || b.kind === 'folder') return (key === 'name' ? sign : 1) * byName(a, b);
    if (key === 'name') return sign * byName(a, b);
    if (key === 'size') return sign * ((a.file?.size ?? -1) - (b.file?.size ?? -1)) || byName(a, b);
    const ia = asImage(a);
    const ib = asImage(b);
    return (
      sign * compareBy(key, ia, ib) ||
      (key === 'os' || key === 'family' ? -compareBy('version', ia, ib) : 0) ||
      byName(a, b)
    );
  });
}

/** entries without those inside another of them: moving or deleting a
 * folder takes what is in it along. */
export function outermost(entries: DriveEntry[]): DriveEntry[] {
  const folders = entries.filter((e) => e.kind === 'folder').map((e) => e.path);
  return entries.filter((e) => !folders.some((f) => isInside(e.path, f)));
}

/** The names of the list entries an entry stands for: those whose file is
 * the image's, or is in the folder. */
export function listedNames(tree: ImageTree, entry: DriveEntry): string[] {
  const images = entry.kind === 'image' ? [entry] : imagesInside(tree, entry.path);
  return images.flatMap((i) => (i.image ? [i.image.name, ...i.alsoListed] : []));
}

/** The campaigns that name each image, by image name. */
export function campaignsByImage(campaigns: Pick<CampaignConfig, 'name' | 'images'>[]): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const c of campaigns) {
    for (const image of new Set(c.images)) {
      if (!image) continue;
      const names = used.get(image);
      if (names) names.push(c.name);
      else used.set(image, [c.name]);
    }
  }
  return used;
}

/** The images among entries that a campaign names, each with those
 * campaigns. */
export function imagesInUse(
  tree: ImageTree,
  entries: DriveEntry[],
  used: Map<string, string[]>
): { name: string; campaigns: string[] }[] {
  const out: { name: string; campaigns: string[] }[] = [];
  for (const entry of entries) {
    for (const name of listedNames(tree, entry)) {
      const campaigns = used.get(name);
      if (campaigns) out.push({ name, campaigns });
    }
  }
  return out;
}

/** Bytes as people read them: 812 MB, 1.2 GB. */
export function sizeText(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
