import { tick } from 'svelte';

/** After a refused save: focus the first field in `root` marked invalid, so
 * that the keyboard lands on it and a screen reader reads its error. A
 * control that is the way out of an error with no field of its own, such as
 * a row's Remove, carries data-error-focus. */
export async function focusFirstError(root: HTMLElement | null): Promise<void> {
  await tick();
  root?.querySelector<HTMLElement>('[aria-invalid="true"], [data-error-focus]')?.focus();
}
