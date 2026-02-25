# Research: Device-Specific Settings in Obsidian Plugins

**Date:** 2026-02-25

## Summary

Obsidian does **not** have a built-in mechanism for per-device plugin settings. However, there are several API primitives and workarounds that can be combined to implement device-specific configuration within a plugin.

---

## 1. Does Obsidian Have a Built-In Mechanism for Per-Device Settings?

**No.** Obsidian has no official per-device settings API for plugins. The standard plugin storage methods are:

- **`this.loadData()` / `this.saveData(data)`** -- Reads/writes `data.json` in the plugin folder (`.obsidian/plugins/<plugin-id>/data.json`). This file lives inside the vault and **gets synced** across devices (via iCloud, Obsidian Sync, etc.). Not device-specific.

- **`app.loadLocalStorage(key)` / `app.saveLocalStorage(key, data)`** -- Reads/writes to the browser's `localStorage`, scoped to the vault. This is **device-specific** because `localStorage` is per-browser/per-app-instance and does **not** sync. Available since API v1.8.7.

- **`app.secretStorage`** -- Secure storage for tokens and secrets (since v1.11.4). Also device-local and not synced.

The key insight: **`loadLocalStorage`/`saveLocalStorage` is the official device-local storage mechanism**, while `loadData`/`saveData` is the synced/shared storage mechanism.

## 2. Available Device/Platform Identifiers

### `Platform` Module (Public API, since v0.12.2)

The `Platform` export from `"obsidian"` provides platform detection booleans:

```typescript
import { Platform } from "obsidian";

Platform.isDesktop      // UI is in desktop mode
Platform.isMobile       // UI is in mobile mode
Platform.isDesktopApp   // Running electron-based desktop app
Platform.isMobileApp    // Running capacitor-js mobile app
Platform.isIosApp       // Running iOS app
Platform.isAndroidApp   // Running Android app
Platform.isPhone        // Mobile with small screen
Platform.isTablet       // Mobile with large screen (iPad)
Platform.isMacOS        // macOS (or iOS/iPadOS pretending to be)
Platform.isWin          // Windows
Platform.isLinux        // Linux
Platform.isSafari       // Safari browser engine
Platform.resourcePathPrefix  // "file:///" on mobile, "app://<random-id>/" on desktop
```

**Limitation:** These identify platform *type* (e.g., "this is an iPad"), not a specific *device* (e.g., "this is Aaron's iPad Pro"). Two iPads would both return `isIosApp: true, isTablet: true`.

### `app.appId` (Undocumented, but confirmed)

`app.appId` is a **vault identifier** (not a device identifier). It is a unique string assigned when a vault is created on a device. From forum discussion (confirmed by Obsidian team member `liam`):

> "There is a unique ID associated with each vault (`app.appId`), but there's no Obsidian-specific way to identify a particular device."

**Important:** `app.appId` is **not** in the public TypeScript type definitions (`obsidian.d.ts`). It exists at runtime but accessing it requires a type cast: `(this.app as any).appId`. Since it is undocumented, it could change in future versions.

**Behavior:** Each vault on each device gets its own `appId`. If you open the same vault on a Mac and an iPad, they will have different `appId` values. This makes it a reasonable **vault-instance identifier** (effectively device+vault specific).

### `require('os').hostname()` (Node.js, Desktop Only)

On desktop (Electron), you can access the system hostname:

```typescript
const hostname = require('os').hostname(); // e.g., "Aarons-MacBook-Pro"
```

**Limitation:** This only works on desktop (Electron). On mobile (Capacitor), the `os` module is not available. You would need a fallback.

### `Platform.resourcePathPrefix` (Indirect)

On desktop, `Platform.resourcePathPrefix` returns `app://<random-id>/` where the random ID is unique per Obsidian installation. This could theoretically be parsed to extract a device-specific identifier, but it's fragile and not its intended purpose.

## 3. How Other Plugins Handle Device-Specific Configuration

### Pattern A: `loadLocalStorage` for Device-Local Data (Recommended)

The simplest and most officially supported approach. Use `loadLocalStorage`/`saveLocalStorage` for anything that should not sync between devices.

```typescript
// Save device-specific setting
this.app.saveLocalStorage('myPlugin-renderEngine', 'webgl');

// Load device-specific setting
const engine = this.app.loadLocalStorage('myPlugin-renderEngine');
```

**Pros:** Official API, works on all platforms, vault-scoped, inherently device-local.
**Cons:** String-based key-value only (must serialize/deserialize), no structured data, keys should be namespaced to avoid collisions.

### Pattern B: Generate & Store a Device ID (remotely-save approach)

The `remotely-save` plugin generates a random UUID per vault instance and stores it in a local database (migrated from `data.json` to `localStorage`). This gives each vault+device combination a unique identity.

```typescript
// On first load, generate and store a device ID
let deviceId = this.app.loadLocalStorage('myPlugin-deviceId');
if (!deviceId) {
  deviceId = crypto.randomUUID();
  this.app.saveLocalStorage('myPlugin-deviceId', deviceId);
}
```

**Pros:** Truly unique per device+vault, works on all platforms, persistent.
**Cons:** Requires initial generation, ID is meaningless to users (not human-readable).

### Pattern C: Platform-Keyed Settings in `data.json`

Store per-platform overrides within the synced settings file using Platform flags as keys:

```typescript
interface PaperSettings {
  // Shared settings
  defaultColor: string;

  // Per-platform overrides
  platformOverrides?: {
    mobile?: Partial<PaperSettings>;
    desktop?: Partial<PaperSettings>;
  };
}

function getEffectiveSettings(settings: PaperSettings): PaperSettings {
  const overrides = Platform.isMobile
    ? settings.platformOverrides?.mobile
    : settings.platformOverrides?.desktop;
  return { ...settings, ...overrides };
}
```

**Pros:** Settings sync naturally via `data.json`, user can configure platform differences from any device.
**Cons:** Only distinguishes platform type, not individual devices. Two iPads get the same overrides.

### Pattern D: Hybrid Approach (Synced Defaults + Local Overrides)

Combine `saveData` (synced) with `saveLocalStorage` (device-local):

```typescript
// Synced settings (shared across devices)
const sharedSettings = await this.loadData();

// Device-local overrides
const localOverridesJson = this.app.loadLocalStorage('myPlugin-localSettings');
const localOverrides = localOverridesJson ? JSON.parse(localOverridesJson) : {};

// Merge: local overrides take precedence
const effectiveSettings = { ...sharedSettings, ...localOverrides };
```

**Pros:** Most flexible, allows true per-device customization while sharing defaults.
**Cons:** More complex settings UI needed, user needs to understand which settings are local vs. shared.

## 4. Recommended Approach for ObsidianPaper

Given that ObsidianPaper needs device-specific settings (e.g., different render engine on Mac vs. iPad, different palm rejection sensitivity), the best approach is likely **Pattern D (Hybrid)** with elements of **Pattern C**:

### Primary Recommendation

1. **Keep shared settings in `data.json`** via `loadData()`/`saveData()` -- things like default pen color, page background, paper type.

2. **Store device-specific settings in `localStorage`** via `app.saveLocalStorage()`/`app.loadLocalStorage()` -- things like render engine preference, performance tuning, palm rejection sensitivity.

3. **Use `Platform` flags** to set intelligent defaults per platform type (e.g., default to Canvas2D on older iPads, WebGL on desktop).

4. **Optionally generate a device ID** via `crypto.randomUUID()` stored in `localStorage` if you ever need to identify specific devices (e.g., for debugging or sync conflict resolution).

### Implementation Sketch

```typescript
interface SharedSettings {
  defaultColor: string;
  backgroundColor: string;
  paperType: PaperType;
  // ... settings that should be the same everywhere
}

interface DeviceSettings {
  renderEngine: 'canvas2d' | 'webgl';
  palmRejection: boolean;
  palmRejectionSensitivity: number;
  // ... settings that vary by device capability
}

// In plugin onload():
const shared: SharedSettings = await this.loadData();
const deviceJson = this.app.loadLocalStorage('paper-device-settings');
const device: DeviceSettings = deviceJson
  ? JSON.parse(deviceJson)
  : getDefaultDeviceSettings(); // Uses Platform flags for smart defaults

// To save device settings:
this.app.saveLocalStorage('paper-device-settings', JSON.stringify(device));
```

## 5. Key API References (from `obsidian.d.ts`)

```typescript
// App class (lines 406-482 in obsidian.d.ts)
class App {
  loadLocalStorage(key: string): any | null;           // since 1.8.7
  saveLocalStorage(key: string, data: unknown | null): void;  // since 1.8.7
  secretStorage: SecretStorage;                        // since 1.11.4
}

// Plugin class (lines 4813-4826 in obsidian.d.ts)
class Plugin {
  loadData(): Promise<any>;       // Reads data.json (synced)
  saveData(data: any): Promise<void>;  // Writes data.json (synced)
}

// Platform (lines 4606-4678 in obsidian.d.ts)
const Platform: {
  isDesktop: boolean;
  isMobile: boolean;
  isDesktopApp: boolean;
  isMobileApp: boolean;
  isIosApp: boolean;
  isAndroidApp: boolean;
  isPhone: boolean;
  isTablet: boolean;
  isMacOS: boolean;
  isWin: boolean;
  isLinux: boolean;
  isSafari: boolean;
  resourcePathPrefix: string;
};
```

## Sources

- [How to uniquely identify an Obsidian instance (Obsidian Forum)](https://forum.obsidian.md/t/how-to-uniquely-identify-an-obsidian-instance/85740)
- [Read or detect device or workspace (Obsidian Forum)](https://forum.obsidian.md/t/read-or-detect-device-or-workspace/57999)
- [Add ability to override global settings per device (Obsidian Forum)](https://forum.obsidian.md/t/add-ability-to-override-global-settings-per-device/52573)
- [Save settings for plugins enabled separately for mobile/desktop (Obsidian Forum)](https://forum.obsidian.md/t/save-settings-for-which-plugins-are-enabled-for-mobile-and-desktop-separately/36740)
- [Sync settings and selective syncing (Obsidian Help)](https://help.obsidian.md/sync/settings)
- [saveLocalStorage API Reference (Obsidian Docs)](https://docs.obsidian.md/Reference/TypeScript+API/App/saveLocalStorage)
- [Obsidian API type definitions (GitHub)](https://github.com/obsidianmd/obsidian-api)
- [remotely-save plugin (GitHub)](https://github.com/remotely-save/remotely-save) -- uses random vault ID stored in localStorage
- [obsidian-livesync plugin (GitHub)](https://github.com/vrtmrz/obsidian-livesync) -- uses key-value DB for device state
- [Separate settings for multiple mobile devices (Obsidian Forum)](https://forum.obsidian.md/t/separate-settings-for-multiple-mobile-devices/20607)
- [Derive vault ID from vault directory (Obsidian Forum)](https://forum.obsidian.md/t/is-there-any-way-to-derive-the-vault-id-from-the-vault-directory/5573) -- confirms `app.appId` is vault ID
