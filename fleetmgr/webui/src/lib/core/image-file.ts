// The StratoWeave image folder over HTTP. The top has the routes only when it
// runs with --software.image-dir; without them every request gets a 404.
const IMAGE_FILE_BASE = '/image-file';

// The names the server takes: letters, digits, '.', '_' and '-', not
// starting with '.', at most 200 characters.
const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/;

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

function fileUrl(name: string): string {
  return `${IMAGE_FILE_BASE}/${encodeURIComponent(name)}`;
}

/** What keeps the server from taking file, or '' when nothing does. The
 * name cannot be changed on the way, so the way out is a renamed file. */
export function imageFileError(file: File): string {
  if (!FILE_NAME.test(file.name)) {
    const why =
      file.name.length > 200
        ? 'The name is over 200 characters.'
        : file.name.startsWith('.')
          ? 'The name starts with a dot.'
          : 'The name can have only letters, digits and . _ - (no spaces).';
    return `${why} Rename the file, then add it again.`;
  }
  if (file.size === 0) return 'The file is empty. Remove it, then add the right one.';
  return '';
}

/** Whether the server has an image folder to upload into. */
export async function imageFilesOn(fetchFn: Fetch = fetch): Promise<boolean> {
  const response = await fetchFn(IMAGE_FILE_BASE);
  if (response.status === 404) return false;
  if (!response.ok) throw new ImageFileError(response.status, await response.text());
  return true;
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
