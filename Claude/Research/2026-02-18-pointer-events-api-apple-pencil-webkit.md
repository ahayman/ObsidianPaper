# Pointer Events API for Stylus / Apple Pencil in WebKit/Safari

**Date**: 2026-02-18
**Purpose**: Comprehensive research on the Pointer Events API capabilities for stylus input, specifically Apple Pencil support in WebKit/Safari as used by Obsidian on iPad.

---

## 1. PointerEvent Properties Overview

The Pointer Events API (Level 2 and Level 3) provides a unified input model for mouse, touch, and pen/stylus devices. Below is a complete listing of properties relevant to stylus input.

### 1.1 Core Identification Properties

| Property | Type | Description |
|----------|------|-------------|
| `pointerId` | `number` | Unique identifier for the pointer. Persists across events in the same gesture. |
| `pointerType` | `string` | Device type: `"mouse"`, `"pen"`, or `"touch"`. Apple Pencil reports as `"pen"`. |
| `isPrimary` | `boolean` | Whether this pointer is the primary pointer of its type. |
| `persistentDeviceId` | `number` | (Level 3) Unique identifier for the physical device across sessions. Very new; limited support. |

### 1.2 Geometric / Contact Properties

| Property | Type | Range | Description |
|----------|------|-------|-------------|
| `width` | `number` | CSS pixels | Width of the contact geometry. For stylus, typically 1. |
| `height` | `number` | CSS pixels | Height of the contact geometry. For stylus, typically 1. |

### 1.3 Pressure & Force Properties

| Property | Type | Range | Description |
|----------|------|-------|-------------|
| `pressure` | `number` | 0.0 to 1.0 | Normalized pressure. 0 = no pressure, 1 = max hardware-detectable pressure. Returns 0.5 for hardware that doesn't support pressure (e.g., mouse buttons down). |
| `tangentialPressure` | `number` | -1.0 to 1.0 | Barrel pressure / cylinder stress. 0 = neutral. This is for devices with a pressure-sensitive barrel control (e.g., some Wacom airbrush pens). |

### 1.4 Tilt & Rotation Properties

| Property | Type | Range | Description |
|----------|------|-------|-------------|
| `tiltX` | `number` | -90 to 90 degrees | Plane angle between Y-Z plane and the plane containing the pointer axis and Y axis. Positive = tilting right. |
| `tiltY` | `number` | -90 to 90 degrees | Plane angle between X-Z plane and the plane containing the pointer axis and X axis. Positive = tilting toward user. |
| `twist` | `number` | 0 to 359 degrees | Clockwise rotation of the pointer (pen) around its own major axis. This is "barrel rotation". |
| `altitudeAngle` | `number` | 0 to pi/2 radians | (Level 3) Angle between the transducer axis and the screen surface. 0 = parallel to screen, pi/2 = perpendicular. |
| `azimuthAngle` | `number` | 0 to 2*pi radians | (Level 3) Angle of the pointer projected onto the screen plane, measured from the X axis toward Y. |

**Note on tilt vs altitude/azimuth**: `tiltX`/`tiltY` and `altitudeAngle`/`azimuthAngle` represent the same physical orientation in two different coordinate systems. The altitude/azimuth model (spherical coordinates) is often more intuitive for drawing applications. Safari/WebKit supports both.

---

## 2. Apple Pencil Specific Support

### 2.1 Apple Pencil Generations

| Feature | Apple Pencil 1st Gen | Apple Pencil 2nd Gen | Apple Pencil Pro |
|---------|---------------------|---------------------|------------------|
| Pressure sensitivity | Yes (4096 levels) | Yes (4096 levels) | Yes (4096 levels) |
| Tilt detection | Yes | Yes | Yes |
| Barrel rotation (hardware) | No | No | Yes (gyroscope) |
| Squeeze gesture | No | No | Yes |
| Haptic feedback | No | No | Yes |
| Hover detection | No | No (iPad Pro M2+: Yes) | Yes |

### 2.2 Properties Exposed via PointerEvents in WebKit

**All Apple Pencil models expose through WebKit:**

- **`pointerType`**: Reports as `"pen"` -- this is how you distinguish Apple Pencil from finger touch
- **`pressure`**: Full pressure range (0.0 to 1.0) mapped from the hardware's 4096 levels. This works reliably on all Apple Pencil models in Safari/WebKit.
- **`tiltX` / `tiltY`**: Fully supported. Apple Pencil reports accurate tilt values. Useful for calligraphy-style stroke width variation.
- **`altitudeAngle` / `azimuthAngle`**: Supported in Safari. These map directly from the native `UITouch` altitude/azimuth properties. Safari 16.4+ provides these.
- **`width` / `height`**: Typically reports 1 for stylus input (as the contact point is a single point, not a touch area).

**Apple Pencil Pro - Barrel Rotation (`twist`):**

- Apple Pencil Pro includes a gyroscope that detects barrel rotation.
- In native iOS (UIKit), this is exposed through `UITouch.rollAngle` (added in iPadOS 17.5 / iOS 17.5).
- **In WebKit/Safari**: The `twist` property on PointerEvent is the web standard equivalent. Safari has added support for mapping `UITouch.rollAngle` to `PointerEvent.twist`. This was introduced around Safari 17.5 / iPadOS 17.5 timeframe. On devices with Apple Pencil Pro, `twist` will report the barrel rotation angle (0-359 degrees).
- **On Apple Pencil 1st and 2nd Gen**: `twist` will always report `0` since the hardware does not have barrel rotation detection.

**Apple Pencil Pro - Squeeze Gesture:**

- The squeeze gesture is a native iOS feature and is **not** exposed through the Pointer Events API in WebKit. There is no web standard for this. It would require a native plugin bridge to access.

**Apple Pencil Hover:**

- On iPad Pro (M2 and later) with Apple Pencil 2nd Gen or Apple Pencil Pro, hover is detected up to 12mm above the screen.
- WebKit dispatches `pointermove` events during hover with `pressure: 0` and appropriate `pointerType: "pen"`.
- The `pointerenter` / `pointerleave` events fire as the pencil enters and exits hover range.
- This allows implementing hover previews (e.g., showing a cursor/dot where the pen will land).

**`tangentialPressure`:**

- Apple Pencil does **not** have a barrel pressure sensor. This property will always return `0` for Apple Pencil input. This property is relevant only for specialized devices like Wacom airbrush styluses.

### 2.3 Pointer Events Lifecycle for Apple Pencil

```
pointerenter  (hover begins - Apple Pencil Pro / iPad Pro M2+)
  pointermove (hover movement, pressure = 0)
    pointerdown   (pencil touches screen)
      pointermove (drawing, pressure > 0, with tilt/twist)
      pointermove ...
    pointerup     (pencil lifts from screen)
  pointermove (hover movement resumes)
pointerleave  (pencil moves out of hover range)
```

On older iPads without hover support, the lifecycle starts directly at `pointerdown`.

---

## 3. Coalesced Events (`getCoalescedEvents()`)

### 3.1 What It Does

Browsers typically fire `pointermove` events at the screen refresh rate (60Hz or 120Hz on ProMotion iPads). However, the stylus hardware may sample at a much higher rate (Apple Pencil samples at 240Hz). Between dispatched `pointermove` events, the browser "coalesces" multiple hardware samples into a single event.

`getCoalescedEvents()` returns an array of `PointerEvent` objects representing ALL the intermediate points that were coalesced. This is critical for drawing applications to capture smooth curves without missing fine detail.

### 3.2 WebKit/Safari Support

- **Safari on macOS**: `getCoalescedEvents()` was added in **Safari 17.0** (September 2023, with macOS Sonoma).
- **Safari on iOS/iPadOS**: Also available from **Safari 17.0** (iOS 17 / iPadOS 17, September 2023).
- **Secure context required**: Must be served over HTTPS (or localhost). Obsidian's local webview should qualify.
- **Status**: This is widely available across all major browsers as of late 2024.

### 3.3 Usage Pattern

```javascript
canvas.addEventListener('pointermove', (event) => {
  // Get all coalesced events for smooth drawing
  const events = event.getCoalescedEvents();

  if (events.length > 0) {
    for (const coalescedEvent of events) {
      // Each coalesced event has full properties:
      // clientX, clientY, pressure, tiltX, tiltY, twist, etc.
      addPointToStroke(
        coalescedEvent.clientX,
        coalescedEvent.clientY,
        coalescedEvent.pressure,
        coalescedEvent.tiltX,
        coalescedEvent.tiltY
      );
    }
  } else {
    // Fallback: use the main event
    addPointToStroke(event.clientX, event.clientY, event.pressure, event.tiltX, event.tiltY);
  }
});
```

### 3.4 Important Notes

- Coalesced events are only available on `pointermove` (and `pointerrawupdate` where supported).
- The coalesced events array may be empty if no coalescing occurred.
- Each coalesced event has a unique `timeStamp` allowing accurate timing.
- The last event in the coalesced array corresponds to the dispatched event's coordinates.
- On iPad with ProMotion (120Hz display), you may get 1-2 coalesced events per frame when drawing at 240Hz pencil sample rate. On a 60Hz display, you may get up to 4.

---

## 4. Predicted Events (`getPredictedEvents()`)

### 4.1 What It Does

`getPredictedEvents()` returns an array of `PointerEvent` objects representing predicted future positions of the pointer. The browser uses the trajectory, velocity, and acceleration of recent pointer movement to extrapolate where the pointer will be in the next few frames.

This is extremely valuable for reducing perceived latency in drawing apps. By drawing to predicted positions, the stroke appears to "keep up" with the physical pen tip.

### 4.2 WebKit/Safari Support

- **Safari**: Added in **Safari 18.0** (September 2024, with macOS Sequoia / iOS 18 / iPadOS 18).
- **Status**: Became Baseline across all major browsers in December 2024.
- **Note**: This is newer than `getCoalescedEvents()`. Users on iPadOS 17 will NOT have this.

### 4.3 Usage Pattern

```javascript
canvas.addEventListener('pointermove', (event) => {
  // Draw the actual stroke with coalesced events
  for (const e of event.getCoalescedEvents()) {
    commitToStroke(e.clientX, e.clientY, e.pressure);
  }

  // Draw predicted points (will be replaced next frame)
  const predicted = event.getPredictedEvents();
  for (const e of predicted) {
    drawPredictedSegment(e.clientX, e.clientY, e.pressure);
  }
});
```

### 4.4 Important Notes

- Predicted events should be treated as **temporary**. They must be discarded and replaced with actual coalesced events on the next `pointermove`.
- Typically 1-3 predicted events are returned.
- Predicted events carry full pointer properties including pressure and tilt.
- The prediction quality depends on the browser's algorithm; it works best for smooth, consistent strokes and less well for abrupt direction changes.
- **Fallback strategy**: If `getPredictedEvents` is unavailable, you can implement your own simple prediction using the last 2-3 points to extrapolate.

---

## 5. `touch-action` CSS Property

### 5.1 Purpose

The `touch-action` CSS property controls how touch/pointer gestures are handled by the browser. For a drawing canvas, you need to prevent the browser from interpreting pen/finger input as scrolling, panning, or zooming.

### 5.2 Recommended Configuration for Drawing

```css
.drawing-canvas {
  touch-action: none;
}
```

This completely disables all browser gesture handling on the element:
- No panning/scrolling
- No pinch-to-zoom
- No double-tap-to-zoom
- All pointer events go directly to your JavaScript handlers

### 5.3 Available Values

| Value | Effect |
|-------|--------|
| `auto` | Browser handles all gestures (default) |
| `none` | Disable all browser gesture handling |
| `pan-x` | Allow horizontal panning only |
| `pan-y` | Allow vertical panning only |
| `manipulation` | Allow pan + pinch-zoom, but disable double-tap-to-zoom |
| `pinch-zoom` | Allow pinch-to-zoom only |

### 5.4 WebKit/Safari Support

- `touch-action` is **fully supported** in Safari since **Safari 13** (iOS 13 / macOS Catalina, 2019).
- All values (`none`, `pan-x`, `pan-y`, `manipulation`, `pinch-zoom`) are supported.
- `pan-left`, `pan-right`, `pan-up`, `pan-down` directional variants have more limited support.

### 5.5 Practical Considerations

- Apply `touch-action: none` to the drawing canvas element, **not** to the entire page.
- Consider `touch-action: manipulation` for elements where you want scrolling/panning but not double-tap-zoom (e.g., a scrollable toolbar above the canvas).
- The property is inherited, so setting it on a parent affects children unless overridden.
- **Critical**: Without `touch-action: none`, Safari may fire `pointercancel` events when it decides a gesture is a scroll/zoom, which will abort your drawing operation mid-stroke.
- **Accessibility note**: `touch-action: none` prevents pinch-to-zoom. Consider providing alternative zoom controls within the UI.

---

## 6. Known Limitations and Gotchas in WebKit/Safari on iPad

### 6.1 `pointercancel` and Gesture Conflicts

**This is the #1 issue for drawing apps in Safari/WebKit.**

- If `touch-action` is not properly set to `none` on the drawing surface, Safari will fire `pointercancel` after detecting a gesture (typically after ~150ms of movement or when the system decides the touch is a scroll/zoom).
- After `pointercancel`, no further `pointermove` or `pointerup` events are dispatched for that pointer. Your stroke is abandoned mid-draw.
- **Fix**: Always set `touch-action: none` on the drawing canvas. Also call `event.preventDefault()` on `pointerdown`.

### 6.2 `pointerrawupdate` Event Not Supported

- The `pointerrawupdate` event (which fires at the hardware sample rate without coalescing) is **not supported in Safari/WebKit** as of early 2026.
- This event is supported in Chromium-based browsers.
- **Workaround**: Use `getCoalescedEvents()` on `pointermove` instead. This provides the same data, just batched per frame rather than per sample.

### 6.3 Secure Context Requirement

- `getCoalescedEvents()` requires a secure context (HTTPS).
- Obsidian's internal webview uses `app://` protocol which should satisfy this requirement, but this needs to be verified during development.
- If running in a development context, `localhost` also qualifies as a secure context.

### 6.4 Palm Rejection

- iPadOS has built-in palm rejection when Apple Pencil is active. This means that when the system detects an Apple Pencil is in use, it automatically filters out unintentional touch input from the palm resting on the screen.
- In practice, once a `pointerdown` with `pointerType: "pen"` is active, simultaneous `pointerType: "touch"` events are typically suppressed by the OS.
- You should still filter by `pointerType` in your event handlers to be safe.

### 6.5 Coordinate Precision and DPI

- On Retina iPads, `clientX`/`clientY` are in CSS pixels (logical pixels), not device pixels.
- For a drawing canvas, you need to account for `window.devicePixelRatio` when mapping pointer coordinates to canvas pixels.
- iPad Pro typically has a `devicePixelRatio` of 2.
- Coalesced events provide sub-pixel precision, so use floating-point coordinates throughout your stroke pipeline.

### 6.6 ProMotion (120Hz) Display Considerations

- iPad Pro with ProMotion displays refresh at 120Hz (vs 60Hz for standard iPads).
- Pointer events are dispatched at the display refresh rate.
- With Apple Pencil sampling at 240Hz, you get ~2 coalesced events per `pointermove` on ProMotion, vs ~4 on 60Hz displays.
- Your rendering loop should be tied to `requestAnimationFrame` which will run at the display's refresh rate.

### 6.7 Safari-Specific Pressure Curve

- Safari/WebKit maps the raw Apple Pencil pressure to the 0-1 range, but the mapping curve may differ slightly from native apps.
- Native iOS apps have access to `UITouch.force` and `UITouch.maximumPossibleForce`, allowing custom force curves.
- In the web, you get the normalized `pressure` value. You may want to apply your own pressure curve (e.g., power function) to make the feel more natural.

### 6.8 No Multi-Touch Disambiguation with Stylus

- While iPadOS handles palm rejection well, if you want to support two-finger gestures (e.g., two-finger tap to undo) while drawing with the pencil, you need careful event handling.
- The approach: track active `pointerId` values and separate pen input from touch input in your event handlers.

### 6.9 Obsidian-Specific Considerations

- Obsidian on iPad uses a WKWebView (WebKit) to render the UI.
- The plugin runs inside this webview with access to standard Web APIs.
- Obsidian may have its own touch/gesture handlers on parent elements. You may need to stop event propagation to prevent Obsidian's own gesture handling from interfering.
- Test that `touch-action: none` on your canvas element is sufficient, or if you also need `event.stopPropagation()` on pointer events.
- The `app://` URL scheme used by Obsidian's webview should satisfy secure context requirements for `getCoalescedEvents()`.

### 6.10 Safari Does Not Support `pointerlock`

- If you were considering using Pointer Lock API for any reason, note that Safari does not support it on iOS/iPadOS.

### 6.11 Event Ordering and Compatibility Events

- When pointer events fire, Safari also fires legacy touch events (`touchstart`, `touchmove`, `touchend`) and mouse events unless `preventDefault()` is called on the pointer events.
- Always call `event.preventDefault()` on `pointerdown` to prevent duplicate touch/mouse events.
- Do NOT rely on both pointer and touch events -- pick one model (pointer events is the correct choice for stylus support).

---

## 7. Summary: Feature Support Matrix for Safari/WebKit on iPad

| Feature | Safari Version | iPadOS Version | Status |
|---------|---------------|----------------|--------|
| Basic Pointer Events (pointerdown/move/up) | 13+ | 13+ | Fully supported |
| `pointerType: "pen"` | 13+ | 13+ | Fully supported |
| `pressure` | 13+ | 13+ | Fully supported |
| `tiltX` / `tiltY` | 13+ | 13+ | Fully supported |
| `altitudeAngle` / `azimuthAngle` | 16.4+ | 16.4+ | Supported |
| `twist` (barrel rotation) | 17.5+ | 17.5+ | Apple Pencil Pro only |
| `tangentialPressure` | 13+ | 13+ | Always 0 (Apple Pencil has no barrel pressure) |
| `width` / `height` | 13+ | 13+ | Reports 1 for stylus |
| `getCoalescedEvents()` | 17.0+ | 17+ | Supported (HTTPS required) |
| `getPredictedEvents()` | 18.0+ | 18+ | Supported |
| `pointerrawupdate` event | Not supported | Not supported | Use coalesced events instead |
| `touch-action: none` CSS | 13+ | 13+ | Fully supported |
| Hover detection (pen) | 16.4+ | 16.4+ | iPad Pro M2+ with Pencil 2/Pro |
| `persistentDeviceId` | Not confirmed | Not confirmed | Very new, limited support |

---

## 8. Recommended Minimum Target

For an Obsidian plugin targeting Apple Pencil drawing:

- **Minimum iPadOS**: 17.0 (for `getCoalescedEvents()` -- essential for smooth drawing)
- **Ideal iPadOS**: 18.0+ (adds `getPredictedEvents()` for reduced perceived latency)
- **Obsidian minimum**: Check Obsidian's own minimum iPadOS requirement, which as of late 2025 requires iPadOS 16+.

### Feature Detection Pattern

```javascript
// Check for coalesced events support
function supportsCoalescedEvents(): boolean {
  return 'getCoalescedEvents' in PointerEvent.prototype;
}

// Check for predicted events support
function supportsPredictedEvents(): boolean {
  return 'getPredictedEvents' in PointerEvent.prototype;
}

// Check if the current input is Apple Pencil
function isApplePencil(event: PointerEvent): boolean {
  return event.pointerType === 'pen';
}

// Check for hover support (indirectly)
function setupHoverDetection(element: HTMLElement): void {
  element.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'pen' && e.pressure === 0) {
      // Pen is hovering (iPad Pro M2+ with Apple Pencil 2/Pro)
    }
  });
}
```

---

## 9. References

- **MDN - PointerEvent**: https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent
- **MDN - getCoalescedEvents()**: https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents
- **MDN - getPredictedEvents()**: https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getPredictedEvents
- **MDN - touch-action CSS**: https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action
- **W3C Pointer Events Level 3 Spec**: https://w3c.github.io/pointerevents/
- **Can I Use - Pointer Events**: https://caniuse.com/pointer
- **WebKit Feature Status**: https://webkit.org/status/
- **Apple Developer - UITouch**: https://developer.apple.com/documentation/uikit/uitouch (native reference for comparison)
