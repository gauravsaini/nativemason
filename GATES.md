# Completion gates

- [ ] G1: Strict typechecking
  CHECK: yarn typecheck
  EXPECT: tsc --noEmit
  EVIDENCE: pending
- [ ] G2: Import boundaries and lint
  CHECK: yarn lint
  EXPECT: eslint
  EVIDENCE: pending
- [ ] G3: Unit behavior checks
  CHECK: yarn test
  EXPECT: Tests.*passed
  EVIDENCE: pending
- [ ] G4: Real browser and MCP integration
  CHECK: yarn test:integration
  EXPECT: Tests.*passed
  EVIDENCE: pending
- [ ] G5: Real Android acceptance
  CHECK: yarn test:e2e:android
  EXPECT: ANDROID_ACCEPTANCE_PASSED
  EVIDENCE: pending
