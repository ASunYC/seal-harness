const VIEWPORT_MARGIN = 12
const TRIGGER_GAP = 8

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

/** Position a composer popover above its trigger while aligning it to the composer card. */
export function connectorPopoverPosition({ trigger, composer, popover, viewport }) {
  const preferredLeft = composer.width > 0 ? composer.left : trigger.right - popover.width
  return {
    left: clamp(preferredLeft, VIEWPORT_MARGIN, viewport.width - popover.width - VIEWPORT_MARGIN),
    top: clamp(trigger.top - TRIGGER_GAP - popover.height, VIEWPORT_MARGIN, viewport.height - popover.height - VIEWPORT_MARGIN),
  }
}
