export interface PopoverRect { readonly left: number; readonly top: number; readonly bottom: number }
export interface PopoverSize { readonly width: number; readonly height: number }
export function anchoredPopoverPosition(anchor: PopoverRect, panel: PopoverSize, viewport: PopoverSize, options?: { readonly side?: "top" | "bottom"; readonly margin?: number; readonly gap?: number }): { left: number; top: number };
export function installDismissiblePopovers(doc?: Document): () => void;
