## UPDATED ON : 2026-11-11

### fix (2026-11-11) — address Dependabot alerts for glob and minimatch

1. **Security**: Resolved Dependabot alerts GHSA-3g3m-2fjr-6pw4 (`glob` DoS / traversal) and GHSA-g3hv-75wg-m249 (`minimatch` pattern amplification DoS) by pinning resolutions for `glob` to `14.0.4` and `minimatch@^10` to `11.0.5`.
2. **Tests** (before → after): Vitest 26/26 files, 248/248 passed; Integration 13/13 passed; ESLint & TypeCheck clean.
3. **Files changed**: `package.json`, `yarn.lock`

## UPDATED ON : 2026-11-03

### feat (2026-11-03) — add refined NativeMason SVG logo directions and preview

1. **Brand Design**: Crafted 4 distinct high-polish SVG logos featuring architectural brick walls, windows, and peeking mason trowels (Keystone Heritage, Blueprint Precision, Courtyard Modern, and Mason Mark Mobile) with README.md preview showcase.
2. **Tests** (before → after): Vitest 82/82 passed → 82/82 passed; ESLint & TypeCheck clean.
3. **Files changed**: `README.md`, `assets/logos/01-keystone.svg`, `assets/logos/02-blueprint.svg`, `assets/logos/03-courtyard.svg`, `assets/logos/04-mason-mark.svg`, `assets/logos/options-preview.png`

## UPDATED ON : 2026-11-03

### feat (2026-11-03) — replace literal illustrations with 4 modern abstract geometric logos

1. **Brand Design**: Designed 4 modern abstract vector logo concepts (Quantum Keystone, Orthogonal Nexus, Mason Monolith, and Kinetic Apex) replacing literal brick/trowel illustrations with geometric keystone, isometric viewport bridge, and faceted delta glyphs.
2. **Tests** (before → after): Vitest 82/82 passed → 82/82 passed; ESLint & TypeCheck clean.
3. **Files changed**: `assets/logos/01-keystone.svg`, `assets/logos/02-blueprint.svg`, `assets/logos/03-courtyard.svg`, `assets/logos/04-mason-mark.svg`, `assets/logos/options-preview.png`, `README.md`

## UPDATED ON : 2026-11-03

### feat (2026-11-03) — add comprehensive app logo suite and Android adaptive icons

1. **App Icons**: Crafted 8 distinct squircle app icons (Cyber Keystone, Neon Blueprint, Solar Monolith, Kinetic Apex, Stealth Mono, Studio Snow, Terminal Amber, and Vision Acrylic) plus Android 108dp adaptive icon pair and 2x retina showcase preview.
2. **Tests** (before → after): Vitest 82/82 passed → 82/82 passed; ESLint & TypeCheck clean.
3. **Files changed**: `assets/app-logos/*`, `README.md`



## NativeMason 0.2

Migrated to Yarn and NativeMason package names, froze workflow contracts, and integrated parallel editor/runtime/browser work. Added journaled transactions and revert, automatic instrumentation, native target protocol, text probes, scenario profiles, MCP adoption tools, and release packaging. Unit and live workflow validation is in progress; native platform evidence and clean-checkout acceptance remain release gates. Physical target identity is retained only in ignored local artifacts.

### Acceptance checkpoint — automatic roots and packed consumers

Validated the existing measurement/instrumentation contracts against a real development runtime. Fixed Expo React Refresh ordering, canonical source paths, measurable automatic roots, and nested safe-area environment emulation. Fractional measured geometry remains unchanged; CDP environment inset inputs use its required integer units.

The expanded Chromium suite passes six workflows, including stateful checkout, two-file apply/revert, NativeWind conditional edits, and orientation invalidation. Physical Android acceptance passes source apply, matching revisions, text-fit evidence, an actual font-scale run with restoration, and explicit revert. Packed packages install in a separate Expo project and provide automatic host capture through MCP. Remote emulator/simulator evidence and the clean-checkout walkthrough remain release gates.
