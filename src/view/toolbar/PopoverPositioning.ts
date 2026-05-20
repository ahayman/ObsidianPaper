import type { ToolbarPosition } from "./ToolbarTypes";

const GAP = 8;

/**
 * Position a popover next to an anchor that lives inside the toolbar.
 *
 * The popover lands on the side *away* from the toolbar (top → below,
 * bottom → above, left → right, right → left), flipped to the opposite side
 * if there isn't room. On the perpendicular axis it centers on the anchor and
 * clamps so the popover always fits inside the viewport.
 *
 * The element must already be in the DOM (so its size is measurable) and
 * styled with `position: fixed`. We set `--popover-top` / `--popover-left`
 * and `data-anchor="fixed"` — see the matching `.paper-popover[data-anchor="fixed"]`
 * rule in styles.css.
 */
export function positionPopoverNextToToolbar(
  el: HTMLElement,
  anchor: HTMLElement,
  toolbarPosition: ToolbarPosition,
): void {
  const anchorRect = anchor.getBoundingClientRect();
  const popoverRect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top: number;
  let left: number;

  if (toolbarPosition === "top" || toolbarPosition === "bottom") {
    // Vertical placement: prefer the side opposite the toolbar; flip if no room.
    const preferBelow = toolbarPosition === "top";
    const spaceBelow = vh - anchorRect.bottom - GAP;
    const spaceAbove = anchorRect.top - GAP;
    const placeBelow =
      preferBelow ? spaceBelow >= popoverRect.height || spaceBelow >= spaceAbove
                  : !(spaceAbove >= popoverRect.height || spaceAbove >= spaceBelow);

    top = placeBelow
      ? anchorRect.bottom + GAP
      : anchorRect.top - GAP - popoverRect.height;

    // Horizontal: center on anchor, clamp.
    const centerX = anchorRect.left + anchorRect.width / 2;
    left = centerX - popoverRect.width / 2;
  } else {
    // Horizontal placement: prefer the side opposite the toolbar; flip if no room.
    const preferRight = toolbarPosition === "left";
    const spaceRight = vw - anchorRect.right - GAP;
    const spaceLeft = anchorRect.left - GAP;
    const placeRight =
      preferRight ? spaceRight >= popoverRect.width || spaceRight >= spaceLeft
                  : !(spaceLeft >= popoverRect.width || spaceLeft >= spaceRight);

    left = placeRight
      ? anchorRect.right + GAP
      : anchorRect.left - GAP - popoverRect.width;

    // Vertical: center on anchor, clamp.
    const centerY = anchorRect.top + anchorRect.height / 2;
    top = centerY - popoverRect.height / 2;
  }

  top = Math.max(GAP, Math.min(top, vh - popoverRect.height - GAP));
  left = Math.max(GAP, Math.min(left, vw - popoverRect.width - GAP));

  el.setCssProps({
    "--popover-top": `${top}px`,
    "--popover-left": `${left}px`,
  });
  el.dataset.anchor = "fixed";
}
