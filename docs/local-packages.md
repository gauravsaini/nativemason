# Install into a separate Expo project

NativeMason's packages are not published to npm. A separate app can install
built local tarballs; copying or vendoring the runtime source is not required.
Use the compatibility matrix before choosing the app's Expo dependencies. The
runtime declares React Native 0.88.1; an app using another version needs its own
compatibility validation. The workspace fixture is pinned to React Native
0.88.1; apps using another version should validate their own dependency matrix
before integration.

From the NativeMason checkout (set `NATIVEMASON_ROOT` to its absolute path):

```sh
export NATIVEMASON_ROOT=/absolute/path/to/rn-layout-bridge
cd "$NATIVEMASON_ROOT"
yarn install --frozen-lockfile
yarn build
mkdir -p artifacts/packs
yarn --filter @nativemason/contracts --filter @nativemason/runtime --filter nativemason pack --pack-destination artifacts/packs
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
`nativemason/babel` export supplies the Babel plugin. The MCP server can
also be launched directly from the built NativeMason checkout.

The workspace executable is present before the build so first installation does
not warn about a missing binary. Invoking it before `yarn build` reports the
required build step on stderr.
