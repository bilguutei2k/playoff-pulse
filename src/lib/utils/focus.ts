// Keyboard focus inside a modal dialog. Pure where it can be, so the trap's arithmetic
// is tested without a browser (tests/view-filters.test.ts).

/** Elements a Tab press can land on, before visibility is checked. */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Where Tab (or Shift+Tab) goes among `count` focusable elements when focus is on the
 * `current` one: the next or previous, wrapping at both ends. Focus outside the list
 * (`current` of -1, such as on the dialog itself) goes to the first, or to the last when
 * moving backwards. -1 when there is nothing to focus.
 */
export function nextFocusIndex(count: number, current: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return backwards ? count - 1 : 0;
  return backwards ? (current - 1 + count) % count : (current + 1) % count;
}

/** Whether an element can take focus right now: rendered, and not opted out. */
export function isTabbable(element: HTMLElement): boolean {
  if (element.tabIndex < 0) return false;
  if (element.hasAttribute("inert") || element.closest("[inert]")) return false;
  return element.getClientRects().length > 0;
}

/**
 * Makes everything on the page except `target` and its ancestors inert: not focusable,
 * not clickable and hidden from assistive technology, while a modal is open. Returns the
 * undo. Only elements this call changed are restored, so nested or pre-existing `inert`
 * is left as found.
 */
export function inertOthers(target: HTMLElement): () => void {
  const changed: HTMLElement[] = [];
  let node: HTMLElement | null = target;
  while (node && node !== document.body) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    for (const sibling of Array.from(parent.children)) {
      if (sibling !== node && sibling instanceof HTMLElement && !sibling.inert) {
        sibling.inert = true;
        changed.push(sibling);
      }
    }
    node = parent;
  }
  return () => {
    for (const element of changed) element.inert = false;
  };
}
