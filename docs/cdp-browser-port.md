# Managed Chromium CDP BrowserPort

## Contract boundary

The BrowserPort owns one Playwright Chromium instance and one CDP session for its page. Playwright runtime capture remains authoritative for registered React Native Web nodes and normalized logical rectangles. CDP enriches web snapshots with diagnostics only. Android snapshots must not contain this sidecar.

`capture(profileOverrides?)` applies the requested profile, waits for fonts/images and two stable runtime captures, maps CDP evidence to registered hosts, then returns a schema-validated snapshot. `trial(id, patch, profileOverrides?)` resets to the unmodified React runtime state, applies the profile and RN style patch through the runtime, waits for a stable capture, and returns diagnostics with that trial. It never alters geometry by CSS.

## CDP collection

- Create a CDP session with Playwright `page.context().newCDPSession(page)` after navigation and runtime discovery. Enable DOM and CSS domains as required; detach and close Chromium in `close()` and every failed-open path.
- Use the development runtime's `getDiagnosticTargets()` to map each ID to its actual host element. Resolve those element handles to CDP node/backend IDs, then use `DOMSnapshot.captureSnapshot` with paint order enabled; never infer mappings from text or layout order.
- Determine clipping from registered element client rects intersected with ancestor client boxes where overflow clips. Determine center hit test with `DOM.getNodeForLocation`; the hit must resolve to the registered host or a descendant. Use explicit `unknown` where a host cannot map or a cross-origin boundary prevents evidence.
- Collect scroll dimensions from the element and clipping ancestors. Paint order is nullable and diagnostic; DOM order is not a substitute.
- Use `CSS.getPlatformFontsForNode` for all reported families and glyph counts. `isCustom` may be null when CDP cannot classify a family. A confirmed `FONT_LOAD_FAILED` warning requires a requested custom font to be absent from the returned usage after `document.fonts.ready`; missing/ambiguous evidence is uncertain.

Diagnostic evidence values are `confirmed`, `clear`, and `unknown`. Trial warnings have `confirmed` or `uncertain` severity. Confirmed clipping, center occlusion, and custom-font load failure block source apply. Unknown and uncertain evidence is returned to the agent and does not block apply. Diagnostics never affect Android constraint evaluation.

## Profile overrides and invalidation

An orientation override swaps the active viewport dimensions to the requested orientation, updates `profile.window`, `profile.orientation`, and measured root rectangle, and preserves pixel ratio and insets only when they still fit that viewport. Otherwise return `INVALID_INPUT` and require a matching explicit spec. A profile-bound snapshot is a distinct baseline; applying a new profile invalidates any prior trial and snapshot identity.

Font-scale override is unsupported until a runtime probe confirms rendered text changes at the requested scale. Merely changing profile metadata or Chromium OS text scale is not sufficient. Until then return a typed unsupported result without capturing or claiming a font-scaled layout.

Every operation is bounded by the configured timeout. Navigation, remounts, changed source revisions, changed registered host mapping, failed CDP commands, and unstable geometry return typed errors. A failed trial resets its runtime style override. A failed CDP capture never returns a snapshot with stale diagnostics. A screenshot and its diagnostic snapshot must share the same profile and stable geometry.

External Chrome attachment is out of scope for this port; it will need a separate ownership and cleanup contract.
