# NativeMason

<p align="center">
  <img src="assets/app-logos/08-vision-acrylic.svg" alt="NativeMason Vision Acrylic logo" width="180" />
</p>

<h1 align="center">NativeMason</h1>
<p align="center">React Native layout inspection and Android verification for AI coding agents</p>

The repository uses the **Vision Acrylic** mark as its sole logo. Its source SVG is [assets/app-logos/08-vision-acrylic.svg](assets/app-logos/08-vision-acrylic.svg).

NativeMason gives an MCP coding agent a measured React Native layout loop: inspect an Expo web mirror, test React Native style props in Chromium, preview or apply a source edit, and verify the committed result on Android.

The web mirror is a trial environment. A source write remains **native verification pending** until matching Android source revisions and layout constraints pass. NativeMason does not call a model API or interpret design images.

NativeMason is an early development release. The public repository is [gauravsaini/nativemason](https://github.com/gauravsaini/nativemason). The workspace packages are not yet published to npm; install them into another app using the local tarball workflow below.

## Current scope and roadmap

The current workflow uses explicit `LayoutView`, `LayoutText`, and `LayoutPressable` instrumentation, JSON constraints, Chromium trials, restricted static-style source edits, and Android development-runtime verification. It supports a single active trial and one source file per commit. Browser diagnostics are evidence for trial review; Android measurements remain the acceptance evidence.

NativeMason is not yet a general-purpose production release. The next phases are:

| Priority | Planned work |
| --- | --- |
| **P1** | Expand style editing to arrays, conditional styles, imported styles with blast-radius previews, theme tokens, and NativeWind; add atomic multi-element and multi-file transactions with `revert_commit`; add zero-touch instrumentation through Metro/Babel transforms; add iOS simulator verification over the existing WebSocket protocol and officially support Android emulators. |
| **P2** | Add ranked `suggest_fix` candidates for alignment and gap failures; infer constraints from known-good snapshots and provide default touch-target, clipping, safe-area, and overlap rules; add native `textFits` checks and device font-scale runs; add scenario scripts and profile-matrix reports. |
| **P3** | Improve MCP structured results, workflow prompts, and element search; add `npx nativemason init` for Babel and MCP configuration; publish npm packages with a license, package allowlists, and CI. |

The current integration limits are described in the [compatibility matrix](docs/compatibility.md). Roadmap items are planned work, not capabilities of this release.

## Setup and checks

Use Node 24 and yarn 10.28.2. From the repository root:

```sh
yarn install --frozen-lockfile
yarn exec playwright install chromium
yarn build
yarn lint
yarn typecheck
yarn test
yarn test:integration
```

Build before starting the fixture or MCP server. Integration tests launch an isolated Expo web fixture and real Chromium, exercise the MCP workflow, and restore their temporary source copy. Generated screenshots, source diffs, measurements, and timings go under ignored `artifacts/`.

Start the example web app:

```sh
yarn --filter @nativemason/expo-fixture web
```

Its default route is `http://localhost:8081/?scenario=broken-footer`. The footer deliberately starts with vertically stacked buttons. See the [fixture source](examples/expo-fixture/App.tsx) and [JSON constraints](packages/contracts/fixtures/footer.json).

## Connect an AI coding agent

NativeMason is an MCP tool server. Your coding agent decides what to inspect and which changes to try. It needs this checkout, the app source, a running Expo web build, and an instrumented Android development build. Prepare the same named screen and app state on web and Android before each session.

After building this checkout, add a stdio server to your MCP client's configuration. The configuration location depends on the client; a common JSON format is:

```json
{
  "mcpServers": {
    "nativemason": {
      "command": "node",
      "args": ["/absolute/path/to/rn-layout-bridge/packages/bridge/dist/cli.js"],
      "cwd": "/absolute/path/to/rn-layout-bridge"
    }
  }
}
```

Replace both paths with your checkout's absolute path and restart the client. Confirm it discovers the eight tools below. Give the agent the app project root, development web URL, scenario ID, device profile, and JSON constraints. For example:

> Inspect the checkout screen using NativeMason. Load the checkout constraints, show failing measurements and an overlay, try an allowed React Native style patch, and preview the diff. Apply the patch and verify the matching scenario on the connected Android development build. Report source hashes, constraint results, and any verification failure.

The agent calls `open_session`, `load_wireframe_spec`, `inspect_ui_spatial_graph`, `simulate_layout_mutation`, `commit_rn_ast_patch` in preview and apply modes, and `verify_native_layout`. Close the session when finished. MCP opens its own Chromium context, so a route must reproduce the intended state independently. Use a test setup or a development-only scenario route, and inspect again after navigation or remounting.

For Android, pass `nativeUrl` and `nativeToken` to `LayoutProvider`, and use the same token and port in `open_session`. Run `adb -s <device-serial> reverse tcp:19482 tcp:19482`; the app can then connect to `ws://127.0.0.1:19482`. Use a development bundle containing instrumentation. A release or preview APK does not collect layout metadata. Forward the relevant ports if Metro or MCP runs on another host.

## Instrument an Expo screen

The packages are not published to npm. A separate Expo app can install all three locally built tarballs; see [installation into a separate project](docs/local-packages.md) for the exact commands and peer-version requirements. Check the [compatibility matrix](docs/compatibility.md) and validate the dependency versions used by your app.

Use the runtime components for the elements an agent should measure. Every `layoutId` must be unique within the screen. `rootId` identifies the mounted, full app-root `LayoutView`; the runtime does not infer the root from registration order.

```tsx
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  LayoutProvider, LayoutView, LayoutText, LayoutPressable,
} from '@nativemason/runtime';

export function Screen() {
  return (
    <SafeAreaProvider>
      <LayoutProvider
        rootId="screen"
        scenarioId="login"
        nativeUrl={process.env.EXPO_PUBLIC_LAYOUT_NATIVE_URL}
        nativeToken={process.env.EXPO_PUBLIC_LAYOUT_NATIVE_TOKEN}
      >
        <LayoutView layoutId="screen" style={{ flex: 1 }}>
          <LayoutPressable layoutId="submit" style={{ height: 48 }}>
            <LayoutText layoutId="submit-label">Submit</LayoutText>
          </LayoutPressable>
        </LayoutView>
      </LayoutProvider>
    </SafeAreaProvider>
  );
}
```

Install the runtime and Babel integration in the app, then add the development source-metadata plugin to the consuming app's Babel configuration. Keep any required last plugin, such as `react-native-worklets/plugin`, last:

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [[require.resolve('nativemason/babel'), {
      projectRoot: __dirname,
    }]],
  };
};
```

Metadata records the original file hash and JSX range, without reading React Fiber internals. Production builds disable collection, runtime networking, trial behavior, and metadata injection. See the [example configuration](examples/expo-fixture/babel.config.cjs).

## MCP workflow

Launch the stdio server from the repository root using either command:

```sh
node packages/bridge/dist/cli.js
# Equivalent workspace executable:
yarn exec nativemason
```

Configure an MCP client to launch `node` with the absolute path to `packages/bridge/dist/cli.js`. The server speaks MCP on stdin/stdout; it is not an HTTP server.

| Tool | Purpose |
| --- | --- |
| `open_session` | Supply an absolute app project root, web URL, scenario ID, and device profile. Returns a session ID and native connection port/token. |
| `load_wireframe_spec` | Load explicit JSON constraints matching that session's scenario and profile. |
| `inspect_ui_spatial_graph` | Obtain element IDs, source metadata, rectangles, constraint results, and browser diagnostics; establishes the trial baseline. |
| `capture_annotated_overlay` | Obtain a PNG with numbered element marks for a specified snapshot. |
| `simulate_layout_mutation` | Replace the current trial with RN style props; a null patch resets it. |
| `commit_rn_ast_patch` | Use `preview` for a diff or `apply` for a hash-checked source write. |
| `verify_native_layout` | Verify the committed source revisions and constraints against Android measurements. |
| `close_session` | Close Chromium/native transport and discard session state. |

The agent supplies a JSON specification, for example:

```json
{
  "schemaVersion": 1,
  "scenarioId": "broken-footer",
  "profile": {
    "window": { "width": 412, "height": 915 },
    "pixelRatio": 2.625,
    "fontScale": 1,
    "insets": { "top": 24, "right": 0, "bottom": 24, "left": 0 },
    "root": { "x": 0, "y": 0, "width": 412, "height": 915 },
    "orientation": "portrait"
  },
  "requiredElementIds": ["footer", "cancel", "submit"],
  "constraints": [
    { "id": "row", "type": "align", "axis": "y", "edge": "center", "elementIds": ["cancel", "submit"], "tolerance": 2 },
    { "id": "gap", "type": "gap", "axis": "x", "first": "cancel", "second": "submit", "value": 12, "tolerance": 2 },
    { "id": "safe-footer", "type": "insideSafeArea", "elementId": "footer", "tolerance": 2 }
  ]
}
```

Use this object's `profile` when opening the matching web session. Physical Android verification requires the actual device profile; the Android acceptance helper calibrates it automatically. Rectangles use app-root-relative logical units, independent of screenshot pixel scaling.

For the example, trial `{"flexDirection":"row"}` on `footer`, passing the inspected baseline snapshot ID. Preview and apply with the returned trial ID and the footer's captured source hash. After reload, request native verification using the commit ID. All requested constraints must pass; source changes, remounts, navigation, and profile changes invalidate old trials.

Edits support static inline objects and literal local `StyleSheet.create` entries. Shared, imported, repeated-instance, spread, and dynamic targets are rejected. Constraints also support target rectangles and explicitly disjoint elements; intentional overlap is allowed unless a constraint forbids it. See [contracts](docs/contracts.md) and [ownership](docs/ownership.md).

## Browser diagnostics and profile trials

Web snapshots can include `webDiagnostics`, with per-element clipping, center-point hit testing, scroll overflow, paint order, font usage, and line-box information. Evidence can be `confirmed`, `clear`, or `unknown`; font records may contain multiple families. Confirmed clipping, center occlusion, or a font-load failure blocks applying a trial. Uncertain warnings remain visible to the agent without blocking it. These findings describe Chromium and do not establish Android visibility, touchability, font fallback, or text truncation.

Instrumented text can also report authored text properties and `measuredLineCount` when the runtime receives a text-layout event. A line count does not prove that text was not truncated.

To inspect another orientation, pass `profileOverrides` to inspection and use the **same override** when simulating against the returned baseline:

```json
{ "sessionId": "<session-id>", "profileOverrides": { "orientation": "landscape" } }
```

```json
{
  "sessionId": "<session-id>",
  "baselineSnapshotId": "<landscape-snapshot-id>",
  "elementId": "footer",
  "patch": { "flexDirection": "row" },
  "profileOverrides": { "orientation": "landscape" }
}
```

Changing profile requires a fresh inspection and invalidates the previous trial. An override trial can be previewed; applying it for Android acceptance requires a fresh baseline and trial using the session's original device profile. `fontScale` is accepted by the input schema but currently returns `UNSUPPORTED_PROFILE`: the browser has not established that an override changes rendered text. See the [managed Chromium specification](docs/cdp-browser-port.md).

Add a minimum layout-box constraint to a wireframe specification when size matters:

```json
{ "id": "submit-size", "type": "minTouchTarget", "elementId": "submit", "width": 48, "height": 48, "tolerance": 0 }
```

The constraint measures the registered box in logical units; it does not prove the element can receive a touch. Constraints default to a tolerance of 2 logical units. Add `"pixelAware": true` to opt into a minimum tolerance of `2 / pixelRatio`; otherwise an explicit tolerance, including zero, is preserved.

## Android fixture acceptance

Evidence is generated at `artifacts/android-acceptance/acceptance.json` on a successful run. This helper tests the included fixture; use the MCP workflow above to verify a consumer app. The supported and validated Android target is a connected device running a compatible development client; Android emulator support is on the roadmap.

Use a connected, authorized Android device with ADB and either **Expo Go supporting SDK 58** or a compatible development client for the fixture. See [Android fixture acceptance](docs/android-acceptance.md) for development-client launch options.

In the terminal that starts Metro, generate a development connection token and enable the native runtime connection:

```sh
export EXPO_PUBLIC_LAYOUT_NATIVE_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
export EXPO_PUBLIC_LAYOUT_NATIVE_URL=ws://127.0.0.1:19482
export EXPO_PUBLIC_LAYOUT_SCENARIO=broken-footer
yarn --filter @nativemason/expo-fixture web
```

In a second terminal, set `EXPO_PUBLIC_LAYOUT_NATIVE_TOKEN` to the **same generated value**, then select the device explicitly:

```sh
adb devices -l
ADB_SERIAL='<device-serial>' yarn test:e2e:android
```

The helper reverses ports 8081 and 19482, opens the fixture, measures the real profile, tests the browser correction, previews/applies it, checks Android after reload, and restores the original fixture source in cleanup. Success prints `ANDROID_ACCEPTANCE_PASSED`. Missing devices, disconnected runtimes, stale sources, or failing constraints produce a nonzero exit and `ANDROID_ACCEPTANCE_INCOMPLETE`; they do not count as native verification.

`EXPO_PUBLIC_*` values are embedded in the development app. The connection token is a development pairing value; do not use a credential or other secret. For a remote physical device, the helper also supports `NM_ANDROID_SSH`, `NM_ANDROID_SSH_KEY`, and `ADB_SERIAL`; arrange the required host port forwarding before running it.

See [the compatibility matrix](docs/compatibility.md) for exact dependencies and current limits.
