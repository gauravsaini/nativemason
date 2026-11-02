# RN Layout Bridge
Use English or Hinglish; never Hindi. TypeScript, pnpm, strict contracts.
Read docs/ownership.md before edits. Shared types/schemas live in packages/contracts. No cross-package deep imports. Pure core must have no I/O, clocks, random IDs, React or browser dependencies. Colocate unit tests. Root integrator owns shared config and lockfile. Native acceptance must never be simulated or reported as passing without Android evidence.


Use frequent conventional commits; main is the source of truth. Resolve conflicts autonomously and remove any task worktrees after merging. Never launch an Android emulator on this Mac; use an explicitly selected physical ADB device or the authorized SSH host. When real-product testing finds an improvement, validate the governing contract first, add a regression, then fix it.
