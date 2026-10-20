function interactiveElement(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest(
    [
      'input',
      'textarea',
      'select',
      'button',
      'a[href]',
      'summary',
      '[contenteditable]:not([contenteditable="false"])',
      '[role="button"]',
      '[role="link"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[role="radio"]',
      '[role="checkbox"]',
      '[role="switch"]',
      '[role="slider"]',
      '[role="spinbutton"]',
      '[role="combobox"]',
      '[role="listbox"]',
      '[role="textbox"]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', '),
  );
}

export function isInteractiveTarget(target: EventTarget | null): boolean {
  return interactiveElement(target) !== null;
}

/** Сам маркер — кнопка; вложенные и родительские интерактивные элементы сохраняют свои клавиши. */
export function isSuggestionTarget(target: EventTarget | null, marker: HTMLElement): boolean {
  if (!(target instanceof Element) || !marker.contains(target)) return false;
  if (interactiveElement(target) !== marker) return false;
  return !isInteractiveTarget(marker.parentElement);
}

export function isMarkerActivation(event: KeyboardEvent): boolean {
  return (
    !event.defaultPrevented &&
    !event.isComposing &&
    !event.repeat &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    (event.key === 'Enter' || event.key === ' ')
  );
}
