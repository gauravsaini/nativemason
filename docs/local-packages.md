# Install into a separate Expo project

This guide installs the checkout's 0.3.0 packages as local tarballs. For registry installation of a published version, use matching versions of `nativemason`, `@nativemason/runtime`, and `@nativemason/contracts`. Build and pack from the checkout using Node 24 and Yarn 4.18.1:

```sh
yarn install --immutable
yarn build
mkdir -p artifacts/packs
yarn workspace @nativemason/contracts pack --out ../../artifacts/packs/nativemason-contracts-0.3.0.tgz
yarn workspace @nativemason/runtime pack --out ../../artifacts/packs/nativemason-runtime-0.3.0.tgz
yarn workspace nativemason pack --out ../../artifacts/packs/nativemason-0.3.0.tgz
```

Install all three tarballs together in the consumer, using absolute paths:

```sh
npm install /checkout/artifacts/packs/nativemason-contracts-0.3.0.tgz /checkout/artifacts/packs/nativemason-runtime-0.3.0.tgz /checkout/artifacts/packs/nativemason-0.3.0.tgz
npx --no-install nativemason init --dry-run
npx --no-install nativemason init
```

If npm tries to build `sharp` against a globally installed libvips and fails, retry the same install command with `SHARP_IGNORE_GLOBAL_LIBVIPS=1`. See [sharp's installation guide](https://sharp.pixelplumbing.com/install/#building-from-source).

Replace `/checkout` with the real checkout path. Keep tarballs accessible to other developers and CI, or use an authorized internal registry. Rebuild, repack, and reinstall after changes. Do not vendor runtime source.

Match the [compatibility matrix](compatibility.md). NativeWind is optional; its v4 interop requires the consuming app's NativeWind/Metro/Tailwind configuration. `init` preserves existing configuration and enables the bridge adapter when NativeWind is detected.

`yarn test:packages` validates package allowlists, Apache licensing, separate npm installation, initialization idempotency, public exports, and MCP discovery. The executable points to built output and reports `yarn build` if invoked before building a checkout.
