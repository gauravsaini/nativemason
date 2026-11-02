# Completion gates

- [ ] G1: Strict typechecking
  CHECK: pnpm typecheck
  EXPECT: tsc --noEmit
  EVIDENCE: pending
- [ ] G2: Import boundaries and lint
  CHECK: pnpm lint
  EXPECT: eslint
  EVIDENCE: pending
- [ ] G3: Unit behavior checks
  CHECK: pnpm test
  EXPECT: Tests.*passed
  EVIDENCE: pending
- [ ] G4: Real browser and MCP integration
  CHECK: pnpm test:integration
  EXPECT: Tests.*passed
  EVIDENCE: pending
- [ ] G5: Real Android acceptance
  CHECK: pnpm test:e2e:android
  EXPECT: ANDROID_ACCEPTANCE_PASSED
  EVIDENCE: pending
