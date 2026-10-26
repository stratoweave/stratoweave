// What a write did, for the page it goes on to: "Added 3 images." on the
// list an add returns to. It is shown once; a reload drops it.
let pending = '';

export function leaveNotice(text: string): void {
  pending = text;
}

export function takeNotice(): string {
  const text = pending;
  pending = '';
  return text;
}
