# Ownership
Integrator: contracts, core, application, MCP, root configuration, docs, tasks, integration/e2e tests.
Runtime leaf: packages/runtime/src/**, packages/bridge/src/instrumentation/**, packages/bridge/src/native/**, examples/expo-fixture/** except package.json.
Browser leaf: packages/bridge/src/browser/** and packages/bridge/src/overlay/**.
Editor leaf: packages/bridge/src/editor/**.
Only the integrator changes contracts or dependency manifests. Each package imports other packages only through public exports.

