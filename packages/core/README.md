# @qduc/agent-core

Headless session runtime and provider registries for agent applications.
Requires Node.js 20 or later. This is an ESM-only package with TypeScript
declarations.

```ts
import {
  createProviderRegistry,
  createWebSearchRegistry,
  createSessionAccountStore,
} from '@qduc/agent-core';

const providers = createProviderRegistry();
const searches = createWebSearchRegistry();
const accounts = createSessionAccountStore();
```

Create separate registries and account stores for each user or runtime rather
than sharing mutable state across tenants.

The package also exports `createSessionRuntime` and its session port types.
Session construction requires application-supplied services and an agent client;
this package is not a turnkey chatbot, CLI, gateway server, or tool sandbox.
See the exported `CreateConversationSessionOptions` type for the composition
contract. Note that the options surface currently names internal collaborator
classes (for example the required `toolOwnership` takes a class this entry does
not export, and `exports` allows no deep imports), so the factory is not yet
consumable outside its origin application without further public-API work.
Prompt assets are included in the tarball; profile and role loaders
resolve them relative to the compiled `dist/source` tree.

Provenance: the implementation was extracted from Term2's shared-package
closure (source snapshot `63fbfd8a`) using the TypeScript compiler API to trace
the import graph; see the repository README for the retained coupling notes.

The `0.1.x` API is preliminary.
