# Install into a separate Expo project

The three public packages are not yet published. Build and pack from the checkout using Node 24 and Yarn 4.18.1:

```sh
yarn install --immutable
yarn build
mkdir -p artifacts/packs
yarn workspace @nativemason/contracts pack --out ../../artifacts/packs/nativemason-contracts-0.2.0.tgz
yarn workspace @nativemason/runtime pack --out ../../artifacts/packs/nativemason-runtime-0.2.0.tgz
yarn workspace nativemason pack --out ../../artifacts/packs/nativemason-0.2.0.tgz
```

Install all three tarballs together in the consumer, using absolute paths:

```sh
npm install /checkout/artifacts/packs/nativemason-contracts-0.2.0.tgz /checkout/artifacts/packs/nativemason-runtime-0.2.0.tgz /checkout/artifacts/packs/nativemason-0.2.0.tgz
npx --no-install nativemason init --dry-run
npx --no-install nativemason init
```

Replace `/checkout` with the real checkout path. Keep tarballs accessible to other developers and CI, or use an authorized internal registry. Rebuild, repack, and reinstall after changes. Do not vendor runtime source.

Match the [compatibility matrix](compatibility.md). NativeWind is optional; its v4 interop requires the consuming app's NativeWind/Metro/Tailwind configuration. `init` preserves existing configuration and enables the bridge adapter when NativeWind is detected.

`yarn test:packages` validates package allowlists, Apache licensing, separate npm installation, initialization idempotency, public exports, and MCP discovery. The executable points to built output and reports `yarn build` if invoked before building a checkout.
