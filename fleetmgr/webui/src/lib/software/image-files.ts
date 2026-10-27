import { goto } from '$app/navigation';

// Image files dropped or chosen on the image list, on their way to the add
// page: a File cannot travel in a URL.
let pending: File[] = [];

/** Open the add page with one row per file. */
export async function addImageFiles(files: File[]): Promise<void> {
  pending = files;
  try {
    await goto('/images/new');
  } finally {
    // Taken by the add page, unless the navigation was cut short.
    if (pending === files) pending = [];
  }
}

/** The files handed over, once; none after a reload. */
export function takeImageFiles(): File[] {
  const files = pending;
  pending = [];
  return files;
}
