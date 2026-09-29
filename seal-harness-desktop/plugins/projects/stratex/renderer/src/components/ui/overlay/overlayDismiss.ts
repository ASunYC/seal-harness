import { overlayStack, type OverlayStackController } from './overlayStack.js';

export interface OverlayDismissOptions {
  readonly isInside: (target: EventTarget | null) => boolean;
  readonly canDismiss: () => boolean;
  readonly onDismiss: () => void;
  /** Omit only for surfaces that do not participate in the overlay stack. */
  readonly stackEntryId?: string;
  readonly stack?: OverlayStackController;
  readonly pointerTarget?: EventTarget;
}

/** Shared Vue/React outside-press handling. Both endpoints must be outside. */
export function installOverlayDismiss(options: OverlayDismissOptions): () => void {
  const target = options.pointerTarget ?? document;
  const stack = options.stack ?? overlayStack;
  const isTop = (): boolean =>
    options.stackEntryId === undefined || stack.isTop(options.stackEntryId);
  let startedOutside = false;
  let eligibleAtStart = false;

  const onDown = (event: Event): void => {
    startedOutside = !options.isInside(event.target);
    eligibleAtStart = isTop();
  };
  const onUp = (event: Event): void => {
    const dismiss =
      startedOutside &&
      eligibleAtStart &&
      !options.isInside(event.target) &&
      isTop() &&
      options.canDismiss();
    startedOutside = false;
    eligibleAtStart = false;
    if (dismiss) options.onDismiss();
  };
  const onCancel = (): void => {
    startedOutside = false;
    eligibleAtStart = false;
  };
  target.addEventListener('pointerdown', onDown, true);
  target.addEventListener('pointerup', onUp, true);
  target.addEventListener('pointercancel', onCancel, true);
  return () => {
    target.removeEventListener('pointerdown', onDown, true);
    target.removeEventListener('pointerup', onUp, true);
    target.removeEventListener('pointercancel', onCancel, true);
    onCancel();
  };
}
