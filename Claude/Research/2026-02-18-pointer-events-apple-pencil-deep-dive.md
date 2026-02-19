# PointerEvent API for Apple Pencil on iPadOS Safari/WKWebView -- Deep Dive

**Date**: 2026-02-18
**Purpose**: Comprehensive technical reference on every aspect of the PointerEvent API as it relates to Apple Pencil input in Safari/WKWebView, covering pressure, tilt, barrel rotation, coalesced events, hover, predicted events, palm rejection, and Scribble interference.

---

## 1. Pressure

### 1.1 How `pressure` Works with Apple Pencil

The `PointerEvent.pressure` property is a read-only `number` in the range `0.0` to `1.0` representing the normalized force applied by the stylus to the digitizer surface.

**Apple Pencil Hardware:**
- All Apple Pencil generations (1st Gen, 2nd Gen, USB-C, Pro) have pressure sensors with **4,096 discrete levels** of pressure sensitivity.
- WebKit maps these 4,096 hardware levels into the normalized `0.0` to `1.0` range.
- This means the theoretical precision is approximately `1 / 4096 = 0.000244` per step, though in practice the reported floating-point values may have additional rounding.

**Value Behavior by Event Type:**

| Event | `pressure` behavior |
|-------|-------------------|
| `pointerdown` | The pressure at the instant the pencil contacts the screen. Typically a low value (0.01-0.15) because the initial touch is light. **Important**: the very first `pointerdown` may report a very low pressure that ramps up on subsequent `pointermove` events. |
| `pointermove` (drawing) | Full dynamic range `0.0` to `1.0`. This is where you get the most useful pressure data. Values change smoothly as the user varies force. |
| `pointermove` (hover) | Always `0.0`. When the Apple Pencil is hovering above the screen (iPad Pro M2+), pressure is zero since there is no contact. |
| `pointerup` | Typically a low value (the last detected pressure before lift). Can be `0.0` or near-zero. |
| `pointerenter`/`pointerleave` | `0.0` (these fire during hover transitions). |

**Practical Considerations:**

- The pressure curve from WebKit/Safari may feel different from native apps. Native apps access `UITouch.force` (range 0.0 to `UITouch.maximumPossibleForce`, typically ~6.67) and can apply custom curves. Safari normalizes to 0.0-1.0 before exposing it.
- Most users' "comfortable writing pressure" maps to roughly `0.1` to `0.6`. Very few users regularly hit `1.0`.
- You should apply a custom response curve for natural feel. A power function works well:

```typescript
/**
 * Apply a pressure curve to make the feel more natural.
 * @param rawPressure - The raw pressure from PointerEvent (0.0 to 1.0)
 * @param gamma - Curve exponent. < 1.0 = more sensitive at low pressure,
 *                > 1.0 = more sensitive at high pressure.
 *                0.5-0.7 is good for writing.
 */
function applyPressureCurve(rawPressure: number, gamma: number = 0.6): number {
  return Math.pow(rawPressure, gamma);
}

// With minimum/maximum clamping for stroke width
function pressureToStrokeWidth(
  pressure: number,
  minWidth: number = 0.5,
  maxWidth: number = 4.0
): number {
  const curved = applyPressureCurve(pressure);
  return minWidth + curved * (maxWidth - minWidth);
}
```

**Precision Testing Code:**

```typescript
// Diagnostic: log raw pressure values to understand the data
canvas.addEventListener('pointermove', (e: PointerEvent) => {
  if (e.pointerType === 'pen' && e.pressure > 0) {
    console.log(`pressure: ${e.pressure.toFixed(6)}, ` +
                `tiltX: ${e.tiltX}, tiltY: ${e.tiltY}`);
  }
});
```

### 1.2 Special Cases

- **Mouse input**: `pressure` is `0.5` when any mouse button is pressed, `0.0` when no buttons are pressed. This is per the W3C spec.
- **Touch (finger) input**: `pressure` is `0.5` on many implementations (WebKit included) since capacitive touch does not measure force. Some devices with 3D Touch/Force Touch may report variable values, but this is not reliable.
- **Distinguishing pen from touch/mouse**: Always check `event.pointerType === 'pen'` before using pressure for stroke modulation.

---

## 2. Tilt (tiltX, tiltY, altitudeAngle, azimuthAngle)

### 2.1 tiltX and tiltY

These are defined in the W3C Pointer Events specification and represent the tilt of the stylus relative to the screen surface using a planar projection model.

**`tiltX`** (range: -90 to 90 degrees):
- The angle between the Y-Z plane and the plane containing the stylus axis and the Y axis.
- **Positive values** = the pen tip is tilted to the **right** (toward positive X).
- **Negative values** = the pen tip is tilted to the **left**.
- `0` = the pen is not tilted in the X direction (though it may be tilted in Y).

**`tiltY`** (range: -90 to 90 degrees):
- The angle between the X-Z plane and the plane containing the stylus axis and the X axis.
- **Positive values** = the pen tip is tilted **toward the user** (toward positive Y, i.e., toward the bottom of the screen in standard orientation).
- **Negative values** = the pen tip is tilted **away from the user**.
- `0` = the pen is not tilted in the Y direction.

**When both are 0**: The pen is perfectly perpendicular to the screen.

**Apple Pencil Specifics:**
- All Apple Pencil models report accurate tilt via their accelerometer/gyroscope.
- The tilt values update at the same rate as the pointer events (display refresh rate, with finer data available through coalesced events).
- Typical handwriting posture: `tiltX` ~ 20-40 degrees, `tiltY` ~ 30-60 degrees.
- Safari/WebKit on iPad reports integer degree values (not fractional) for `tiltX`/`tiltY`.

### 2.2 altitudeAngle and azimuthAngle

These are the spherical coordinate equivalents of `tiltX`/`tiltY`, added in Pointer Events Level 3. They map directly to Apple's native `UITouch.altitudeAngle` and `UITouch.azimuthAngle(in:)`.

**`altitudeAngle`** (range: 0 to pi/2 radians, i.e., 0 to 90 degrees):
- The angle between the stylus axis and the screen (X-Y) plane.
- `0` = stylus is parallel to the screen (lying flat).
- `pi/2` (1.5708) = stylus is perpendicular to the screen (pointing straight down).
- This is the more intuitive measure of "how upright the pen is."

**`azimuthAngle`** (range: 0 to 2*pi radians, i.e., 0 to 360 degrees):
- The angle of the stylus projected onto the screen plane, measured clockwise from the positive X axis (3 o'clock position).
- `0` = pointing right
- `pi/2` = pointing down (toward user)
- `pi` = pointing left
- `3*pi/2` = pointing up (away from user)

**Safari/WebKit Support:**
- `altitudeAngle` and `azimuthAngle` are supported in **Safari 16.4+** (iPadOS 16.4+, March 2023).
- These properties are available on the PointerEvent object directly (not via Touch Events -- see below).
- Values are reported as floating-point numbers with good precision.

**Relationship Between tiltX/tiltY and altitude/azimuth:**

These are two different coordinate representations of the same physical orientation. You can convert between them:

```typescript
/**
 * Convert tiltX/tiltY (degrees) to altitudeAngle/azimuthAngle (radians)
 */
function tiltToSpherical(tiltXDeg: number, tiltYDeg: number): {
  altitudeAngle: number;
  azimuthAngle: number;
} {
  const tiltXRad = (tiltXDeg * Math.PI) / 180;
  const tiltYRad = (tiltYDeg * Math.PI) / 180;

  // Altitude: angle from screen surface (0 = flat, pi/2 = perpendicular)
  const altitudeAngle = Math.atan(
    1.0 / Math.sqrt(Math.tan(tiltXRad) ** 2 + Math.tan(tiltYRad) ** 2)
  );

  // Azimuth: angle in the screen plane from positive X axis
  let azimuthAngle = Math.atan2(Math.tan(tiltYRad), Math.tan(tiltXRad));
  if (azimuthAngle < 0) {
    azimuthAngle += 2 * Math.PI;
  }

  return { altitudeAngle, azimuthAngle };
}

/**
 * Convert altitudeAngle/azimuthAngle (radians) to tiltX/tiltY (degrees)
 */
function sphericalToTilt(altitudeAngle: number, azimuthAngle: number): {
  tiltX: number;
  tiltY: number;
} {
  const tiltXRad = Math.atan(
    Math.cos(azimuthAngle) / Math.tan(altitudeAngle)
  );
  const tiltYRad = Math.atan(
    Math.sin(azimuthAngle) / Math.tan(altitudeAngle)
  );

  return {
    tiltX: Math.round((tiltXRad * 180) / Math.PI),
    tiltY: Math.round((tiltYRad * 180) / Math.PI),
  };
}
```

**Important**: When `altitudeAngle` is exactly `pi/2` (pen is perfectly perpendicular), `azimuthAngle` becomes undefined (any direction). Handle this edge case.

### 2.3 Touch Events altitudeAngle/azimuthAngle (Legacy)

Before Pointer Events Level 3 added these properties, Apple had proprietary extensions on the Touch Events API:
- `Touch.altitudeAngle` -- same semantics as `PointerEvent.altitudeAngle`
- `Touch.azimuthAngle(in: view)` -- a method (not property) returning azimuth relative to a specific view

**For new development, use the PointerEvent properties exclusively.** The Touch Events versions exist for backward compatibility but Pointer Events are the standardized path forward. On Safari 16.4+, both are available, but Pointer Events are the recommended API.

### 2.4 Using Tilt for Calligraphy/Brush Effects

```typescript
interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
  altitudeAngle: number;
  azimuthAngle: number;
}

/**
 * Calculate an elliptical brush shape based on tilt.
 * When the pen is tilted, the "footprint" on the surface is elliptical,
 * with the major axis aligned to the tilt direction.
 */
function calculateBrushShape(
  point: StrokePoint,
  baseSize: number
): { width: number; height: number; rotation: number } {
  // As altitude decreases (pen tilts more), the brush gets more elliptical
  const tiltFactor = Math.cos(point.altitudeAngle); // 0 = perpendicular, 1 = flat

  const minorAxis = baseSize * point.pressure;
  const majorAxis = minorAxis * (1 + tiltFactor * 2); // Stretch up to 3x when flat

  // Rotation of the ellipse matches the azimuth of the pen
  const rotation = point.azimuthAngle;

  return {
    width: majorAxis,
    height: minorAxis,
    rotation: rotation,
  };
}
```

---

## 3. Barrel Rotation (twist)

### 3.1 W3C Specification

The `twist` property is defined in the W3C Pointer Events specification (Level 2 and Level 3):
- **Type**: `number` (read-only)
- **Range**: `0` to `359` (integer degrees)
- **Default**: `0` for devices that do not report rotation
- **Semantics**: Clockwise rotation of the pointer (e.g., pen stylus) around its own major/longitudinal axis

The spec states: "The clockwise rotation of the transducer (e.g. pen stylus) around its own major axis, in degrees in the range [0,359]."

### 3.2 Apple Pencil Pro Barrel Roll

Apple Pencil Pro (announced June 2024, shipping with iPad Pro M4) introduced a **gyroscope** that enables barrel roll detection. In native iOS:
- Exposed as `UITouch.rollAngle` (added in iPadOS 17.5 / iOS 17.5, beta; finalized in iPadOS 18).
- `rollAngle` is measured in radians.

**WebKit/Safari Mapping:**
- Safari maps `UITouch.rollAngle` to `PointerEvent.twist`.
- The mapping converts radians to degrees and normalizes to the 0-359 range.
- **Safari 17.5+** (iPadOS 17.5+) is when this was first available. More reliable support landed in **Safari 18.0** (iPadOS 18).
- On Apple Pencil 1st Gen, 2nd Gen, and USB-C: `twist` always reports `0`.

### 3.3 Detection and Usage

```typescript
/**
 * Check if barrel rotation is available.
 * The only reliable way is to check if twist changes from 0 during actual use.
 */
class BarrelRotationDetector {
  private _hasBarrelRotation = false;
  private _lastTwist = 0;

  get hasBarrelRotation(): boolean {
    return this._hasBarrelRotation;
  }

  update(event: PointerEvent): void {
    if (event.pointerType === 'pen' && event.twist !== 0) {
      this._hasBarrelRotation = true;
    }
    this._lastTwist = event.twist;
  }
}

// Usage in a drawing context: rotate a calligraphy brush
function applyBarrelRotation(
  baseBrushAngle: number,    // From tilt azimuth, radians
  twistDegrees: number        // From PointerEvent.twist, 0-359
): number {
  const twistRadians = (twistDegrees * Math.PI) / 180;
  return baseBrushAngle + twistRadians;
}
```

### 3.4 Limitations

- **No squeeze gesture on the web**: Apple Pencil Pro's squeeze gesture is handled entirely at the OS level and is **not** exposed through any web API. There is no W3C specification for it. It would require a native Obsidian plugin bridge (Capacitor/native module) to intercept.
- **twist resolution**: The gyroscope in Apple Pencil Pro provides smooth, continuous rotation data. In Safari, the integer degree granularity (0-359) means ~1-degree steps, which is adequate for brush rotation but not ultra-fine control.
- **Feature detection**: There is no API to query "does this pen support barrel rotation" ahead of time. You must observe non-zero `twist` values during actual use.
- **twist on non-Apple platforms**: Some Android/Windows styluses also report `twist`. If you build twist-dependent features, they may work on other platforms too.

---

## 4. Coalesced Events

### 4.1 The Problem Coalesced Events Solve

Apple Pencil hardware samples at **240 Hz**. iPad Pro with ProMotion displays refresh at **120 Hz**. Standard iPads display at **60 Hz**. Browsers dispatch `pointermove` events synchronized with the display refresh rate (via `requestAnimationFrame` cadence).

This means:
- On a 120 Hz ProMotion display: each `pointermove` may represent 2 hardware samples (240/120)
- On a 60 Hz display: each `pointermove` may represent 4 hardware samples (240/60)

Without coalesced events, you lose intermediate points, leading to angular/polygonal strokes instead of smooth curves.

### 4.2 Safari Support Status

| Browser | `getCoalescedEvents()` Support |
|---------|-------------------------------|
| Safari macOS | 17.0+ (September 2023) |
| Safari iOS/iPadOS | 17.0+ (September 2023) |
| Chrome | 58+ (April 2017) |
| Firefox | 59+ (March 2018) |
| Edge | 79+ (January 2020) |

**Requirements:**
- Secure context (HTTPS) required. The `app://` protocol used by Obsidian's WKWebView should qualify, but this must be verified.
- Only returns data for `pointermove` events. Calling it on `pointerdown`/`pointerup` returns an empty array or a single-element array.

### 4.3 What Safari Actually Delivers

Based on testing and community reports:
- On iPadOS 17+ with ProMotion (120Hz), `getCoalescedEvents()` typically returns **1-4 events** per `pointermove`.
- On iPadOS 17+ with 60Hz display, typically **2-6 events** per `pointermove`.
- Each coalesced event has its own `timeStamp`, `clientX`, `clientY`, `pressure`, `tiltX`, `tiltY`, `twist`, `altitudeAngle`, `azimuthAngle` -- the full set of properties.
- The last event in the coalesced array corresponds to the coordinates of the dispatched `pointermove` event itself.

**Effective sampling rate:**
- Without coalesced events: ~60-120 points per second (display refresh rate).
- With coalesced events: up to ~240 points per second (hardware sample rate), depending on the OS scheduler.

### 4.4 Comprehensive Usage

```typescript
interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  twist: number;
  altitudeAngle: number;
  azimuthAngle: number;
  timestamp: number;
}

function extractStrokePoints(event: PointerEvent): StrokePoint[] {
  const points: StrokePoint[] = [];

  // Try coalesced events first
  let rawEvents: PointerEvent[];
  if ('getCoalescedEvents' in event && typeof event.getCoalescedEvents === 'function') {
    rawEvents = event.getCoalescedEvents();
  } else {
    rawEvents = [];
  }

  // Fallback if no coalesced events available or empty
  if (rawEvents.length === 0) {
    rawEvents = [event];
  }

  for (const e of rawEvents) {
    points.push({
      x: e.clientX,
      y: e.clientY,
      pressure: e.pressure,
      tiltX: e.tiltX,
      tiltY: e.tiltY,
      twist: e.twist,
      altitudeAngle: (e as any).altitudeAngle ?? Math.PI / 2,
      azimuthAngle: (e as any).azimuthAngle ?? 0,
      timestamp: e.timeStamp,
    });
  }

  return points;
}

// In your event handler:
canvas.addEventListener('pointermove', (event: PointerEvent) => {
  if (event.pointerType !== 'pen') return;
  event.preventDefault();

  const points = extractStrokePoints(event);
  for (const point of points) {
    currentStroke.addPoint(point);
  }

  requestAnimationFrame(() => renderStroke(currentStroke));
});
```

### 4.5 Workaround for Pre-Safari 17

If you must support iPadOS 16 (Safari 16.x), `getCoalescedEvents()` is not available. Workarounds:

1. **Accept lower resolution**: Simply use the `pointermove` coordinates directly. On 120Hz ProMotion iPads, 120 points/second is still reasonable.
2. **Interpolation**: Apply Catmull-Rom or cubic Bezier interpolation between the points you do receive. This smooths the visual result even with fewer input points.
3. **Touch Events fallback**: The older Touch Events API on iOS dispatches at a higher rate in some cases, but mixing Touch Events and Pointer Events is fragile and not recommended.

```typescript
// Simple Catmull-Rom interpolation fallback
function interpolatePoints(
  p0: StrokePoint, p1: StrokePoint, p2: StrokePoint, p3: StrokePoint,
  numSegments: number = 4
): StrokePoint[] {
  const result: StrokePoint[] = [];
  for (let i = 1; i <= numSegments; i++) {
    const t = i / numSegments;
    const t2 = t * t;
    const t3 = t2 * t;

    const x = 0.5 * (
      (2 * p1.x) +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
    );
    const y = 0.5 * (
      (2 * p1.y) +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    );
    // Linearly interpolate pressure and other properties
    const pressure = p1.pressure + (p2.pressure - p1.pressure) * t;

    result.push({ ...p1, x, y, pressure, timestamp: p1.timestamp + (p2.timestamp - p1.timestamp) * t });
  }
  return result;
}
```

---

## 5. Hover Detection

### 5.1 Hardware Requirements

Apple Pencil hover is supported on:
- **iPad Pro with M2 chip** (2022) or later, with Apple Pencil 2nd Gen or Apple Pencil Pro
- **iPad Pro with M4 chip** (2024) with Apple Pencil Pro
- Hover detection range: up to **12mm** above the screen surface

Older iPads (including iPad Air, iPad mini, and pre-M2 iPad Pro) do **not** support hover.

### 5.2 How Safari Exposes Hover

When Apple Pencil hovers over the screen on a supported device, Safari dispatches standard Pointer Events:

```
pointerenter    (pen enters hover range)
  pointermove   (pen moves while hovering, pressure = 0)
  pointermove   ...
  pointerdown   (pen touches screen, pressure > 0)
    pointermove (drawing, pressure > 0)
    pointerup   (pen lifts)
  pointermove   (back to hovering, pressure = 0)
  pointermove   ...
pointerleave    (pen exits hover range)
```

**Key properties during hover:**
- `pointerType`: `"pen"`
- `pressure`: `0` (always zero during hover)
- `tiltX`/`tiltY`: Active and accurate even during hover
- `altitudeAngle`/`azimuthAngle`: Active during hover
- `twist`: Active during hover (Apple Pencil Pro)
- `clientX`/`clientY`: Accurate position of where the pen tip projects onto the screen

### 5.3 Hover Distance

**Safari does NOT expose hover distance/altitude above the screen surface.** The native iOS API (`UIHoverGestureRecognizer` with `zOffset` in iOS 16.4+) provides this, but WebKit does not forward it to JavaScript.

There is no W3C PointerEvent property for hover distance. The spec does not include a `distance` or `z` property. You can only detect binary hover state (hovering vs. not hovering) by checking `pressure === 0` with `pointerType === 'pen'`.

### 5.4 Implementation Pattern

```typescript
class HoverState {
  isHovering = false;
  hoverX = 0;
  hoverY = 0;
  isDrawing = false;

  private hoverCursorElement: HTMLElement | null = null;

  setup(canvas: HTMLElement): void {
    canvas.addEventListener('pointerenter', this.onPointerEnter.bind(this));
    canvas.addEventListener('pointermove', this.onPointerMove.bind(this));
    canvas.addEventListener('pointerdown', this.onPointerDown.bind(this));
    canvas.addEventListener('pointerup', this.onPointerUp.bind(this));
    canvas.addEventListener('pointerleave', this.onPointerLeave.bind(this));
  }

  private onPointerEnter(e: PointerEvent): void {
    if (e.pointerType !== 'pen') return;
    if (e.pressure === 0) {
      this.isHovering = true;
      this.showHoverCursor(e.clientX, e.clientY);
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (e.pointerType !== 'pen') return;

    if (e.pressure === 0 && !this.isDrawing) {
      // Hovering
      this.isHovering = true;
      this.hoverX = e.clientX;
      this.hoverY = e.clientY;
      this.updateHoverCursor(e.clientX, e.clientY);
    } else if (e.pressure > 0) {
      // Drawing -- handled elsewhere
      this.isHovering = false;
      this.hideHoverCursor();
    }
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.pointerType !== 'pen') return;
    this.isDrawing = true;
    this.isHovering = false;
    this.hideHoverCursor();
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.pointerType !== 'pen') return;
    this.isDrawing = false;
    // Hover events will resume if the device supports it
  }

  private onPointerLeave(e: PointerEvent): void {
    if (e.pointerType !== 'pen') return;
    this.isHovering = false;
    this.hideHoverCursor();
  }

  private showHoverCursor(x: number, y: number): void {
    // Show a preview dot/crosshair at the hover position
  }

  private updateHoverCursor(x: number, y: number): void {
    // Move the hover preview cursor
  }

  private hideHoverCursor(): void {
    // Hide the hover preview
  }
}
```

### 5.5 Graceful Degradation

On devices without hover support, `pointerenter` fires simultaneously with `pointerdown` (the first event is the touch). Your hover detection code should handle this gracefully -- checking `pressure === 0` ensures you do not falsely enter hover mode during a touch.

---

## 6. Predicted Events

### 6.1 Purpose

`getPredictedEvents()` returns an array of `PointerEvent` objects representing the browser's prediction of where the pointer will be in the next few frames. This reduces perceived latency by allowing you to "draw ahead" to where the pen will likely be.

Apple's native PencilKit uses prediction extensively -- it is one of the reasons PencilKit feels so responsive. With `getPredictedEvents()`, web apps can achieve a similar effect.

### 6.2 Safari Support

- **Safari 18.0+** (iPadOS 18+, September 2024)
- Became "Baseline" across all major browsers in December 2024
- Users on iPadOS 17 will NOT have this feature

### 6.3 How It Works

- Returns typically **1-3 predicted events** per `pointermove`
- Each predicted event has full properties: position, pressure, tilt, etc.
- Predictions are based on velocity, acceleration, and trajectory of recent movement
- Predictions are more accurate for smooth, consistent strokes and less accurate during sharp direction changes

### 6.4 Implementation Strategy

The critical principle: **predicted points are temporary.** They must be drawn to a temporary/overlay layer and replaced with actual points on the next frame.

```typescript
class PredictiveRenderer {
  private committedPoints: StrokePoint[] = [];
  private predictedPoints: StrokePoint[] = [];

  // Two-layer approach: committed strokes on main canvas, predictions on overlay
  private mainCtx: CanvasRenderingContext2D;
  private overlayCtx: CanvasRenderingContext2D;

  handlePointerMove(event: PointerEvent): void {
    // 1. Commit coalesced (actual) points
    const coalescedPoints = extractStrokePoints(event);
    for (const point of coalescedPoints) {
      this.committedPoints.push(point);
      this.drawSegmentToMain(point);
    }

    // 2. Clear previous predictions
    this.clearOverlay();

    // 3. Draw new predictions
    if ('getPredictedEvents' in event && typeof event.getPredictedEvents === 'function') {
      const predicted = event.getPredictedEvents();
      this.predictedPoints = predicted.map(e => ({
        x: e.clientX,
        y: e.clientY,
        pressure: e.pressure,
        tiltX: e.tiltX,
        tiltY: e.tiltY,
        twist: e.twist,
        altitudeAngle: (e as any).altitudeAngle ?? Math.PI / 2,
        azimuthAngle: (e as any).azimuthAngle ?? 0,
        timestamp: e.timeStamp,
      }));

      for (const point of this.predictedPoints) {
        this.drawSegmentToOverlay(point);
      }
    }
  }

  handlePointerUp(event: PointerEvent): void {
    // Clear all predictions on stroke end
    this.clearOverlay();
    this.predictedPoints = [];
    // Finalize the committed stroke
    this.finalizeStroke();
  }

  private clearOverlay(): void {
    this.overlayCtx.clearRect(0, 0,
      this.overlayCtx.canvas.width, this.overlayCtx.canvas.height);
  }

  // ... drawing methods omitted for brevity
}
```

### 6.5 Fallback: DIY Prediction

If `getPredictedEvents()` is unavailable (iPadOS 17 and below), you can implement basic prediction:

```typescript
function predictNextPoint(
  points: StrokePoint[],
  framesAhead: number = 2
): StrokePoint | null {
  const n = points.length;
  if (n < 2) return null;

  const p1 = points[n - 2];
  const p2 = points[n - 1];

  // Simple linear extrapolation
  const dt = p2.timestamp - p1.timestamp;
  if (dt <= 0) return null;

  const vx = (p2.x - p1.x) / dt;
  const vy = (p2.y - p1.y) / dt;

  // Assume ~8ms per frame at 120Hz, ~16ms at 60Hz
  const frameTime = 8; // Adjust based on detected refresh rate
  const predictTime = frameTime * framesAhead;

  return {
    ...p2,
    x: p2.x + vx * predictTime,
    y: p2.y + vy * predictTime,
    timestamp: p2.timestamp + predictTime,
  };
}
```

This is a crude linear extrapolation. For better results, use quadratic extrapolation (fitting a parabola through the last 3 points) or a Kalman filter.

---

## 7. Palm Rejection

### 7.1 How iPadOS Handles It

iPadOS has **system-level palm rejection** when Apple Pencil is active. The OS:
1. Identifies the Apple Pencil via Bluetooth pairing
2. When the pencil is detected (hovering or touching), the OS classifies simultaneous touches as "palm" or "intentional finger"
3. Palm touches are suppressed before they reach the app

This means **Safari/WKWebView benefits from OS-level palm rejection automatically.** Palm touches typically do not generate pointer events at all when the pencil is active.

### 7.2 Web-Level Best Practices

Despite OS-level palm rejection, edge cases exist. Here is a robust approach:

```typescript
class InputManager {
  private activePenPointerId: number | null = null;
  private isDrawingWithPen = false;

  setup(canvas: HTMLElement): void {
    // CRITICAL: touch-action: none prevents the browser from
    // interpreting any touch as scroll/zoom on the canvas
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', this.onPointerDown.bind(this));
    canvas.addEventListener('pointermove', this.onPointerMove.bind(this));
    canvas.addEventListener('pointerup', this.onPointerUp.bind(this));
    canvas.addEventListener('pointercancel', this.onPointerCancel.bind(this));
  }

  private onPointerDown(e: PointerEvent): void {
    e.preventDefault(); // Prevent legacy touch/mouse events

    if (e.pointerType === 'pen') {
      this.activePenPointerId = e.pointerId;
      this.isDrawingWithPen = true;
      this.beginStroke(e);
    } else if (e.pointerType === 'touch') {
      // Option A: Ignore all touch while pen is active
      if (this.isDrawingWithPen) {
        return; // Reject touch during pen drawing
      }
      // Option B: Allow finger input when pen is not active
      // (for navigation, gestures, etc.)
      this.handleFingerInput(e);
    }
  }

  private onPointerMove(e: PointerEvent): void {
    e.preventDefault();

    if (e.pointerType === 'pen' && e.pointerId === this.activePenPointerId) {
      this.continueStroke(e);
    } else if (e.pointerType === 'touch' && this.isDrawingWithPen) {
      // Reject: this is likely a palm touch that leaked through
      return;
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.pointerType === 'pen' && e.pointerId === this.activePenPointerId) {
      this.endStroke(e);
      this.activePenPointerId = null;
      this.isDrawingWithPen = false;
    }
  }

  private onPointerCancel(e: PointerEvent): void {
    // System cancelled the pointer -- treat as stroke end
    if (e.pointerId === this.activePenPointerId) {
      this.cancelStroke();
      this.activePenPointerId = null;
      this.isDrawingWithPen = false;
    }
  }

  // ... stroke methods
}
```

### 7.3 touch-action: none -- Detailed Behavior

Setting `touch-action: none` on the drawing canvas element is **essential**. Without it:

1. Safari interprets sustained finger/pen movement as a scroll gesture
2. After ~150ms of movement, Safari fires `pointercancel`
3. After `pointercancel`, no more `pointermove` or `pointerup` events fire
4. Your stroke is abandoned mid-draw

With `touch-action: none`:
- All browser gesture handling is disabled on that element
- No scrolling, panning, zooming, or double-tap-zoom
- All pointer events flow directly to your JavaScript handlers
- You are responsible for implementing any zoom/pan gestures yourself

**Important nuance for Apple Pencil**: `touch-action: none` affects ALL pointer types on the element, including finger touch. If you want finger-based pan/zoom on the canvas while drawing with the pencil, you need a more sophisticated approach:

```typescript
// Advanced: per-pointer-type touch-action handling
// Since CSS touch-action cannot be set per-pointer-type,
// you must handle it in JavaScript:

canvas.addEventListener('pointerdown', (e: PointerEvent) => {
  if (e.pointerType === 'pen') {
    // Always capture pen events for drawing
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    beginDrawing(e);
  } else if (e.pointerType === 'touch') {
    // Allow two-finger gestures for pan/zoom
    // Don't preventDefault() -- let the browser handle it
    // Or handle it yourself for custom gesture behavior
  }
});
```

However, this approach is fragile. The simplest and most reliable pattern is `touch-action: none` with custom gesture handling for everything.

### 7.4 Pointer Capture

`setPointerCapture()` ensures that all subsequent events for a specific `pointerId` are delivered to your element, even if the pointer moves outside the element bounds. This is important for drawing:

```typescript
canvas.addEventListener('pointerdown', (e: PointerEvent) => {
  if (e.pointerType === 'pen') {
    canvas.setPointerCapture(e.pointerId);
    // Now pointermove and pointerup will fire on canvas
    // even if the pen moves outside the canvas bounds
  }
});
```

---

## 8. Scribble Interference

### 8.1 The Problem

iPadOS "Scribble" (introduced in iPadOS 14) allows users to write with Apple Pencil in any text field, and the system converts handwriting to text. This creates a major problem for drawing apps:

1. If your canvas is inside or near a contenteditable element, text input, or text area, iPadOS may activate Scribble
2. Scribble intercepts pencil events before they reach your JavaScript handlers
3. The user's drawing strokes get interpreted as text input instead
4. Scribble can activate even on elements that look like custom canvases if iPadOS heuristics decide the area is "text-like"

### 8.2 How Scribble Activates

Scribble activates when:
- The Apple Pencil begins writing in or near an element that is editable (`contenteditable`, `<input>`, `<textarea>`)
- The pencil pauses briefly (hover) over an editable area before writing
- The system's heuristic classifies the area as text-accepting

Scribble does NOT activate on:
- `<canvas>` elements (these are recognized as drawing surfaces)
- Elements with no text-editing semantics
- Areas where `touch-action: none` is set (this helps but is not guaranteed)

### 8.3 Prevention Strategies

**Strategy 1: Use a `<canvas>` element for drawing**

The most reliable approach. iPadOS recognizes `<canvas>` elements and does not activate Scribble on them.

```html
<canvas id="drawing-canvas" width="1024" height="768"></canvas>
```

**Strategy 2: Disable Scribble on specific elements via the `inputMode` attribute**

Setting `inputMode="none"` on an element tells the system not to show any input method (including Scribble):

```html
<div class="drawing-surface" inputmode="none" tabindex="-1"></div>
```

**Strategy 3: The `data-scribble` attribute**

Apple introduced a way to opt out of Scribble for specific elements:

```html
<!-- Undocumented but observed to work in WebKit -->
<div class="drawing-area" data-apple-pencil-interaction="none"></div>
```

Note: This is not a standardized attribute and may change between iPadOS versions.

**Strategy 4: Ensure no contenteditable ancestors**

If your drawing surface is inside a `contenteditable` container (common in Obsidian's editor), Scribble may activate. Solutions:

```typescript
// When entering drawing mode, ensure the drawing container
// is NOT contenteditable and not inside a contenteditable ancestor
function setupDrawingSurface(container: HTMLElement): void {
  // Remove contenteditable from the drawing container
  container.removeAttribute('contenteditable');
  container.setAttribute('contenteditable', 'false');

  // Use a canvas element for the actual drawing
  const canvas = document.createElement('canvas');
  canvas.style.touchAction = 'none';
  container.appendChild(canvas);
}
```

**Strategy 5: CSS `-webkit-user-modify`**

```css
.drawing-surface {
  -webkit-user-modify: read-only;
  user-modify: read-only;
}
```

This CSS property tells WebKit the element is not editable, which prevents Scribble activation.

### 8.4 Obsidian-Specific Scribble Concerns

Obsidian's note content area uses a CodeMirror 6 editor, which employs `contenteditable` elements. If your drawing canvas is embedded within or near the editor area:

1. **Use an Obsidian `ItemView`** (or custom view) that creates a completely separate view pane for drawing, rather than embedding the canvas inline in the editor.
2. **If inline embedding is required**, wrap the drawing area in a non-editable container and use a `<canvas>` element.
3. **Call `e.stopPropagation()`** on pointer events to prevent them from bubbling up to Obsidian's editor handlers.
4. **Prevent focus** on the drawing surface from triggering Scribble by not making it focusable as a text input:

```typescript
// Prevent the drawing canvas from being treated as a text input
drawingCanvas.setAttribute('role', 'img');
drawingCanvas.setAttribute('aria-label', 'Drawing canvas');
// Do NOT set tabindex or make it focusable in a text-input way
```

### 8.5 Testing Scribble Interference

To verify Scribble is not interfering:
1. Open Settings > Apple Pencil > Scribble (ensure it is ON)
2. Navigate to your drawing canvas
3. Try writing with the Apple Pencil
4. Verify that NO text recognition UI appears
5. Verify that strokes render normally
6. Test near the edges of the canvas, especially near any text fields

---

## 9. Complete Event Handling Reference

Putting it all together, here is a comprehensive event handling setup:

```typescript
interface DrawingConfig {
  /** Minimum iPadOS 17 for coalesced events */
  useCoalescedEvents: boolean;
  /** Minimum iPadOS 18 for predicted events */
  usePredictedEvents: boolean;
  /** Enable hover cursor on supported devices */
  enableHover: boolean;
  /** Reject finger input while pen is active */
  rejectPalmDuringPen: boolean;
}

class ApplePencilHandler {
  private config: DrawingConfig;
  private activePenId: number | null = null;
  private isDrawing = false;
  private supportsCoalesced: boolean;
  private supportsPredicted: boolean;

  constructor(
    private canvas: HTMLCanvasElement,
    config: Partial<DrawingConfig> = {}
  ) {
    this.config = {
      useCoalescedEvents: true,
      usePredictedEvents: true,
      enableHover: true,
      rejectPalmDuringPen: true,
      ...config,
    };

    this.supportsCoalesced = 'getCoalescedEvents' in PointerEvent.prototype;
    this.supportsPredicted = 'getPredictedEvents' in PointerEvent.prototype;

    this.setup();
  }

  private setup(): void {
    // Critical CSS
    this.canvas.style.touchAction = 'none';
    this.canvas.style.setProperty('-webkit-user-modify', 'read-only');
    this.canvas.setAttribute('role', 'img');

    // Event listeners
    this.canvas.addEventListener('pointerdown', this.onDown.bind(this));
    this.canvas.addEventListener('pointermove', this.onMove.bind(this));
    this.canvas.addEventListener('pointerup', this.onUp.bind(this));
    this.canvas.addEventListener('pointercancel', this.onCancel.bind(this));
    this.canvas.addEventListener('pointerenter', this.onEnter.bind(this));
    this.canvas.addEventListener('pointerleave', this.onLeave.bind(this));

    // Prevent context menu on long press
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onDown(e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();

    if (e.pointerType === 'pen') {
      this.canvas.setPointerCapture(e.pointerId);
      this.activePenId = e.pointerId;
      this.isDrawing = true;

      this.emit('strokeStart', {
        x: e.clientX,
        y: e.clientY,
        pressure: e.pressure,
        tiltX: e.tiltX,
        tiltY: e.tiltY,
        twist: e.twist,
        altitudeAngle: (e as any).altitudeAngle,
        azimuthAngle: (e as any).azimuthAngle,
        timestamp: e.timeStamp,
      });
    } else if (e.pointerType === 'touch') {
      if (this.config.rejectPalmDuringPen && this.isDrawing) {
        return; // Reject palm/finger during pen drawing
      }
      this.emit('touchStart', e);
    }
  }

  private onMove(e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();

    if (e.pointerType === 'pen') {
      if (this.isDrawing && e.pointerId === this.activePenId) {
        // Drawing stroke -- use coalesced events
        const points = this.extractPoints(e);
        this.emit('strokeMove', points);

        // Handle predictions
        if (this.config.usePredictedEvents && this.supportsPredicted) {
          const predicted = e.getPredictedEvents().map(pe => this.pointFromEvent(pe));
          this.emit('strokePredict', predicted);
        }
      } else if (e.pressure === 0 && this.config.enableHover) {
        // Hover
        this.emit('hover', {
          x: e.clientX,
          y: e.clientY,
          tiltX: e.tiltX,
          tiltY: e.tiltY,
          twist: e.twist,
          altitudeAngle: (e as any).altitudeAngle,
          azimuthAngle: (e as any).azimuthAngle,
        });
      }
    }
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerType === 'pen' && e.pointerId === this.activePenId) {
      this.canvas.releasePointerCapture(e.pointerId);
      this.isDrawing = false;
      this.activePenId = null;
      this.emit('strokeEnd', this.pointFromEvent(e));
    }
  }

  private onCancel(e: PointerEvent): void {
    if (e.pointerId === this.activePenId) {
      this.isDrawing = false;
      this.activePenId = null;
      this.emit('strokeCancel', null);
    }
  }

  private onEnter(e: PointerEvent): void {
    if (e.pointerType === 'pen' && e.pressure === 0) {
      this.emit('hoverEnter', { x: e.clientX, y: e.clientY });
    }
  }

  private onLeave(e: PointerEvent): void {
    if (e.pointerType === 'pen') {
      this.emit('hoverLeave', null);
    }
  }

  private extractPoints(e: PointerEvent): StrokePoint[] {
    if (this.config.useCoalescedEvents && this.supportsCoalesced) {
      const coalesced = e.getCoalescedEvents();
      if (coalesced.length > 0) {
        return coalesced.map(ce => this.pointFromEvent(ce));
      }
    }
    return [this.pointFromEvent(e)];
  }

  private pointFromEvent(e: PointerEvent): StrokePoint {
    return {
      x: e.clientX,
      y: e.clientY,
      pressure: e.pressure,
      tiltX: e.tiltX,
      tiltY: e.tiltY,
      twist: e.twist,
      altitudeAngle: (e as any).altitudeAngle ?? Math.PI / 2,
      azimuthAngle: (e as any).azimuthAngle ?? 0,
      timestamp: e.timeStamp,
    };
  }

  private emit(event: string, data: any): void {
    // Replace with your event system
    this.canvas.dispatchEvent(new CustomEvent(`pencil:${event}`, { detail: data }));
  }

  destroy(): void {
    // Remove all event listeners (in practice, use AbortController)
  }
}
```

---

## 10. Feature Support Matrix Summary

| Feature | Min Safari | Min iPadOS | Apple Pencil Gen | Notes |
|---------|-----------|-----------|------------------|-------|
| Basic PointerEvents | 13 | 13 | All | `pointerType: "pen"` |
| `pressure` (0-1) | 13 | 13 | All | 4096 levels mapped to float |
| `tiltX` / `tiltY` | 13 | 13 | All | Integer degrees |
| `altitudeAngle` / `azimuthAngle` | 16.4 | 16.4 | All | Float radians |
| `twist` (barrel rotation) | 17.5/18.0 | 17.5/18.0 | Pro only | 0-359 degrees |
| `tangentialPressure` | 13 | 13 | N/A | Always 0 for Apple Pencil |
| `getCoalescedEvents()` | 17.0 | 17 | All | HTTPS required |
| `getPredictedEvents()` | 18.0 | 18 | All | 1-3 predicted points |
| `pointerrawupdate` | N/A | N/A | N/A | **Not supported in Safari** |
| Hover detection | 16.4 | 16.4 | 2nd Gen, Pro | iPad Pro M2+ only |
| Hover distance (z) | N/A | N/A | N/A | **Not exposed in web API** |
| `touch-action: none` | 13 | 13 | N/A | Essential for drawing |
| Squeeze gesture | N/A | N/A | Pro | **Not exposed in web API** |
| `persistentDeviceId` | Unconfirmed | Unconfirmed | N/A | Very new, limited support |

---

## 11. References

- W3C Pointer Events Level 3 Specification: https://w3c.github.io/pointerevents/
- MDN PointerEvent: https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent
- MDN getCoalescedEvents(): https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents
- MDN getPredictedEvents(): https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getPredictedEvents
- MDN touch-action: https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action
- Apple UITouch documentation: https://developer.apple.com/documentation/uikit/uitouch
- Apple UITouch.rollAngle: https://developer.apple.com/documentation/uikit/uitouch/rollangle
- WebKit Feature Status: https://webkit.org/status/
- Can I Use - Pointer Events: https://caniuse.com/pointer
