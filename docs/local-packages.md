# Install into a separate Expo project

NativeMason's packages are not published to npm. A separate app can install
built local tarballs; copying or vendoring the runtime source is not required.
Use the compatibility matrix before choosing the app's Expo dependencies. The
runtime declares React Native 0.88.1; an app using another version needs its own
compatibility validation. In particular, the fixture app currently uses 0.88.0 and has
not yet been validated with this package.

From the NativeMason checkout (set `NATIVEMASON_ROOT` to its absolute path):

```sh
export NATIVEMASON_ROOT=/absolute/path/to/rn-layout-bridge
cd "$NATIVEMASON_ROOT"
pnpm install --frozen-lockfile
pnpm build
mkdir -p artifacts/packs
pnpm --filter @rn-layout/contracts --filter @rn-layout/runtime --filter @rn-layout/bridge pack --pack-destination artifacts/packs
```

From the Expo app's package directory, install all three tarballs together so
npm can resolve the internal contracts dependency locally:

```sh
npm install \
  "$NATIVEMASON_ROOT/artifacts/packs/rn-layout-contracts-0.1.0.tgz" \
  "$NATIVEMASON_ROOT/artifacts/packs/rn-layout-runtime-0.1.0.tgz" \
  "$NATIVEMASON_ROOT/artifacts/packs/rn-layout-bridge-0.1.0.tgz"
```

The app needs its own compatible React, React Native, and
`react-native-safe-area-context` dependencies. Tarball paths in its lockfile
must remain accessible to other developers and CI; alternatively distribute
the three packages through a private registry and install matching versions.
After NativeMason changes, rebuild, repack, and reinstall the tarballs. The
`@rn-layout/bridge/babel` export supplies the Babel plugin. The MCP server can
also be launched directly from the built NativeMason checkout.

The workspace executable is present before the build so first installation does
not warn about a missing binary. Invoking it before `pnpm build` reports the
required build step on stderr.
