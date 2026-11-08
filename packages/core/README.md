# @qduc/agent-core

**Building blocks for an agent host you control.**

If you are assembling an agent application, provider configuration and account
selection should not have to live in one shared mutable object. `agent-core`
provides factories for separate provider registries, web-search registries, and
session account stores, alongside a preliminary headless session runtime and
bundled prompt assets.

The registry factories are usable through the public entry today. The session
factory is **not yet a complete external composition API**; see the limitation
below before choosing this package to run conversations.

ESM-only, with TypeScript declarations. Requires Node.js 20+.

## When to use it

Use it when building your own host and you need separate registry or account
store instances with the same APIs. Each factory creates its own mutable
instance; provider/search registries start with the registered built-in entries.
This is not a claim that the entire session implementation is tenant-isolated.

If you only need to exchange or validate agent events, use
[`@qduc/agent-wire`](../wire/README.md) instead; it has no dependency on core.

## Install and try the registry factories

The [Getting Started guide](https://github.com/qduc/agent-runtime/blob/main/docs/getting-started.md#optional-try-the-core-registry-factories)
includes the source-tarball install route and a runnable registry example. Npm
registry availability is not assumed. Core has native dependencies such as
`better-sqlite3`; installation may require platform build tools when a prebuilt
binary is unavailable.

After installing, save this as `registries.mjs`:

```ts
import {
  createProviderRegistry,
  createWebSearchRegistry,
  createSessionAccountStore,
} from "@qduc/agent-core";

const first = createProviderRegistry();
const second = createProviderRegistry();

first.registerProvider({
  id: "demo-provider",
  label: "Demo provider",
  fetchModels: async () => [],
});

console.log(first.getProvider("demo-provider")?.label); // Demo provider
console.log(second.getProvider("demo-provider")); // undefined

const searches = createWebSearchRegistry();
const accounts = createSessionAccountStore();
accounts.set("demo-provider", "account-a");
console.log(accounts.get("demo-provider")); // account-a
```

Run it with `node registries.mjs`. This registers a metadata-only provider and
shows separate registry membership; it does not send a model request. Provider
objects and callbacks are not automatically deep-cloned, and an account-store
entry does not authenticate an account or load credentials.

## Before using the session runtime

The package exports `createSessionRuntime` and session port types, but
`CreateConversationSessionOptions` requires application-supplied collaborators
whose constructors are not exported. Some are nominal class types, and the
export map does not allow deep imports. An external consumer cannot yet compose
a session using only the supported public entry; this needs public-API work,
not a cast around the types.

The implementation also retains process-wide state. See
[core API boundaries](../../docs/core-migration-scope.md) for required
collaborators, internal dependencies, and isolation limits. The `0.1.x` API is
preliminary; the package is not a turnkey chatbot, CLI, gateway, or tool sandbox.

Prompt assets ship in the tarball and resolve relative to the compiled
`dist/source` tree. You do not need a separate application checkout for those
assets.
