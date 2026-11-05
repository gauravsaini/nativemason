# Physical iOS with Expo Go or a development build

Native measurement uses the instrumented JavaScript bundle and React Native refs. A physical iPhone or iPad can connect over WebSocket without Xcode Simulator or ADB. The `test:e2e:ios` command is a separate simulator-only fixture runner.

This LAN setup requires the checkout containing `nativeHost` support, or npm version 0.3.0 or later. Version 0.2.0 binds to loopback only and cannot use this direct LAN connection.

## Choose the app runtime

Use Expo Go only when its Expo SDK and bundled native libraries match your app. Otherwise install a development build containing your app's native dependencies. NativeMason itself adds no custom native module, but that does not make an incompatible consumer app work in Expo Go.

Follow [Expo's physical iOS setup](https://docs.expo.dev/get-started/set-up-your-environment/?device=physical&platform=ios) and [SDK version guidance](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/). In the currently documented distribution, App Store Expo Go supports SDK 54; the repository's SDK 58 fixture needs a compatible Expo Go build (Expo documents EAS/TestFlight distribution) or a development build. Check those instructions for your SDK rather than assuming the App Store binary matches. Follow Expo's account/sign-in requirements as well.

## Configure the connection

First run `npx --no-install nativemason init` in the consumer app, review its configuration, and restart Metro. Put the phone and computer on the same trusted network. Substitute the computer's private LAN IPv4 interface address below; do not use the phone's address or `localhost`.

```sh
export NM_DEV_HOST=192.168.1.20
export EXPO_PUBLIC_LAYOUT_NATIVE_URL="ws://${NM_DEV_HOST}:19482"
export EXPO_PUBLIC_LAYOUT_NATIVE_TOKEN='<random-development-pairing-value-at-least-16-characters>'
export EXPO_PUBLIC_LAYOUT_TARGET_ID=ios-phone
export EXPO_PUBLIC_LAYOUT_TARGET_KIND=physical
export EXPO_PUBLIC_LAYOUT_SCENARIO=broken-footer
npx expo start --go --lan --web --port 18082
```

For a development build use `--dev-client` instead of `--go`. Open the project using Expo's QR/deep-link instructions, allow local network access on the phone, and activate the same named scenario on native and web. The target ID is a pairing label you choose and match, not a hardware identifier discovered by the bridge.

In your existing `open_session` request, include these fields alongside `projectRoot`, `webUrl`, `scenarioId`, and the selected logical device `profile`:

```json
{
  "nativeHost": "192.168.1.20",
  "nativePort": 19482,
  "nativeToken": "<same-value-as-EXPO_PUBLIC_LAYOUT_NATIVE_TOKEN>",
  "nativeTarget": { "targetId": "ios-phone", "platform": "ios", "kind": "physical" }
}
```

The web mirror URL can be `http://127.0.0.1:18082/?scenario=broken-footer` because Chromium runs on the computer. Configure its profile to match the phone's actual window, scale and insets; different profiles cannot establish matching acceptance.

`nativeHost` binds the server to the selected interface. It accepts loopback or private LAN IPv4 addresses, defaults to `127.0.0.1`, and requires explicit pairing values for LAN use. It does not open a firewall port automatically. Allow the selected Metro/bridge ports on your trusted network. Pairing uses a development token over plain WebSocket; keep it local, do not reuse credentials, and close the session afterwards. Metro's `--tunnel` forwards Metro traffic only; it does not forward this separate WebSocket port.

## Measure and verify

Use MCP to inspect web, review/load constraints, trial changes, preview/apply, then call `verify_native_layout` for matching committed native revisions. Keep the app open, allow the development bundle to reload, and manually return to the required state after reload. The returned native snapshot contains actual iOS measurements. A disconnected phone, stale revision or failed constraint remains incomplete verification.

Omit `nativeScenario` for manual capture and verification. Registered-hook scenario scripts and profile matrices additionally require `nativeScenario` configuration with the installed app's application ID; that ID differs between Expo Go and your own development build.

Physical iOS does not use this repository's Maestro UI automation or `simctl` profile controls. Navigate manually, or use registered app hooks through `run_scenario`. Mixed scripts containing taps/text input/navigation are rejected before hooks run. Profile matrices may check the already measured profile; changing orientation/font scale automatically returns `UNSUPPORTED_PROFILE`. Change them manually on the phone and capture again. This connection path is implemented and transport-tested; physical iOS acceptance still needs evidence from an actual connected device.
