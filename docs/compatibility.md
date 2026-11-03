# Compatibility and verification

NativeMason 0.2 uses a pinned Expo development fixture. Install `yarn.lock` with `yarn install --immutable`; package dependency ranges do not broaden the verified matrix.

| Component | Fixture/toolchain |
| --- | --- |
| Node.js | 24 |
| Yarn | 4.18.1, `nodeLinker: node-modules` |
| Expo | 58.0.22 |
| React / React DOM | 19.3.0 |
| React Native | 0.88.1 |
| React Native Web | 0.21.4 |
| Safe-area context | 5.10.1 |
| NativeWind / Tailwind | 4.2.7 / 3.4.17 |
| Reanimated / Worklets | 4.7.1 / 0.13.0, from Expo's bundled-module matrix |
| Playwright | Locked version and its matching Chromium |

Public package names are `nativemason`, `@nativemason/runtime`, and `@nativemason/contracts`. They are prepared as local tarballs until npm release approval. The root workspace is private.

## What the checks establish

- Unit tests cover schemas, deterministic geometry, style planning, transaction recovery/revert, callbacks/refs, native protocol, and scenario-setting restoration.
- Browser integration runs real Expo/Chromium/MCP workflows, including source changes and reloads. Browser-only findings do not establish native correctness.
- Physical Android acceptance records matching committed web/native revisions and constraints, then verifies an explicit revert. Profiles and identities remain in ignored local evidence; compatibility claims are platform-level.
- CI defines Android emulator acceptance on Linux and iOS simulator acceptance on macOS. A configured job is not passing evidence: inspect its artifacts and conclusion before release.
- Additional app versions, devices, scenarios, font scales, and third-party integrations need their own measurements.

## Supported boundaries

Development instrumentation covers imported RN View, Text, Pressable, TextInput, ScrollView, and Image hosts in project JS/TS modules. Standard Expo App and Expo Router roots can be configured by `init`. Explicit runtime components remain supported. Production and dependency modules are excluded.

Styles support scoped local overrides of arrays/conditionals/imports/theme expressions, statically discoverable shared definitions, and a bounded NativeWind v4 literal-utility vocabulary. Callback styles, dynamic class construction, unresolved shared consumers, transforms, animations, and arbitrary evaluation are rejected. Shared apply requires measured coverage for discovered consumers. Unknown scenario coverage is not inferred.

Native text fitting requires an enabled equivalent probe, explicit supported typography, settled measurements, and a current text/style/width/font-scale signature. Nested/rich or otherwise unproven cases remain unavailable. Chromium font scaling remains unsupported. Native font-scale runs restore settings through a recovery journal; iOS numeric scales are limited to supported Dynamic Type mappings.

Native scenarios use Maestro for device UI interactions and explicitly registered runtime hooks for app state. Native exact scroll offsets and unsupported keyboard operations report errors; use explicit swipe gestures and input taps. External Chrome attachment, design-image/Figma interpretation, bare RN integration, WebViews/Expo DOM, and custom native modules are outside this release.
