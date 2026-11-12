// Changes to the image folder and the image list together: move or rename
// files and folders, and delete them. An image keeps its name, which the
// campaigns use; its file leaf says where its file is. So a move changes
// the file leaf of the images it takes along, and the campaigns that name
// them give their devices the new URL.

import { errorText } from '#lib/core/errors.ts';
import { deleteImageFile, deleteImageFolder, moveImagePath } from '#lib/core/image-file.ts';
import {
  getListEntryPath,
  restconfDelete,
  restconfGetOrNull,
  restconfPatchJson
} from '#lib/core/restconf/client.ts';
import { isInside, type DriveEntry } from '#lib/software/image-tree.ts';
import type { CatalogImage } from '#lib/software/images.ts';
import { DATA_ROOT, IMAGES_ROOT, IMAGE_LIST_ROOT, imageFilesPatch, parseImages } from '#lib/software/model.ts';

export interface Move {
  entry: DriveEntry;
  /** The path it moves to. */
  to: string;
}

/** The list entries whose file entry is, or is in the folder entry. */
function imagesOf(entry: DriveEntry, list: CatalogImage[]): CatalogImage[] {
  return list.filter((i) => (entry.kind === 'folder' ? isInside(i.file, entry.path) : i.file === entry.path));
}

/** Move each entry to its path, one after the other: its file or folder in
 * the image folder, then, in one write, the file leaf of every image whose
 * file it takes along. `onmoved` hears how many entries are done. */
export async function moveEntries(moves: Move[], onmoved: (done: number) => void = () => {}): Promise<void> {
  // The list as it is now, not as the page loaded it.
  const list = parseImages(await restconfGetOrNull<unknown>(IMAGES_ROOT));
  let done = 0;
  for (const { entry, to } of moves) {
    const from = entry.path;
    if (entry.kind === 'folder' ? entry.onDisk : entry.file !== null) {
      try {
        await moveImagePath(from, to);
      } catch (moveError) {
        throw new Error(`Could not move ${from}: ${errorText(moveError, 'no reply')}`);
      }
    }
    const moved = imagesOf(entry, list).map((i) => ({ name: i.name, file: to + i.file.slice(from.length) }));
    if (moved.length > 0) {
      try {
        await restconfPatchJson(DATA_ROOT, imageFilesPatch(moved));
      } catch (listError) {
        const names = moved.map((m) => m.name).join(', ');
        throw new Error(`Moved ${from}, but the image list still has the old path for ${names}: ${errorText(listError, 'no reply')}`);
      }
    }
    onmoved(++done);
  }
}

/** Delete each entry, a folder with everything in it: the list entries
 * whose file it is or holds first, then the file or folder. A file that is
 * not there counts as removed. `ondeleted` hears how many entries are
 * done. */
export async function deleteEntries(
  entries: DriveEntry[],
  ondeleted: (done: number) => void = () => {}
): Promise<void> {
  const list = parseImages(await restconfGetOrNull<unknown>(IMAGES_ROOT));
  let done = 0;
  for (const entry of entries) {
    const listed = imagesOf(entry, list);
    for (const i of listed) await restconfDelete(getListEntryPath(IMAGE_LIST_ROOT, i.name));
    try {
      if (entry.kind === 'image') await deleteImageFile(entry.path);
      else if (entry.onDisk) await deleteImageFolder(entry.path);
    } catch (fileError) {
      const why = errorText(fileError, 'no reply');
      if (listed.length === 0) throw new Error(`Could not delete ${entry.path}: ${why}`);
      const what = entry.kind === 'image' ? 'its file' : 'the folder';
      throw new Error(`Took ${entry.path} out of the image list, but did not delete ${what}: ${why}`);
    }
    ondeleted(++done);
  }
}
