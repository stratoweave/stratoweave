import { errorText } from '$lib/core/errors';
import { deleteImageFile } from '$lib/core/image-file';
import { getListEntryPath, restconfDelete } from '$lib/core/restconf/client';
import { IMAGE_LIST_ROOT } from '$lib/software/model';

/** Delete the image `name`: its list entry, then its file. A file that is
 * not there, or a top without an image folder, gives a 404, which counts as
 * removed. */
export async function deleteImage(name: string): Promise<void> {
  await restconfDelete(getListEntryPath(IMAGE_LIST_ROOT, name));
  try {
    await deleteImageFile(name);
  } catch (fileError) {
    throw new Error(`Deleted the image, but not its file: ${errorText(fileError, 'no reply')}`);
  }
}
