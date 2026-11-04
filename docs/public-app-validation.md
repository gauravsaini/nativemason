# Public Expo app validation

This note records three public, MIT licensed Expo Router apps used to check initialization and the browser editing workflow. The checkouts are scratch copies pinned to the commit SHAs below; no upstream repository was changed. Results came from macOS, Node 24.18.0, Yarn 4.18.1, Expo web, and Chromium at a 412 × 915 CSS viewport. The installed bridge inputs were the local `0.2.0` archives `nativemason-0.2.0.tgz`, `nativemason-runtime-0.2.0.tgz`, and `nativemason-contracts-0.2.0.tgz`. This is browser evidence only. No simulator, emulator, or physical device was used.

## Pinned apps and results

| App | Source and tested revision | License | Web capture | Edit workflow |
| --- | --- | --- | --- | --- |
| Habitlog | [BEmmett1/habitlog](https://github.com/BEmmett1/habitlog), `1599c2ea0b926a6374a84eba4a4d304861f07a90` (Expo SDK 54) | MIT, copyright BEmmett (2025) | A browser capture produced 7 nodes and rendered “Habitlog Home”, “Log Mood”, “Recent”, and “No entries yet”. | The tracked runner completed open, ready capture, trial, preview, apply, reload capture, and revert. `app/index.tsx`'s SHA-256 before and after was `470fc22923a153b23b5c80f8f5dcacec8d6b314f236ca652a4e03f5f605af3a0`; the receipt recorded a one-point title font-size change. An earlier harness attempt selected a temporary `_layout` loading node, then received `MISSING_ELEMENT`; it made no source edit. The tracked runner waits for the requested screen source and binds the trial to the final post-spec capture. |
| SleepDiaries | [circadia-bio/SleepDiaries](https://github.com/circadia-bio/SleepDiaries), `bd3d9c41e1ade55748d9de8c443837d0f50b81fa` (Expo SDK 55) | MIT, copyright circadia.bio (2026) | A browser capture produced 20 nodes and rendered the onboarding form. | The tracked runner completed open, ready capture, trial, preview, and reset; `app/index.jsx`'s SHA-256 was `5c7fc3c64163aa04fc414d6849b88dbb0dc90be6f639070191a207a517ca37e8` before and after. This workflow previews and resets a trial; it does not apply an edit. |
| Open Source Habit Tracker | [hasibhaque07/open-source-habit-tracker-app](https://github.com/hasibhaque07/open-source-habit-tracker-app), `59e8a31a0c239f46f0ab2c4c78d4e13b8455e7ca` (Expo SDK 54) | MIT, copyright Hasib Haque (2026) | With the repository Babel config as checked out, Metro/browser failed on `Cannot use 'import.meta' outside a module`. Adding Expo Babel's `unstable_transformImportMeta: true` let the bundle load and exposed the bridge runtime, but the page was blank and capture returned only the root node. | No editable target was available, so no trial, preview, or patch was performed. This app is not counted as an editing workflow pass. |

The saved per-run JSON, summaries, screenshots, and Metro logs are under the ignored `artifacts/public-app-validation/` directory. The latest tracked-runner records are `runs/habitlog-20261104T040609968Z-86629e5e.json`, `runs/sleepdiaries-20261104T040618566Z-cc170d59.json`, and `runs/habit-tracker-20261104T040629123Z-d3e98ef3.json`. Earlier attempts remain in separate timestamped files. The unique output names ensure a rerun does not replace its prior evidence.

## Setup and configuration

The scratch checkouts were initialized with local `0.2.0` package archives containing init fix `9c366f50d5fbb973564d461b85f4695bf2c426f2` (declared Expo Router roots and nested Expo preset resolution). That identifies the source revision of the init fix; the archives also include later working-tree changes, so no exact clean source tree is claimed. Their SHA-256 values were `nativemason-0.2.0.tgz`: `d9dcdbcf1c9c6eee712a72018a966bea8141a9d02761a6c682e65f2c418afb2c`; `nativemason-runtime-0.2.0.tgz`: `f92e3ca54dcc432ad4e739b416bea9aa9fac8359c73a1753cdf1fb84b0632763`; `nativemason-contracts-0.2.0.tgz`: `e8939163bca824fe1ae9426474d0d1dc26cd281188d5222e977de24dee0906ea`. The regular npm install was also tried and failed dependency resolution: the runtime package declares React `19.3.0`, while these Expo apps pin React `19.1.0` or `19.2.0`. The exploratory installation used npm's `--legacy-peer-deps`; this bypasses peer validation and is a compatibility workaround, not proof that the declared peer ranges are satisfied. The runtime also declares React Native `0.88.1` and `react-native-safe-area-context ~5.10.1`, whereas the apps use React Native `0.81.5`/`0.83.2`. Do not interpret these runs as normal-install compatibility.

For each fresh scratch checkout, the package and initialization steps used were:

```sh
export BRIDGE_ROOT=/path/to/rn-layout-bridge
export APP_ROOT=/path/to/scratch/expo-app

cd "$APP_ROOT"
npm install --legacy-peer-deps \
  "$BRIDGE_ROOT/artifacts/packs/nativemason-0.2.0.tgz" \
  "$BRIDGE_ROOT/artifacts/packs/nativemason-runtime-0.2.0.tgz" \
  "$BRIDGE_ROOT/artifacts/packs/nativemason-contracts-0.2.0.tgz"
npx --no-install nativemason init --dry-run "$APP_ROOT"
npx --no-install nativemason init "$APP_ROOT"
npm run web -- --port 18100
```

Initialization adds the matching bridge tarballs and a Babel plugin with automatic instrumentation. Detected roots were `app/_layout.tsx` for Habitlog and Habit Tracker, and `app/_layout.jsx` for SleepDiaries. Expo Router root selection uses the declared router entry and `app/` or `src/app/` root. The scratch configurations also needed these app-specific web dependencies/changes:

| App | Scratch configuration needed for the recorded run |
| --- | --- |
| Habitlog | Added Expo web/Router peers `@expo/metro-runtime ~6.1.2`, `expo-linking ~8.0.8`, and `react-native-screens ~4.16.0`, plus `react-native-safe-area-context ^5.10.1`; generated `babel.config.cjs`; created `metro.config.js` with `.wasm` in asset extensions and `Cross-Origin-Opener-Policy: same-origin` plus `Cross-Origin-Embedder-Policy: require-corp` response headers for Expo SQLite's browser worker. Equivalent package step: `npm install --legacy-peer-deps @expo/metro-runtime@~6.1.2 expo-linking@~8.0.8 react-native-screens@~4.16.0 react-native-safe-area-context@^5.10.1`. |
| SleepDiaries | Added Expo web/Router peer `expo-linking ~55.0.8`; changed `react-native-safe-area-context` from `5.6.2` to `^5.10.1`; added the Babel plugin to the existing Babel config. Its existing SVG transformer Metro config was kept. Equivalent package step: `npm install --legacy-peer-deps expo-linking@~55.0.8 react-native-safe-area-context@^5.10.1`. |
| Open Source Habit Tracker | Added Expo web/Router peer `expo-linking ~8.0.8`; changed safe-area-context from `^5.6.2` to `^5.10.1`; added the Babel plugin while retaining NativeWind and Expo Router plugins; added `.wasm` assets and the same COOP/COEP headers to the existing NativeWind Metro config. For the retry only, set Expo Babel preset `unstable_transformImportMeta: true` in addition to `jsxImportSource: 'nativewind'`. Equivalent package step: `npm install --legacy-peer-deps expo-linking@~8.0.8 react-native-safe-area-context@^5.10.1`. |

For Habit Tracker, Expo's `unstable_transformImportMeta` setting got past the initial Metro `import.meta` error, but did not make the blank app measurable. These compatibility adjustments are test setup, not automatic edits recommended for every Expo app.

For a Router app without a Babel config, the generated setup was a `babel-preset-expo` preset and this plugin entry (with the detected root path):

```js
plugins: [[require.resolve('nativemason/babel'), {
  projectRoot: __dirname,
  autoInstrument: true,
  rootComponent: 'app/_layout.tsx',
}]]
```

Habitlog's new `metro.config.js` allowed the SQLite WASM asset and added cross-origin headers needed by its web worker:

```js
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('wasm');
const prior = config.server?.enhanceMiddleware;
config.server = {
  ...config.server,
  enhanceMiddleware(middleware, server) {
    const next = prior ? prior(middleware, server) : middleware;
    return (req, res, ...rest) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      return next(req, res, ...rest);
    };
  },
};
module.exports = config;
```

The tracked runner uses only the explicit project root, web URL, and source-path selector; it starts that app's installed MCP binary, waits for editable nodes from the selected source path, loads a minimum-touch-target constraint, then confirms the selected element against the final post-spec capture before trial. It previews a one-point font-size mutation and either resets it or applies and reverts through MCP. It records timestamps, source hashes, revisions, trial/preview/receipt details, and results in a unique JSON output. It never writes source files directly. Run Habitlog against its ready Home server with:

```sh
cd "$BRIDGE_ROOT"
npx -y -p node@24 -c 'node scripts/validate-public-app.mjs \
  --project-root "$APP_ROOT" \
  --web-url "http://localhost:18100/?scenario=public-validation" \
  --source-path "app/index.tsx" \
  --kind Text --apply-revert'
```

For SleepDiaries, use its web URL on port `18102`, `--source-path app/index.jsx`, and omit `--apply-revert` to preview and reset. For Habit Tracker, use port `18101` and `--source-path app/_layout.tsx`; the blank screen remains unavailable after the bounded wait. The runner waits up to 30 seconds by default; `--ready-timeout-ms` changes that bound. A passed workflow exits zero; unavailable or failed workflows exit nonzero after saving their timestamped result. The script is an exploratory validation tool, not a CI guarantee. Unavailable screens and changed trees remain explicit timestamped run results.

## Limits

- Treat only the stated browser captures and workflow steps as measured. The public-app results do not establish native behavior or support for any device, simulator, or vendor.
- The two successful workflow records demonstrate bounded web operations against those pinned trees. Habitlog's apply/revert did not reproduce on the later run; SleepDiaries only previewed and reset.
- Habit Tracker became bundleable with the documented Babel option, but its blank page exposed no editable target. Its editing flow remains unavailable.
- Local package archives and `--legacy-peer-deps` were used because the app React versions conflict with runtime peer declarations. Do not claim an ordinary npm install succeeds or mark these apps as generally compatible.
- Expo printed version-skew notices during the runs. The app checkouts and generated configuration were scratch-only; upstream source remained at the pinned revisions.
