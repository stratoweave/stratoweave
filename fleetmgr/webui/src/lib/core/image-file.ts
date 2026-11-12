// The StratoWeave image folder over HTTP. The top has the routes only when it
// runs with --software.image-dir; without them every request gets a 404.
// Images can be kept in folders inside it: a path names a file or folder
// there, its folders and its own name joined by '/'.
const IMAGE_FILE_BASE = '/image-file';
const IMAGE_FOLDER_BASE = '/image-folder';
const IMAGE_MOVE = '/image-move';

// The names the server takes for a file or folder: letters, digits, '.',
// '_' and '-', not starting with '.', at most 200 characters. A whole path
// is at most 400.
const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/;
const MAX_PATH = 400;

type Fetch = typeof fetch;

export class ImageFileError extends Error {
  status: number;

  constructor(status: number, body: string) {
    super(`Image file ${status}: ${replyText(body)}`);
    this.status = status;
  }
}

/** The server's error text from its JSON reply. */
function replyText(body: string): string {
  try {
    const error = (JSON.parse(body) as { error?: unknown })?.error;
    if (typeof error === 'string') return error;
  } catch {
    // Not JSON
  }
  return body || 'no reply';
}

function pathUrl(base: string, path: string): string {
  return `${base}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function fileUrl(name: string): string {
  return pathUrl(IMAGE_FILE_BASE, name);
}

/** What keeps the server from taking name as a file or folder name, one
 * part of a path, or '' when nothing does. */
export function nameError(name: string): string {
  if (!name) return 'Required.';
  if (FILE_NAME.test(name)) return '';
  if (name.length > 200) return 'At most 200 characters.';
  if (name.startsWith('.')) return 'Cannot start with a dot.';
  if (name.includes('/')) return 'Cannot have a /.';
  return 'Only letters, digits and . _ - (no spaces).';
}

/** What keeps the server from taking path, or '' when nothing does. */
export function pathError(path: string): string {
  if (path.length > MAX_PATH) return `The path is over ${MAX_PATH} characters.`;
  for (const part of path.split('/')) {
    const error = nameError(part);
    if (error) return part ? `${part}: ${error}` : 'Each folder needs a name.';
  }
  return '';
}

/** What keeps the server from taking file into folder, or '' when nothing
 * does. The name cannot be changed on the way, so the way out is a renamed
 * file. */
export function imageFileError(file: File, folder = ''): string {
  if (!FILE_NAME.test(file.name)) {
    const why =
      file.name.length > 200
        ? 'The name is over 200 characters.'
        : file.name.startsWith('.')
          ? 'The name starts with a dot.'
          : 'The name can have only letters, digits and . _ - (no spaces).';
    return `${why} Rename the file, then add it again.`;
  }
  if (folder && folder.length + 1 + file.name.length > MAX_PATH) {
    return `With its folder the path is over ${MAX_PATH} characters. Rename the file, or upload it into a folder with a shorter path.`;
  }
  if (file.size === 0) return 'The file is empty. Remove it, then add the right one.';
  return '';
}

export interface ImageFileInfo {
  /** Path in the image folder. */
  name: string;
  size: number;
  /** Seconds since the Unix epoch. */
  modified: number;
}

/** What the image folder holds: every file and every folder, at any depth,
 * by path. */
export interface ImageFolderListing {
  files: ImageFileInfo[];
  folders: string[];
}

/** The files and folders in the image folder; null when the server has
 * none. */
export async function listImageFiles(fetchFn: Fetch = fetch): Promise<ImageFolderListing | null> {
  const response = await fetchFn(IMAGE_FILE_BASE);
  if (response.status === 404) return null;
  if (!response.ok) throw new ImageFileError(response.status, await response.text());
  const reply = (await response.json()) as {
    files?: { name?: unknown; size?: unknown; modified?: unknown }[];
    folders?: { name?: unknown }[];
  };
  const files: ImageFileInfo[] = [];
  for (const f of reply.files ?? []) {
    if (typeof f.name === 'string') {
      files.push({
        name: f.name,
        size: typeof f.size === 'number' ? f.size : 0,
        modified: typeof f.modified === 'number' ? f.modified : 0
      });
    }
  }
  const folders = (reply.folders ?? []).map((f) => f.name).filter((n) => typeof n === 'string');
  return { files, folders };
}

/** Whether the server has an image folder to upload into. */
export async function imageFilesOn(fetchFn: Fetch = fetch): Promise<boolean> {
  const response = await fetchFn(IMAGE_FILE_BASE);
  if (response.status === 404) return false;
  if (!response.ok) throw new ImageFileError(response.status, await response.text());
  return true;
}

async function check(response: Response): Promise<void> {
  if (!response.ok) throw new ImageFileError(response.status, await response.text());
}

/** Make the folder path, and the folders on its way. */
export async function makeImageFolder(path: string, fetchFn: Fetch = fetch): Promise<void> {
  await check(await fetchFn(pathUrl(IMAGE_FOLDER_BASE, path), { method: 'PUT' }));
}

/** Remove the folder path with everything in it; a folder that is not
 * there counts as removed. */
export async function deleteImageFolder(path: string, fetchFn: Fetch = fetch): Promise<void> {
  const response = await fetchFn(pathUrl(IMAGE_FOLDER_BASE, path), { method: 'DELETE' });
  if (response.status !== 404) await check(response);
}

/** Move or rename the file or folder `from` to `to`. The server makes the
 * folders on the way and replaces nothing: something at `to` is a 409. */
export async function moveImagePath(from: string, to: string, fetchFn: Fetch = fetch): Promise<void> {
  await check(
    await fetchFn(IMAGE_MOVE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to })
    })
  );
}

/** Send file in one PUT as the image file name, replacing a file of that
 * name. `onSent` gets the bytes sent so far. */
export function uploadImageFile(
  name: string,
  file: File,
  onSent: (sent: number) => void,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    // fetch reports no upload progress.
    const request = new XMLHttpRequest();
    request.open('PUT', fileUrl(name));
    request.upload.onprogress = (event) => onSent(event.loaded);
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new ImageFileError(request.status, request.responseText));
    };
    request.onerror = () => reject(new Error('The upload broke off: the server did not answer.'));
    request.onabort = () => reject(signal.reason);
    signal.addEventListener('abort', () => request.abort(), { once: true });
    request.send(file);
  });
}

/** Remove the image file name; a file that is not there counts as removed. */
export async function deleteImageFile(name: string, fetchFn: Fetch = fetch): Promise<void> {
  const response = await fetchFn(fileUrl(name), { method: 'DELETE' });
  if (!response.ok && response.status !== 404) {
    throw new ImageFileError(response.status, await response.text());
  }
}
