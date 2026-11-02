# Contract authority

packages/contracts/src defines all public types and runtime schemas. Schema version is 1. Coordinates are app-root-relative logical units. Source hashes are SHA-256 of original UTF-8 source. Source offsets use JavaScript UTF-16 indices. IDs must be screen-unique. One trial replaces the previous trial against a frozen baseline. No source writes occur during simulation. Commit receipts remain pending until native verification. Default tolerance is 2 logical units. Margin values may be negative; other dimensions and flex values must be nonnegative.

Project identity is NativeMason (GitHub nativemason; MCP server nativemason). CLI nativemason and rn-layout-bridge launch the same stdio server. Existing @rn-layout package exports retain their frozen v1 names.

## Android coordinate and root contract

The Android logical window is the full SafeAreaProvider frame, not the potentially system-bar-reduced Dimensions.window. Surface-space measure() pageX/pageY and the SafeAreaProvider frame share the native coordinate system. Subtract the provider frame origin to obtain window-space root coordinates, then the measured root origin for node coordinates. LayoutProvider requires rootId identifying the registered full app root; no first-element inference is permitted. Insets are applied once by the pure safe-area intersection. This contract is checked against edge-to-edge Samsung observations before measurement fixes.

A snapshot is coherent only when every SourceRef hash equals its file entry in revisions. Mixed source revisions cannot establish native acceptance. Overlay output requires matching identity and geometry immediately before and after rasterization; a detected change returns STALE_SNAPSHOT.

ToolOutputSchemas and ToolOutput<K> define every tool JSON output and are enforced before MCP delivery. Source preview/apply outputs contain exactly one of plan or receipt. Reset results carry snapshot/results; mutation results additionally carry a trial ID, patch and delta.

## Browser diagnostics and profile trials

SpatialNode geometry and ConstraintResult remain cross-platform evidence. Text props describe authored values; `measuredLineCount` is present only when a settled native or web text-layout callback supplied it. It does not prove no truncation. `WebDiagnostics` is an optional sidecar allowed only on web snapshots; it reports clipping, center hit test, scroll overflow, paint order and all CDP font records. `confirmed`, `clear` and `unknown` distinguish positive, negative and unavailable evidence. Diagnostics never enter Android evaluation.

The `minTouchTarget` constraint measures the registered layout box dimensions only; it does not claim that the element is reachable or unobscured. Browser warnings describe proven clipping, center occlusion, and custom-font load failures. Confirmed warnings block apply; uncertain evidence is returned without blocking. No cross-platform no-truncation constraint is defined.

Profile overrides currently cover orientation. Font-scale override is represented in the tool contract but the managed browser must return `UNSUPPORTED_PROFILE` until it verifies rendered text changes. Orientation changes create a new profile-bound capture and invalidate prior trials. `pixelAware` is opt-in and applies a tolerance floor of `2 / pixelRatio`; omitted `pixelAware` preserves the requested tolerance, including zero.

The bridge does not simulate Yoga pixel rounding. Accurate Yoga rounding requires the full ordered layout tree, parent absolute offsets, Yoga version/configuration, and text measurement behavior; the registered spatial graph does not contain those inputs. Android measured geometry remains authoritative.
