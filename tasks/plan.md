# Implementation and release gates

NativeMason uses TypeScript, Node 24 and Yarn 4.18.1. Shared Zod contracts live in `packages/contracts/src`; effectful adapters validate boundary data and return typed faults. The integrator owns contracts, configuration, dependencies, application orchestration and MCP dispatch. Runtime, browser and editor work is reviewed before integration into `main`.

The implementation and follow-up feature work are integrated. Remaining release work is tracked in `tasks/todo.md`: verify the final tree on native targets, complete the clean-checkout README and packed-consumer walkthrough, then squash published history and rerun the gates against that exact commit. npm publication requires approval and registry access.

Android and iOS measurements establish acceptance for their respective platforms. Browser trials and diagnostics provide candidate evidence. Missing native evidence keeps verification incomplete. Development-machine emulators are never launched automatically; use selected devices or CI targets.
