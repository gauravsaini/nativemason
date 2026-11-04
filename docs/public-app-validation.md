# Public Expo app validation

This note records three public, MIT licensed Expo Router apps used to check initialization and the browser editing workflow. The checkouts are scratch copies pinned to the commit SHAs below; no upstream repository was changed. Results came from macOS, Node 24.18.0, Yarn 4.18.1, Expo web, and Chromium at a 412 × 915 CSS viewport. The installed bridge inputs were the local `0.2.0` archives `nativemason-0.2.0.tgz`, `nativemason-runtime-0.2.0.tgz`, and `nativemason-contracts-0.2.0.tgz`. This is browser evidence only. No simulator, emulator, or physical device was used.

## Pinned apps and results

| App | Source and tested revision | License | Web capture | Edit workflow |
| --- | --- | --- | --- | --- |
| Habitlog | [BEmmett1/habitlog](https://github.com/BEmmett1/habitlog), `1599c2ea0b926a6374a84eba4a4d304861f07a90` (Expo SDK 54) | MIT, copyright BEmmett (2025) | A browser capture produced 7 nodes and rendered “Habitlog Home”, “Log Mood”, “Recent”, and “No entries yet”. | One saved run completed open, capture, trial, preview, apply, reload capture, and revert; it reported `sourceRestored: true`. A later rerun captured 3 nodes, then failed the trial with `MISSING_ELEMENT` for a node from the preceding capture. That rerun did not apply a patch and `app/index.tsx` remained unchanged. Treat apply/revert as a demonstrated run that was not repeatable in the later session. |
| SleepDiaries | [circadia-bio/SleepDiaries](https://github.com/circadia-bio/SleepDiaries), `bd3d9c41e1ade55748d9de8c443837d0f50b81fa` (Expo SDK 55) | MIT, copyright circadia.bio (2026) | A browser capture produced 20 nodes and rendered the onboarding form. | The latest rerun completed open, capture, trial, preview, and reset; it reported `sourceRestored: true`. This workflow previews and resets a trial; it does not apply an edit. |
| Open Source Habit Tracker | [hasibhaque07/open-source-habit-tracker-app](https://github.com/hasibhaque07/open-source-habit-tracker-app), `59e8a31a0c239f46f0ab2c4c78d4e13b8455e7ca` (Expo SDK 54) | MIT, copyright Hasib Haque (2026) | With the repository Babel config as checked out, Metro/browser failed on `Cannot use 'import.meta' outside a module`. Adding Expo Babel's `unstable_transformImportMeta: true` let the bundle load and exposed the bridge runtime, but the page was blank and capture returned only the root node. | No editable target was available, so no trial, preview, or patch was performed. This app is not counted as an editing workflow pass. |

The saved per-run JSON, summaries, screenshots, and Metro logs are under the ignored `artifacts/public-app-validation/` directory. In particular, `habitlog-workflow-previous-passed.log` retains the earlier successful summary, while `habitlog-workflow-20261104T035340Z.json`, `sleepdiaries-workflow-20261104T035340Z.json`, and `habit-tracker-workflow-20261104T035340Z.json` are the latest rerun records. The timestamped records are separate so a rerun does not replace its prior evidence.

## Setup and configuration

The scratch checkouts were initialized with the matching local package archives produced from init fix `9c366f5` (declared Expo Router roots and nested Expo preset resolution). The package archive SHA-256 values were `nativemason-0.2.0.tgz`: `d9dcdbcf1c9c6eee712a72018a966bea8141a9d02761a6c682e65f2c418afb2c`; `nativemason-runtime-0.2.0.tgz`: `f92e3ca54dcc432ad4e739b416bea9aa9fac8359c73a1753cdf1fb84b0632763`; `nativemason-contracts-0.2.0.tgz`: `e8939163bca824fe1ae9426474d0d1dc26cd281188d5222e977de24dee0906ea`. The regular npm install was also tried and failed dependency resolution: the runtime package declares React `19.3.0`, while these Expo apps pin React `19.1.0` or `19.2.0`. The exploratory installation used npm's `--legacy-peer-deps`; this bypasses peer validation and is a compatibility workaround, not proof that the declared peer ranges are satisfied. The runtime also declares React Native `0.88.1` and `react-native-safe-area-context ~5.10.1`, whereas the apps use React Native `0.81.5`/`0.83.2`. The scratch app manifests were adjusted to use safe-area-context `^5.10.1` where the original version was too old for the runtime peer range. Do not interpret these runs as normal-install compatibility.

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

The generated Babel plugin specified the detected root component and enabled automatic instrumentation. The roots were `app/_layout.tsx` for Habitlog and Habit Tracker and `app/_layout.jsx` for SleepDiaries. Expo Router root selection was scoped to the declared router entry and `app/` or `src/app/` root. For Habit Tracker only, the scratch Babel preset was additionally changed from `['babel-preset-expo', { jsxImportSource: 'nativewind' }]` to `['babel-preset-expo', { jsxImportSource: 'nativewind', unstable_transformImportMeta: true }]`, an Expo transform option, to get past the initial Metro `import.meta` error. The workaround changed bundling but did not make that app's screen measurable.

The captured web sessions used a local Expo server and the MCP workflow runner from this checkout. The runner opens the app, captures the graph, loads a minimal min-touch-target constraint, trials a one-point font-size change on a visible text target, previews it, then either applies and reverts (Habitlog's successful saved run) or resets the simulation (SleepDiaries). To rerun a workflow after starting that app's web server, use:

```sh
cd "$BRIDGE_ROOT"
npx -y -p node@24 -c 'corepack yarn tsx artifacts/public-app-validation/mcp-workflows.mjs sleepdiaries'
```

Change `sleepdiaries` to `habitlog` or `habit-tracker` to select another checkout. These scripts and their outputs are exploratory artifacts, not part of the published package or a CI guarantee. Reruns can be sensitive to changing React node identities: the later Habitlog result captured a different tree and rejected its stale element ID before any source edit.

## Limits

- Treat only the stated browser captures and workflow steps as measured. The public-app results do not establish native behavior or support for any device, simulator, or vendor.
- The two successful workflow records demonstrate bounded web operations against those pinned trees. Habitlog's apply/revert did not reproduce on the later run; SleepDiaries only previewed and reset.
- Habit Tracker became bundleable with the documented Babel option, but its blank page exposed no editable target. Its editing flow remains unavailable.
- Local package archives and `--legacy-peer-deps` were used because the app React versions conflict with runtime peer declarations. Do not claim an ordinary npm install succeeds or mark these apps as generally compatible.
- Expo printed version-skew notices during the runs. The app checkouts and generated configuration were scratch-only; upstream source remained at the pinned revisions.
