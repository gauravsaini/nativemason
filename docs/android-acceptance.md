# Native acceptance

Acceptance uses the included fixture, not an arbitrary installed consumer app. It edits fixture source, checks actual runtime measurements and matching source revisions, verifies an explicit revert, and restores source during cleanup. Failures remain incomplete verification.

## Physical Android

Select an authorized target with `ADB_SERIAL`. Before starting Metro, configure the same pairing values used by the helper:

```sh
export EXPO_PUBLIC_LAYOUT_NATIVE_TOKEN='<development-pairing-value-at-least-16-characters>'
export EXPO_PUBLIC_LAYOUT_NATIVE_URL=ws://127.0.0.1:19482
export EXPO_PUBLIC_LAYOUT_TARGET_ID='<selected-target-id>'
export EXPO_PUBLIC_LAYOUT_TARGET_KIND=physical
export EXPO_PUBLIC_LAYOUT_SCENARIO=broken-footer
yarn workspace @nativemason/expo-fixture expo start --web --localhost --port 18082
```

Then run:

```sh
ADB_SERIAL='<selected-target-id>' NM_ANDROID_METRO_PORT=18082 yarn test:e2e:android
```

The helper uses compatible Expo Go by default. For an installed development build, set both `NM_ANDROID_PACKAGE` and its absolute `NM_ANDROID_LAUNCH_URL`; the URL must load the fixture's selected Metro port. `NM_ANDROID_WEB_URL` can override the web URL. The helper reverses the Metro and bridge ports. It never starts a local emulator.

Remote ADB is optional: set `NM_ANDROID_SSH=user@host` and, when needed, `NM_ANDROID_SSH_KEY`. Configure required forwarding separately. No host identity is embedded in the repository.

## Android emulator and iOS simulator

These are automated fixture helpers. Physical iOS measurement can use compatible Expo Go or a development build over LAN through MCP; follow [physical iOS setup](ios-device.md). It does not require the simulator helper below.

CI builds development binaries and runs real Linux Android-emulator and macOS iOS-simulator acceptance. Locally select an already running Android emulator with `ADB_SERIAL` and use `yarn test:e2e:android:emulator`. The emulator helper expects Metro on 8081 and a compatible installed `dev.rnlayout.fixture` build unless configured otherwise.

For iOS, use full Xcode, an explicitly booted `IOS_SIMULATOR_UDID`, a compatible installed debug build, and Metro on 8081. Set `EXPO_PUBLIC_LAYOUT_TARGET_KIND=simulator` and the target ID before starting Metro, then run `yarn test:e2e:ios`. `NM_IOS_BUNDLE_ID` overrides the fixture bundle identifier.

## Consumer applications

Use MCP with the consumer's own named scenario, source revisions, reviewed constraints, target, and measured profile. An installed release build cannot provide development measurements. Configure `nativeScenario` with an app ID and Maestro when using native scenario actions.

Evidence is generated under ignored `artifacts/<platform>-<target-kind>-acceptance/`. Public compatibility statements do not identify physical device vendors, models, or serials. Missing targets, disconnected runtimes, stale sources, unavailable required measurements, and failing constraints do not count as acceptance.
