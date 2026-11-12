import { errorText } from '#lib/core/errors.ts';
import { deleteImageFile } from '#lib/core/image-file.ts';
import { getListEntryPath, restconfDelete } from '#lib/core/restconf/client.ts';
import type { CatalogImage } from '#lib/software/images.ts';
import { IMAGE_LIST_ROOT } from '#lib/software/model.ts';

/** Delete the image: its list entry, then its file. A file that is not
 * there, or a top without an image folder, gives a 404, which counts as
 * removed. */
export async function deleteImage(image: Pick<CatalogImage, 'name' | 'file'>): Promise<void> {
  await restconfDelete(getListEntryPath(IMAGE_LIST_ROOT, image.name));
  try {
    await deleteImageFile(image.file);
  } catch (fileError) {
    throw new Error(`Deleted the image, but not its file: ${errorText(fileError, 'no reply')}`);
  }
}
