# Android fixture acceptance contract

`pnpm test:e2e:android` exercises the repository's `broken-footer` Expo fixture.
It edits and restores that fixture and expects its Metro server on port 8081.
It does not run acceptance against an arbitrary consumer application.

Select a connected Android device with `ADB_SERIAL` (or the documented remote
ADB settings). By default the helper launches Expo Go. To launch the fixture
with a compatible installed Expo development build, set both:

* `NM_ANDROID_PACKAGE`: the installed Android application ID.
* `NM_ANDROID_LAUNCH_URL`: that development client's absolute deep link to the
  fixture Metro server, using `127.0.0.1:8081` on the device. For example, a
  client configured for the `myapp` scheme may use
  `exp+myapp://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081`.

The client must be compatible with the fixture's Expo SDK and native modules,
and its scheme must match the installed build. The helper validates that the
selected package exists, reverses the Metro and bridge ports, launches the
link, and requires matching source revisions and passing Android constraints.
The development app and Metro must share `EXPO_PUBLIC_LAYOUT_NATIVE_TOKEN`.

For a consumer app such as the fixture app, instrument its development bundle and use
the MCP `verify_native_layout` workflow with the app's own scenario, source
revisions, and constraints. An installed release or preview build without the
development runtime cannot provide native measurements.
