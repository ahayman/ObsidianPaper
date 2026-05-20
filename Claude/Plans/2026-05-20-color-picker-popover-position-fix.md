# Color picker popover positioning fix

## Problem

Reported by the user: the color picker popover (`ColorWheelPopover`, opened from
the palette icon on the recent-colors strip) lays out incorrectly when the
toolbar is anywhere except the top.

| Toolbar position | Observed behavior                                      |
| ---------------- | ------------------------------------------------------ |
| top              | Fine — popover appears below the wheel button.         |
| left             | Popover ends up under/behind the toolbar.              |
| right            | Popover ends up under/behind the toolbar.              |
| bottom           | Popover appears in the center of the screen.          |

The same `positionRelativeTo` logic is duplicated in `CustomizePopover` (the
pen-settings popover anchored on the current-pen button). Although the user
only described the color picker, the underlying bug surface is identical so
both popovers should be fixed together — otherwise the customize popover will
exhibit the same regressions when the toolbar moves.

`DocumentSettingsPopover` and `PageMenuPopover` already use a robust strategy
(measure, clamp, use the `data-anchor="fixed"` CSS branch) and behave
correctly. We will apply the same approach here, extended so that the *side*
of the anchor we land on follows the toolbar position.

## Root cause

`ColorWheelPopover.positionRelativeTo` and `CustomizePopover.positionRelativeTo`
both rely on directional CSS anchoring:

```ts
case "bottom":
  this.el.setCssProps({
    "--popover-bottom": `${window.innerHeight - anchorRect.top + 8}px`,
    "--popover-left":   `${anchorRect.left + anchorRect.width / 2}px`,
  });
  this.el.dataset.anchor = "bottom";
  break;
```

paired with stylesheet rules like:

```css
.paper-popover[data-anchor="bottom"] {
  bottom: var(--popover-bottom);
  left:   var(--popover-left);
  transform: translateX(-50%);
}
.paper-popover[data-anchor="left"]  { left: var(--popover-left);  top:  var(--popover-top); transform: translateY(-50%); }
.paper-popover[data-anchor="right"] { right: var(--popover-right); top:  var(--popover-top); transform: translateY(-50%); }
```

Three concrete failure modes follow from this:

1. **No clamping.** The center-on-anchor transform places the popover relative
   to the wheel button's center. The wheel button lives inside the recent
   strip which is itself anchored next to the pen button. When the toolbar is
   at "left"/"right", the wheel button sits near the vertical center of the
   strip; combined with `translateY(-50%)`, the popover ends up straddling the
   middle of the screen. Because there is no clamp + no measurement, the
   popover can be drawn partially outside the viewport (top or bottom
   chopped). Visually this reads as "underneath the toolbar" / "in the middle
   of the screen".

2. **Bottom + tall content.** When toolbar is at "bottom", we anchor the
   popover's *bottom edge* near the wheel button and let the content grow
   upward. The popover has `max-height: 80vh`, so on a moderately-sized
   viewport the popover spans most of the screen vertically — this is what
   the user perceives as "in the center of the screen", because the popover's
   visual center is roughly the viewport center even though its bottom is
   correctly aligned with the wheel button.

3. **Centered transform on a side anchor.** For "left"/"right" toolbar
   positions we use `transform: translateY(-50%)` to vertically center the
   popover on the wheel button. There's no clamp, so a popover taller than
   the viewport (or whose center pushes it off-screen) gets cut off without
   ever being repositioned.

The "top" case works in practice because the wheel button is in the upper
portion of the screen, the popover extends downward, and there's enough room
that the popover fits in the viewport.

## Fix

Replace the directional anchoring in `ColorWheelPopover.positionRelativeTo`
and `CustomizePopover.positionRelativeTo` with a measured + clamped strategy
that still respects the toolbar's side:

1. Build the popover, then read its `getBoundingClientRect()` (the element is
   already in the DOM — `DocumentSettingsPopover` does this).
2. Pick a *preferred* side based on the toolbar position:
   - toolbar top → place popover below the anchor;
   - toolbar bottom → place popover above the anchor;
   - toolbar left → place popover to the right of the anchor;
   - toolbar right → place popover to the left of the anchor.
3. If there isn't enough room on the preferred side, flip to the opposite
   side (same pattern as `PageMenuPopover.positionRelativeTo`).
4. For the perpendicular axis, center on the anchor without using
   `transform: translate*(-50%)`. We compute `left = centerX - popoverWidth/2`
   (or `top = centerY - popoverHeight/2`) directly and clamp.
5. Clamp both axes to `[gap, viewport - size - gap]` so the popover always
   fits on screen.
6. Set the `--popover-top` / `--popover-left` CSS variables and
   `dataset.anchor = "fixed"`. This branch of the stylesheet already exists:

   ```css
   .paper-popover[data-anchor="fixed"] {
     top: var(--popover-top);
     left: var(--popover-left);
     transform: none;
   }
   ```

The four directional `.paper-popover[data-anchor="top"|"bottom"|"left"|"right"]`
CSS rules become dead code after this change. We'll remove them in the same
pass since they're only used by the two popovers we're fixing.

## Files touched

- `src/view/toolbar/ColorWheelPopover.ts` — rewrite `positionRelativeTo`.
- `src/view/toolbar/CustomizePopover.ts` — same rewrite (same bug, same code
  shape). Note: `CustomizePopover` accepts an anchor that may be either the
  current-pen button or a preset button; in both cases the anchor is *inside*
  the toolbar, so the "preferred side" rule maps cleanly to toolbar position.
- `styles.css` — remove the now-dead `[data-anchor="top"|"bottom"|"left"|"right"]`
  rules. Keep `[data-anchor="fixed"]`.

Helper extraction: both files end up with identical positioning code. We add
a small free function `positionPopoverNextToToolbar(el, anchor, toolbarPos)`
in a new file `src/view/toolbar/PopoverPositioning.ts` and call it from both
constructors. Keeps the fix surgical and avoids drift between the two
popovers.

## Test plan

Manual (in Obsidian, since this is a layout bug not covered by jest):

1. `yarn build && yarn build:copy`, reload the plugin in Obsidian.
2. For each toolbar position {top, bottom, left, right}:
   - Open a paper note.
   - Click the palette icon on the recent-colors strip → verify the color
     wheel popover appears adjacent to the wheel button on the *open* side
     (i.e., the side away from the toolbar), centered on the button along the
     perpendicular axis, fully inside the viewport.
   - Click the current-pen button → verify the customize popover behaves the
     same way relative to the pen button.
3. Resize the Obsidian window so that the popover wouldn't fit in its
   preferred direction → verify it flips to the opposite side or clamps to
   the viewport edge rather than overflowing.
4. Sanity check: open and close the popover repeatedly while toggling the
   toolbar position from inside `CustomizePopover` to ensure the popover
   reopens at the correct place after each toolbar move.

Automated:

- `yarn test` — no positioning logic is currently unit-tested for these
  popovers; the existing tests cover `ColorStripManager`, `RecentColorManager`,
  `PresetManager`, etc. We won't add jsdom-based positioning tests because
  `getBoundingClientRect` in jsdom always returns zeros, which makes any
  meaningful assertion impossible without heavy mocking.
- `yarn lint` — no changes that should trip lint.
- `yarn build` — type check passes.

## Risks / non-goals

- We're not touching `DocumentSettingsPopover` or `PageMenuPopover`; their
  positioning is already correct, but they don't follow the "side-of-toolbar"
  rule (they always prefer below). That difference is intentional — those
  popovers anchor to fixed UI affordances (gear icon, page menu) rather than
  to a directionally-moving toolbar — so we leave them as-is.
- We're not adding new viewport-size tracking (resize listener). Popovers
  close on Escape / backdrop click, so a stale position after a window resize
  is acceptable.
