# NativeMason

NativeMason gives an MCP coding agent a measured React Native layout loop: inspect an Expo web mirror, test React Native style props in Chromium, preview or apply a small source edit, and verify the committed result on Android.

The web mirror is a trial environment. A source write remains **native verification pending** until matching Android source revisions and layout constraints pass. NativeMason does not call a model API or interpret design images.

Private repository: [gauravsaini/nativemason](https://github.com/gauravsaini/nativemason). The local folder remains `rn-layout-bridge`; public workspace imports retain `@rn-layout/*`.

## Setup and checks

Use Node 24 and pnpm 10.28.2. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
```

Build before starting the fixture or MCP server. Integration tests launch an isolated Expo web fixture and real Chromium, exercise the MCP workflow, and restore their temporary source copy. Generated screenshots, source diffs, measurements, and timings go under ignored `artifacts/`.

Start the example web app:

```sh
pnpm --filter @rn-layout/expo-fixture web
```

Its default route is `http://localhost:8081/?scenario=broken-footer`. The footer deliberately starts with vertically stacked buttons. See the [fixture source](examples/expo-fixture/App.tsx) and [JSON constraints](packages/contracts/fixtures/footer.json).

## Instrument an Expo screen

Use the runtime components for the elements an agent should measure. Every `layoutId` must be unique within the screen. `rootId` identifies the mounted, full app-root `LayoutView`; the runtime does not infer the root from registration order.

```tsx
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  LayoutProvider, LayoutView, LayoutText, LayoutPressable,
} from '@rn-layout/runtime';

export function Screen() {
  return (
    <SafeAreaProvider>
      <LayoutProvider rootId="screen" scenarioId="login">
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

Add the development source-metadata plugin to the consuming app's Babel configuration:

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [[require.resolve('@rn-layout/bridge/babel'), {
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
pnpm exec nativemason
```

Configure an MCP client to launch `node` with the absolute path to `packages/bridge/dist/cli.js`. The server speaks MCP on stdin/stdout; it is not an HTTP server.

| Tool | Purpose |
| --- | --- |
| `open_session` | Supply an absolute app project root, web URL, scenario ID, and device profile. Returns a session ID and native connection port/token. |
| `load_wireframe_spec` | Load explicit JSON constraints matching that session's scenario and profile. |
| `inspect_ui_spatial_graph` | Obtain element IDs, source metadata, rectangles, and constraint results; establishes the trial baseline. |
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

## Physical Android acceptance

The full footer workflow has passed on an explicitly selected physical Samsung device running Android API 37. Evidence is generated at `artifacts/android-acceptance/acceptance.json`; this is a tested configuration, not a claim of universal device compatibility.

Use a connected, authorized physical Android device with **Expo Go supporting SDK 58** and ADB installed. No local Mac emulator is required or started by the test.

In the terminal that starts Metro, generate a development connection token and enable the native runtime connection:

```sh
export EXPO_PUBLIC_LAYOUT_NATIVE_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
export EXPO_PUBLIC_LAYOUT_NATIVE_URL=ws://127.0.0.1:19482
export EXPO_PUBLIC_LAYOUT_SCENARIO=broken-footer
pnpm --filter @rn-layout/expo-fixture web
```

In a second terminal, set `EXPO_PUBLIC_LAYOUT_NATIVE_TOKEN` to the **same generated value**, then select the device explicitly:

```sh
adb devices -l
ADB_SERIAL='<device-serial>' pnpm test:e2e:android
```

The helper reverses ports 8081 and 19482, opens the fixture in Expo Go, measures the real profile, tests the browser correction, previews/applies it, checks Android after reload, and restores the original fixture source in cleanup. Success prints `ANDROID_ACCEPTANCE_PASSED`. Missing devices, disconnected runtimes, stale sources, or failing constraints produce a nonzero exit and `ANDROID_ACCEPTANCE_INCOMPLETE`; they do not count as native verification.

`EXPO_PUBLIC_*` values are embedded in the development app. The connection token is a development pairing value; do not use a credential or other secret. For a remote physical device, the helper also supports `NM_ANDROID_SSH`, `NM_ANDROID_SSH_KEY`, and `ADB_SERIAL`; arrange the required host port forwarding before running it.

See [the compatibility matrix](docs/compatibility.md) for exact dependencies and current limits.
