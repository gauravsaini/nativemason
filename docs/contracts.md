# Contract authority

`packages/contracts/src` owns public Zod schemas, inferred DTOs, errors, and adapter interfaces. Shared imports use package exports. Spatial schema version remains 1 with additive fields; native protocol version 2 carries explicit platform/target/capabilities. Legacy Android protocol 1 is restricted to sessions without explicit target requirements.

## Measurements and identity

Coordinates are floating-point app-root-relative logical units. Screenshot scaling is separate. Native roots normalize registered host measurements against the safe-area/window frame; safe-area intersection applies insets once. Explicit providers identify their root. Automatic providers measure the existing SafeAreaProvider host as the app root and preserve ancestry across retained route hosts. Legacy parentless-root inference still rejects ambiguous roots.

Source hashes are SHA-256 of original UTF-8 source; offsets use UTF-16 indices. Node source references identify JSX ranges; shared-style edit plans identify the changed declaration range in the edited file. Development transforms register loaded project-module revisions so edits to imported style/token files can be checked after reload. Mounted metadata must agree with those revisions. Synthetic bundler polyfills, dependencies, and production builds receive no injected imports or collection.

Screen-unique explicit IDs/testIDs take precedence. Generated source-site IDs support unique sites. Repeated instances with uncertain cross-platform identity cannot establish acceptance through assumed ordering.

## Trials, edits, and recovery

One active batch trial replaces the previous candidate against a frozen source/profile/mount baseline. Navigation, source changes, profile changes, and remounts invalidate that baseline. Trials apply RN props through React; they never write source.

Local overrides preserve existing expressions. Explicit branch/shared/NativeWind scopes widen supported source planning while rejecting callbacks, unresolved escapes, unsupported utility construction, and ambiguous instances without acknowledgment. Preview contains all planned files and discovered consumers; unmounted consumers have unknown scenario coverage. Shared apply requires measured coverage.

Pure planners receive source text and project files from adapters. Each transaction has an intent identity, all expected source hashes, staged replacements, and a durable recovery journal. Replaying an applied intent returns its receipt only while the committed hashes still match. A new trial after revert has a new identity. Recovery and revert preserve external edits and report conflicts.

A write remains native-pending until matching committed web and selected-native scenarios pass all required constraints. Native regressions retain source changes and evidence. Revert creates a new pending receipt.

## Constraint evidence

Geometric constraints include target rectangles, alignment, gap, safe-area inclusion, disjointness, and minimum layout-box dimensions. Default tolerance is 2; `pixelAware` opts into a minimum `2 / pixelRatio`. Exact explicit tolerances remain available otherwise. Missing required elements prevent acceptance. Overlap is advisory unless a disjoint constraint expresses intent. Minimum boxes do not prove effective touchability.

`textFits` uses a settled, equivalent unconstrained native probe, the measured box, and authored `numberOfLines`. Probe evidence must match the current text/style/width/font-scale signature. A limited callback can add evidence but is not required when the full probe and box establish fit. Stale, nested/rich, inherited, or otherwise unsupported measurements stay unavailable. A line count alone cannot prove no truncation.

Web-only diagnostics retain clipping, center-hit tests, overflow, paint order, multiple font records, and explicit unknown evidence. Confirmed clipping, occlusion, or font-load failure blocks apply; uncertainty is visible and nonblocking. These findings do not establish native paint order, font fallback, or touchability.

## Tools and effects

`ToolSchemas` and `ToolOutputSchemas` validate every call/result. MCP uses object-root schemas derived from the authoritative outputs to accommodate SDK limitations around outer unions/refinements; application validation still enforces valid trial/reset and preview/receipt combinations. Structured results accompany readable text and images.

Core geometry, constraints, inference, candidate generation, overlay planning, and source planning are deterministic. Browser/native/filesystem/scenario adapters own effects. Native profile changes require measured confirmation and journaled restoration. Browser font scaling remains unsupported until rendered-text evidence establishes it.

Snapshot revisions contain mounted source files and their statically referenced local style/token dependencies; unrelated eagerly evaluated scenario modules are excluded. Measurement evidence updates do not change mount identity. Authored content/style changes still invalidate the baseline.

CDP center-point ownership follows composed DOM ancestry, including user-agent shadow roots. A control owning its hit node is clear; an ancestor receiving the hit is uncertain rather than proven occlusion. An unrelated hit node remains confirmed occlusion.
