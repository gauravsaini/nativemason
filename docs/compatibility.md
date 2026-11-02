# NativeMason compatibility

NativeMason v0.1 targets one Expo Android/web dependency matrix. Install from the committed `pnpm-lock.yaml` with `pnpm install --frozen-lockfile`; dependency ranges elsewhere do not expand the tested app matrix.

| Component | Pinned fixture / validated toolchain |
| --- | --- |
| Node.js | 24; implementation verified with 24.18.0 |
| pnpm | 10.28.2 |
| Expo | 58.0.22 |
| React / React DOM | 19.3.0 |
| React Native | 0.88.1 |
| React Native Web | 0.21.4 |
| `react-native-safe-area-context` | 5.10.1 |
| `@expo/metro-runtime` | 58.0.16 |
| Playwright | Resolved by the lockfile; install its matching Chromium with `pnpm exec playwright install chromium` |

Public package names remain `@rn-layout/contracts`, `@rn-layout/runtime`, and `@rn-layout/bridge`. Both `nativemason` and `rn-layout-bridge` invoke the same MCP stdio executable. The private GitHub repository is [gauravsaini/nativemason](https://github.com/gauravsaini/nativemason); the agreed local checkout is `/Users/Shared/rn-layout-bridge`.

## Verification evidence

- `pnpm lint`, `pnpm typecheck`, and `pnpm test` cover contracts, pure geometry, registry behavior, native transport, source editing, and Chromium/overlay behavior.
- `pnpm test:integration` runs the actual Expo web fixture, Chromium, MCP tools, source preview/apply/reload, executable stdio discovery, and honest native-disconnection reporting.
- `ADB_SERIAL='<device-serial>' pnpm test:e2e:android` has passed on an authorized physical Samsung API 37 device with Expo Go for SDK 58. It verifies the complete broken-footer correction and restores the fixture afterward.

The observed device profile was 384 × 832 logical units, pixel ratio 3.75, font scale 1, portrait. The test calibrates actual safe-area insets and root coordinates rather than assuming the example JSON's 412 × 915 profile. Generated calibration, receipt, source-hash, web, and native evidence lives under ignored `artifacts/android-acceptance/`; browser integration timings live under `artifacts/integration/`.

These checks establish the fixture workflow on the tested configuration. Other devices, font scales, navigation arrangements, and app screens need their own matching scenarios and native evidence. The Android helper requires an explicit target and never creates or starts a Mac emulator. Its current preflight requires Android API 24+ and an installed Expo Go package; Expo Go's own version/device requirements also apply.

## Supported integration

- One development `LayoutProvider` per web page; `rootId` must name its mounted, full app-root instrumented `LayoutView`.
- Opt-in `LayoutView`, `LayoutText`, and `LayoutPressable` with screen-unique `layoutId` values and the development Babel plugin.
- App-root-relative logical geometry; screenshot scaling follows pixel ratio. Safe-area checks intersect the root and window once.
- Explicit, matching scenario IDs and JSON device profiles across web, constraints, and Android.
- One active browser trial per session, applied through React Native style props. Each candidate replaces the prior trial against the captured baseline.
- Static inline styles and literal, unshared local `StyleSheet.create` entries for source edits. One file is changed per commit, with original hash/range checks and an atomic replacement.
- Local MCP stdio. Native measurements use an opt-in development WebSocket connection through ADB reverse.

Snapshots must have coherent source revisions. A source write remains native-pending until matching Android revisions and every requested constraint pass. A native regression retains the edit and returns failure evidence; it does not silently roll back.

## Current limits

The complete named Expo acceptance scenario is `broken-footer`. Pure and adapter tests cover further geometry and error cases; broader screen-level acceptance still requires additional fixtures.

V1 does not include NativeWind editing, arbitrary CSS translation, design-image/Figma ingestion, bare React Native/Vite support, iOS verification, WebView/Expo DOM rendering, a custom Metro CDP domain, or automatic instrumentation of an unmodified application. Dynamic style functions, JSX spreads, imported/shared styles, and repeated source sites are not automatically editable. Fonts and text rendering may differ between Chromium and Android, so browser success alone never establishes native correctness.

Production builds disable runtime collection, connections, trial overrides, and injected source metadata. NativeMason is a development inspection/editing tool; instrumented components render their corresponding React Native primitive without adding a host layout wrapper.
