/** Tiny DOM helpers shared by the UI modules. */

export const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

/** Create an element, assign properties and append children. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}
