# Contract authority

packages/contracts/src defines all public types and runtime schemas. Schema version is 1. Coordinates are app-root-relative logical units. Source hashes are SHA-256 of original UTF-8 source. Source offsets use JavaScript UTF-16 indices. IDs must be screen-unique. One trial replaces the previous trial against a frozen baseline. No source writes occur during simulation. Commit receipts remain pending until native verification. Default tolerance is 2 logical units. Margin values may be negative; other dimensions and flex values must be nonnegative.

Project identity is NativeMason (GitHub nativemason; MCP server nativemason). CLI nativemason and rn-layout-bridge launch the same stdio server. Existing @rn-layout package exports retain their frozen v1 names.

## Android coordinate and root contract

The Android logical window is the full SafeAreaProvider frame, not the potentially system-bar-reduced Dimensions.window. Surface-space measure() pageX/pageY and the SafeAreaProvider frame share the native coordinate system. Subtract the provider frame origin to obtain window-space root coordinates, then the measured root origin for node coordinates. LayoutProvider requires rootId identifying the registered full app root; no first-element inference is permitted. Insets are applied once by the pure safe-area intersection. This contract is checked against edge-to-edge Samsung observations before measurement fixes.

A snapshot is coherent only when every SourceRef hash equals its file entry in revisions. Mixed source revisions cannot establish native acceptance. Overlay output requires matching identity and geometry immediately before and after rasterization; a detected change returns STALE_SNAPSHOT.

ToolOutputSchemas and ToolOutput<K> define every tool JSON output and are enforced before MCP delivery. Source preview/apply outputs contain exactly one of plan or receipt. Reset results carry snapshot/results; mutation results additionally carry a trial ID, patch and delta.
