# Apple Pencil Pro Barrel Rotation in Web/Electron Apps

## Summary

Apple Pencil Pro barrel rotation data is **NOT accessible** through web APIs (PointerEvent, Touch Events) in Safari, WKWebView, or Obsidian on iPadOS. The data is only available through Apple's native UIKit API.

## Findings

### Native API (UITouch.rollAngle)
- Apple introduced `UITouch.rollAngle` in iPadOS 17.5 (WWDC24, June 2024)
- Returns the barrel rotation angle in radians for Apple Pencil Pro
- Only available through native UIKit touch handling
- Works in native Swift/Objective-C apps

### Web PointerEvent API
- `PointerEvent.twist` is the W3C standard property for barrel rotation (0-359 degrees)
- **WebKit/Safari does NOT map `UITouch.rollAngle` to `PointerEvent.twist`**
- Verified empirically: `e.twist` is always `0` for Apple Pencil Pro on iPadOS Safari
- Tested with 5,408 stroke points — all had twist = 0

### azimuthAngle
- `PointerEvent.azimuthAngle` tracks the pen's tilt direction on the screen surface
- It does NOT carry barrel rotation data
- Verified empirically: routing azimuthAngle into twist produced no visible nib variation

### Obsidian on iPadOS
- Obsidian uses Capacitor (WKWebView) on iPadOS, not Electron
- WKWebView receives the same PointerEvents as Safari — no access to `rollAngle`
- No Obsidian plugin API bridges native touch data into the web layer
- No known workaround exists

### WebKit Bug Tracker
- There is awareness in the WebKit community that `rollAngle` should map to `PointerEvent.twist`
- As of February 2026, this has not been implemented

## Implications for ObsidianPaper

1. **Barrel rotation feature is non-functional** in web apps until WebKit implements the mapping
2. The per-preset `useBarrelRotation` setting infrastructure is in place and correct
3. The rendering pipeline correctly handles twist data when present (verified via unit tests with synthetic twist values)
4. When/if WebKit adds `rollAngle → twist` mapping, the feature will work automatically with no code changes

## Recommendation

Keep the `useBarrelRotation` per-preset setting and rendering pipeline intact. The feature is ready to activate once WebKit exposes the data. Default the setting to `false` so users don't see a non-functional toggle prominently.
