# RN Layout Bridge
Use English or Hinglish; never Hindi. TypeScript, pnpm, strict contracts.
Read docs/ownership.md before edits. Shared types/schemas live in packages/contracts. No cross-package deep imports. Pure core must have no I/O, clocks, random IDs, React or browser dependencies. Colocate unit tests. Root integrator owns shared config and lockfile. Native acceptance must never be simulated or reported as passing without Android evidence.

