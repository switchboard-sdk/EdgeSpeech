# React Native packaging — library vs. app, Expo vs. bare RN

How `@synervoz/edgespeech` splits Android build configuration between **the library**
and **the consuming app**, and how that split is satisfied on **Expo** vs. **bare
React Native**. This is the single source of truth for those decisions; the Android
plan (`Android.md`) and the README point here.

Verified during on-device bring-up (Samsung SM-G780G) — every setting below is
confirmed, not assumed.

## The mental model

EdgeSpeech is a **C++ TurboModule** that autolinks into either an Expo or a bare RN
app. It does **not** use the Expo Modules API. Two consequences drive everything else:

- **Autolinking makes the library a Gradle *subproject* of the consuming app's
  build** — a guest in the app's build graph (`project :app > project
  :synervoz_edgespeech`), not its own build. It can *influence* the app's
  configuration but not *own* it.
- **The C++ compiles in the *app's* native build** (via `react-native.config.js`
  `cxxModule*` keys + `android/CMakeLists.txt`), Prefab-linking the Switchboard AARs.
  So the **app** — not the library — must be able to resolve and package those native
  deps.

## Ownership principle

The split follows a standards-based line (not "force everything from the library"):

- **The library owns its dependency source of truth** — the Switchboard Maven repo
  URL and the setup instructions live in the library/README. On bare RN the library
  injects it automatically; on Expo the app declares it in one documented line
  (transparent, and what Expo's docs recommend — see the decision below).
- **The app owns its build toolchain** — NDK version, target ABIs, packaging. A
  library imposes *requirements* on these, but it should **document** them, not seize
  them. Silently pinning a consumer's NDK or restricting their ABIs can conflict with
  their other native deps. This is exactly what `expo-build-properties` is for.

We deliberately do **not** force NDK / ABIs / packaging from a library config plugin
— that's beyond ecosystem norms; libraries in this position document toolchain
requirements rather than override them.

## What the library owns (no app action needed)

- **C++ TurboModule compile + Prefab link wiring** (`react-native.config.js`
  `cxxModule*` keys + `android/CMakeLists.txt`).
- **`RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS`** — declared in the library manifest,
  merged into every app. Request `RECORD_AUDIO` at runtime via
  `requestMicrophonePermission()`; nothing to declare app-side.
- **Switchboard Maven repo — bare RN only.** The `rootProject.allprojects` injection
  in the library's `android/build.gradle` reaches the consumer (bare RN doesn't use
  `--configure-on-demand`, and RN's default repo mode honors project repositories). No
  app step. *(Verified on Expo; bare RN is "should work," untested in this repo.)* On
  **Expo** the app declares the repo instead — see the table and decision below.
- **Android models** — the AARs ship none (iOS bakes them into the SDK frameworks), so
  the library's `postinstall` downloads them (~290 MB: Whisper base + tiny, Sherpa
  en_GB) into its own `android/src/main/assets/models/`; Android's asset-merge bundles
  them into the app's APK. No app step; fallback `download-android-models.js` if install
  scripts are gated; opt out with `EDGESPEECH_SKIP_ANDROID_MODELS`.

## App-side settings (the app's own build config)

Each row shows how the **app** satisfies a requirement the library imposes.

| Setting | Required? | **Expo** | **Bare RN** (committed `android/`) |
|---|---|---|---|
| New Architecture | hard | `newArchEnabled: true` in `app.json` (default) | `newArchEnabled=true` in `gradle.properties` (default RN 0.76+) |
| Switchboard Maven repo | hard | `expo-build-properties` → `extraMavenRepos` (one line, folds into the EBP block; see decision) | **nothing** — autolink injects it, unless the app uses `FAIL_ON_PROJECT_REPOS` → declare in `android/build.gradle` |
| `useLegacyPackaging` / `extractNativeLibs` | hard (`ggml_abort` — Whisper `dlopen`s its ggml CPU backends off disk) | `expo-build-properties` → `useLegacyPackaging: true` | `packagingOptions { jniLibs { useLegacyPackaging true } }` in `app/build.gradle` |
| Drop 32-bit `x86` | hard (AARs ship `arm64-v8a`/`armeabi-v7a`/`x86_64` only) | `expo-build-properties` → `buildArchs` | `reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64` in `gradle.properties` |
| NDK r29 (`29.0.14206865`) | hard (`dlopen` fails at launch — the prebuilt `.so` needs `__cxa_init_primary_exception`, absent from the r27 default) | **documented edit** — set `ndkVersion "29.0.14206865"` in `app/build.gradle` after `prebuild` (`expo-build-properties` has no `ndkVersion` key; re-apply after `prebuild --clean`) + `sdkmanager --install "ndk;29.0.14206865"` | `ndkVersion "29.0.14206865"` in `app/build.gradle` + `sdkmanager` install |
| Android models | hard (not bundled in the AARs — iOS bakes them into the xcframeworks) | **automatic** on `npm install` (postinstall → library `assets/models/`, merged into the APK); fallback `download-android-models.js`; opt out with `EDGESPEECH_SKIP_ANDROID_MODELS` | same — automatic on `npm install`; fallback `download-android-models.js` |
| Mic permission | hard | **nothing to declare** (library merges); request at runtime | **nothing to declare** (library merges); request at runtime |

## Things to notice across the bases

1. **Bare RN's surface is simplest** — no plugins anywhere: the repo comes free from
   autolinking, and a few committed edits to `gradle.properties` + `app/build.gradle`
   cover the rest.
2. **NDK is the one thing with no declarative path on Expo.** `expo-build-properties`
   has no `ndkVersion` key, so it's a documented manual edit to `app/build.gradle` after
   `prebuild` — no library *or* app config plugin. The edit persists across normal
   `expo run:android`; re-apply it after a `prebuild --clean`.
3. **Everything else on Expo is declarative** via `expo-build-properties` (repo,
   packaging, ABIs) in `app.json` — no config plugin at all.

## Concrete artifacts per base

**Expo** (this repo's example) — `app.json`:

```json
"plugins": [
  ["expo-build-properties", {
    "android": {
      "extraMavenRepos": ["https://s3.amazonaws.com/synervoz-android-maven-repository"],
      "useLegacyPackaging": true,
      "buildArchs": ["armeabi-v7a", "arm64-v8a", "x86_64"]
    }
  }]
]
```

Plus `expo-build-properties` in `package.json` and a **manual `ndkVersion` edit** to
`app/build.gradle` after `prebuild` (no EBP key for it). Models download automatically
on `npm install` (postinstall → library assets, merged into the APK). The EBP settings
live in `app.json` so they survive `prebuild`; only the NDK edit is re-applied after a
`prebuild --clean` (models are library-side, unaffected).

**Bare RN** (documented in the README; no bare example shipped) — committed edits:

```gradle
// android/gradle.properties
reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64

// android/app/build.gradle → android { }
ndkVersion "29.0.14206865"
packagingOptions { jniLibs { useLegacyPackaging true } }
// Maven repo: nothing (autolinked) unless the app uses FAIL_ON_PROJECT_REPOS
```

Plus `sdkmanager --install "ndk;29.0.14206865"`. Models download automatically on
`npm install` (postinstall → library assets, merged into the APK).

## Decisions

### 1. Maven repo on Expo — declare `extraMavenRepos`, no library config plugin

We considered shipping a library Expo config plugin
(`@synervoz/edgespeech/app.plugin.js`) to inject the repo, and **rejected it** in
favour of documenting `extraMavenRepos`. Rationale:

- **No net simplification for the consumer.** They already need an
  `expo-build-properties` block (for `useLegacyPackaging` + `buildArchs`); the repo is
  one more key in it. A library plugin would instead add a *separate* `plugins`
  entry — same or more surface, just relocating the URL.
- **Cost to the library.** A maintained `app.plugin.js` + an `@expo/config-plugins`
  dependency + compat risk across Expo SDK versions — all to move a single stable URL.
- **Transparency.** An explicit `extraMavenRepos` line is visible to the consumer and
  compatible with `FAIL_ON_PROJECT_REPOS` setups; silently injecting a remote repo is
  what those setups guard against. Expo's docs recommend documenting the repo for
  libraries with custom dependencies.
- **A config plugin earns its keep for *many/complex* native edits** (permissions +
  entitlements + manifest + gradle deps). One repo URL doesn't clear that bar — and we
  deliberately removed the things that would have (see decision 2).

Bare RN is unchanged (autolink injection).

### 2. Toolchain (NDK / ABIs / packaging) is documented, not plugin-injected

Those are the app's build toolchain (see the ownership principle). A library states
them as **documented requirements**; the app sets ABIs and packaging via
`expo-build-properties`, and pins the NDK with a documented `app/build.gradle` edit
after `prebuild` (`expo-build-properties` has no `ndkVersion` key).

We ship **no config plugin** for the NDK — neither from the library nor as an app-side
plugin in the example. A single-setting config plugin isn't worth the machinery, and on
Expo the NDK edit is manual (re-applied after `prebuild --clean`), matching how any
consumer pins their own toolchain. Trade-off: a clean `prebuild` doesn't re-pin the NDK
by itself — the edit is a documented manual step. This keeps the library from
overriding a consumer's toolchain and conflicting with their other native deps.

## React Native facts this rests on

- **Autolinking makes a library a *subproject* of the consuming app's Gradle build**,
  not its own build — it can influence but not own the app's configuration.
- **A library can't reliably add a Maven repository to its consumer.** Gradle doesn't
  propagate repositories transitively, and the `allprojects` injection is
  timing-fragile: it breaks under `--configure-on-demand` (Expo CLI uses it; the RN
  CLI doesn't), where `:app` resolves its classpath before the library subproject is
  configured.
- **Expo config plugins run only at `prebuild`.** They edit the generated `android/`
  before it's built — great for durable config, useless for bare RN (which doesn't
  prebuild). Expo also does **not** auto-apply a dependency's config plugin; the
  consumer must list it.
- **Expo regenerates `android/` + `ios/` on every `prebuild`.** Manual edits to those
  dirs are not durable — config must live in `app.json` / config plugins (source of
  truth = `app.json` + `expo-build-properties`). Bare RN commits the native dirs, so
  edits there *are* durable.
- **`expo-build-properties` covers `extraMavenRepos`, `useLegacyPackaging`,
  `buildArchs`, `packagingOptions`** — but has **no `ndkVersion` key** (verified in
  the SDK 54 schema). NDK pinning on Expo therefore needs a small config plugin or a
  documented gradle edit.
- **New Architecture is bridgeless** — synchronous/blocking legacy-module methods are
  unreliable; prefer async (Promises).
- **Native libs are packed in the APK by default** (`extractNativeLibs=false`). Any
  native code that `dlopen`s sibling `.so`s at runtime needs `extractNativeLibs=true`
  (`useLegacyPackaging=true`).
