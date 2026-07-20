# TECH_DEBT

Known shortcuts to revisit. Each entry: what/where, why it's a stopgap, and the proper fix.

---

## 1. `initialize()` swallows "already initialized" by matching the error string

**Where:** `src/VoiceEngine.ts` → `VoiceEngine.initialize()`

```ts
if (/already.*initialized/i.test(message)) {
  this.isInitialized = true
  return
}
```

**Why it exists:** the native `SwitchboardSDK` is a process-global singleton that
outlives a JS bundle reload (Fast Refresh / dev reopen). After a reload the JS
`VoiceEngine` singleton is recreated with `isInitialized = false`, so it calls
`switchboard.initialize` again, and the SDK responds with an error whose message
is *"SwitchboardSDK has already been initialized."* Without this branch,
`initialize()` throws and `EdgeSpeechProvider` red-boxes on every reload. (Verified
on-device 2026-07-19.)

**Inherited, not introduced by the refactor:** the original native
`AudioGraphManager.initialize` (Swift, pre-refactor) already did the same
error-string match and swallowed it:

```swift
if errorMsg.contains("already been initialized") || errorMsg.contains("already initialized") {
    print("[AudioGraphManager] SDK already initialized, continuing")
} else {
    throw AudioGraphError.engineCreationFailed("SDK initialization failed: \(errorMsg)")
}
```

The TurboModule/JSON-RPC refactor ported this behavior verbatim (`/already.*initialized/i`
covers both Swift substrings). So the proper fix has *always* been missing — this
is pre-existing debt surfaced during the port, not a regression the refactor caused.

**Why it's a stopgap:**
- Matches on a **human-readable error message** — brittle if the SDK reword it,
  localizes it, or changes it across versions.
- Broad regex could mask a *different* legitimate init failure that happens to
  contain those words.
- Production impact is nil (the app initializes once per launch); this is purely a
  dev-ergonomics patch, so it's low-risk to leave for now.

**Proper fix (pick one):**
1. **Match on a stable JSON-RPC error code** instead of the message, if the SDK
   assigns one to "already initialized" (inspect `res.error.code` from
   `SwitchboardJSONRPC`). Preferred if a stable code exists.
2. **Query init state before initializing** — e.g. a `getValue('switchboard', ...)`
   for an initialized flag, or a dedicated native `isSDKInitialized()` TurboModule
   method (native state survives JS reload, so it can answer authoritatively).
3. **Make init idempotent natively** — have the native layer no-op / return success
   if the SDK is already initialized, so JS never sees the error.

**Acceptance:** no string-matching on error text; reload the dev app repeatedly with
no red box; a genuine bad-credentials/init failure still surfaces via `onError` +
throw.
