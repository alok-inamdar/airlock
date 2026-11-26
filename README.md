# Airlock

**A reversible semantic privacy firewall for high-stakes personal documents.**

Airlock audits medical bills, residential leases, and employment/severance agreements with Firebase AI Logic hybrid inference. Raw text is scrubbed on-device by Gemini Nano, only a tokenized `WirePayload` can reach Cloud Gemini, and the names are restored locally after the audit.

Built for **#BuildHybridAI 2026**. Apache-2.0. 100% free tier: no Blaze, no billing, no Google Search Grounding, no backend.

---

## Why hybrid inference is mandatory

| Approach | Failure mode |
| :--- | :--- |
| Pure cloud | Uploading an SSN, diagnosis, salary, or lease address to a third-party model is a privacy liability. |
| Pure on-device | Gemini Nano's context window and reasoning budget are too small for a multi-page contract plus statutory/coding rulebooks. |
| **Airlock** | Nano redacts locally → Cloud Gemini audits the stripped payload against bundled rule packs → the browser rehydrates a personalized letter. |

## The three-stage pipeline

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ LOCAL VAULT (browser only)                                               │
│ raw document + token map + rehydrated letter                             │
│                                                                          │
│  Stage 1  InferenceMode.ONLY_ON_DEVICE + runLocalOnly()                  │
│           Gemini Nano extracts direct identifiers and roles              │
│           deterministic tokens: [PERSON_1], [ORG_1], [SSN_1]…            │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │  toWire()  (strict type + regex firewall)
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ THE WIRE — the only document object allowed to leave                    │
│ { documentType, jurisdiction, sanitizedText, roleHints, extractedItems } │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │  App Check · ONLY_IN_CLOUD · Structured JSON
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ CLOUD GEMINI + bundled 2026 Rule Packs                                   │
│ findings · severity · financial impact · allowlisted rule IDs            │
│ gemini-4-hydrogen → fallback gemini-3.5-flash-lite · 25s budget          │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │  findings + tokenized draft
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Stage 3  InferenceMode.ONLY_ON_DEVICE                                    │
│ longest-first validated rehydration → deterministic letter → Nano polish │
└──────────────────────────────────────────────────────────────────────────┘
```

### Firebase AI Logic surfaces used

- `firebase/ai` — `GoogleAIBackend`, `InferenceMode.ONLY_ON_DEVICE`, `ONLY_IN_CLOUD`, `PREFER_ON_DEVICE`, `InferenceSource` enum checks, `initializeDeviceModel()` progress, Structured JSON Output.
- `firebase/app-check` — reCAPTCHA v3 provider plus a localhost-only debug token.
- `firebase/auth` — zero-friction anonymous sign-in.
- `firebase/firestore` — `initializeFirestore({ localCache: persistentLocalCache() })`, zero-PII audits, offline queue.
- `firebase/remote-config` — live policy toggles with `minimumFetchIntervalMillis: 0`.
- Firebase Analytics is **not initialized**.

### The `#10635` guard

In `firebase@13.3.0`–`13.4.0`, `InferenceMode.ONLY_ON_DEVICE` can silently call the cloud when Chrome's `LanguageModel` API is absent ([firebase-js-sdk#10635](https://github.com/firebase/firebase-js-sdk/issues/10635)). Airlock's `runLocalOnly()`:

1. pre-checks `window.LanguageModel` and `LanguageModel.availability()` **before** the SDK call;
2. never calls `countTokens()` on raw text;
3. post-asserts `result.response.inferenceSource === InferenceSource.ON_DEVICE` and rejects anything else with `PRIVACY_VIOLATION`.

When Nano is unavailable, the SDK's local path is never invoked. Simulation Mode (deterministic regex + heuristics) takes over, with an explicit accuracy disclaimer.

---

## Local Demo Mode (no Firebase account required)

Leave every `VITE_FIREBASE_*` value empty:

- `firebaseEnabled = false`; Firebase is never initialized.
- Stage 1 uses the deterministic Simulation Mode pipeline. On-device Gemini Nano is intentionally disabled in this mode because Firebase AI Logic must initialize before `ONLY_ON_DEVICE` is called; configure a Firebase project to exercise the Nano path.
- Stage 2 returns a **clearly labeled cached demo result** with valid bundled rule IDs and tokenized drafts.
- The local vault uses `sessionStorage`; audits and the offline queue use `localStorage`.
- Remote Config falls back to the bundled defaults.
- The full 3-pane X-Ray, manual redaction, rehydration, letter export, offline queue, and "Delete All Audits" all work.

No document data is sent anywhere in this mode.

---

## Quickstart

Requires Node.js 22.13+.

```bash
npm install
cp .env.example .env      # optional; leave empty for Local Demo Mode
npm run dev
```

Other scripts:

```bash
npx tsc --noEmit   # typecheck
npm run build      # typecheck + production bundle
npm test           # Vitest security suites (run locally)
npm run preview    # preview the production build
```

### Browser support

- **Full hybrid mode:** desktop Chrome 148+ with the built-in Gemini Nano model available (`LanguageModel.availability() === "available"`). Click **Download Nano** on the first run; the download must start from a user gesture and can take several minutes.
- **Everything else:** Safari, Firefox, mobile, and Chrome without Nano fall back to Simulation Mode. The X-Ray labels the mode honestly.

Cold-start downloads are never blocking: the **Use Simulation Mode Now** button is always available.

---

## Firebase setup (Spark free tier)

1. Create a Firebase project and **stay on the Spark plan**. Do not enable billing.
2. Add a Web app and copy the config into `.env`.
3. **Authentication** → Sign-in method → enable **Anonymous**.
4. **Firestore Database** → create in production mode → deploy `firestore.rules`.
5. **App Check** → Web app → reCAPTCHA v3 → register your domains. Put the site key in `VITE_FIREBASE_APPCHECK_SITE_KEY`. For localhost, either set `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN` or let the SDK generate a local-only token. Never commit a real token.
6. **AI Logic** → get started with the Gemini Developer API on the free tier. No billing upgrade is needed. Do not enable Search Grounding.
7. **Remote Config** → create the parameters below.
8. **Hosting** → build and deploy:

```bash
npm run build
firebase deploy --only hosting,firestore:rules
```

### Environment variables

| Variable | Required for live mode | Purpose |
| :--- | :--- | :--- |
| `VITE_FIREBASE_API_KEY` | yes | Public Firebase web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | recommended | Auth domain |
| `VITE_FIREBASE_PROJECT_ID` | yes | Project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | optional | Storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | optional | Sender ID |
| `VITE_FIREBASE_APP_ID` | yes | Web app ID (required by Firebase AI Logic) |
| `VITE_FIREBASE_APPCHECK_SITE_KEY` | recommended | reCAPTCHA v3 site key for App Check |
| `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN` | localhost only | Optional fixed debug token; never commit |

The app treats `apiKey + projectId + appId` as the switch. Missing values mean Local Demo Mode, not a broken app.

### Remote Config parameters

| Key | Type | Default | Notes |
| :--- | :--- | :--- | :--- |
| `redaction_strictness` | string | `strict` | `standard` or `strict` |
| `cloud_auditor_model` | string | `gemini-4-hydrogen` | Allowlisted to `gemini-4-hydrogen` / `gemini-3.5-flash-lite` |
| `max_chunk_chars` | number | `1600` | Clamped to 500–4000 |
| `rule_pack_version` | string | `2026.1` | Bundled packs win if the remote value differs |
| `enable_search_grounding` | boolean | `false` | Forced off on the free tier |

`minimumFetchIntervalMillis` is `0` so **Refresh Policy** works immediately.

---

## Security design

### Type boundary

`LocalScrubResult` contains raw originals and the token map and never leaves the browser. `WirePayload` contains only:

```ts
{
  documentType: "medical_bill" | "residential_lease" | "employment_contract";
  jurisdiction: string;
  sanitizedText: string;
  roleHints: Record<string, string>;
  extractedItems: Array<{ refCode?: string; description: string; amount?: number }>;
}
```

`toWire()` is the only producer. It re-sweeps entity originals, runs the regex firewall, sanitizes line-item descriptions, validates role hints, and returns a `passed` flag. `assertWirePayload()` runs again immediately before the cloud call and before every persistence.

### Defense-in-depth PII firewall

Runs synchronously inside `toWire()`, after model redaction:

- US SSN, email, phone (including bare 10-digit), credit card (Luhn + BIN prefix), labelled DOB, MRN, Aadhaar, PAN, policy IDs, routing and account numbers.
- Deliberately ignores CPT/HCPCS codes, NDC codes, and dollar amounts.
- Adds every regex-redacted original to the local token map, so rehydration still works even when the model missed it.

### Prompt-injection defense

- Every document is wrapped in `<untrusted_document>…</untrusted_document>`.
- Delimiter-looking text inside the document is neutralized, so it cannot break out of the wrapper.
- System prompts state that document content is data, never instructions.
- All model JSON is validated against a strict shape; unknown fields and unknown rule IDs are dropped.
- The regex firewall cannot be disabled by model output.
- The adversarial demo pack exercises all of this end to end.

### Citation allowlist

The cloud model never supplies a URL. It supplies a `matchedRuleId`; Airlock resolves that ID against the bundled rule packs, drops unknown IDs, and only renders URLs whose scheme is `https:` and whose host is an official government domain (`cms.gov`, `leginfo.legislature.ca.gov`, `nysenate.gov`, `nyc.gov`, `ag.ny.gov`, `hhs.gov`).

### Rehydration safety

- Tokens are validated against the local vault.
- Replacement is a single pass with longest tokens first (`[PATIENT_1]` cannot corrupt `[PATIENT_10]`).
- Unknown tokens are left untouched.
- Literal brackets in source text are left alone.
- A local tone polish is rejected if Nano drops or renames any token.

### Storage

| Data | Location | Lifetime |
| :--- | :--- | :--- |
| Raw document, token map, letter | In-memory + `sessionStorage` | Current tab session; wiped manually or on **New Document** |
| Audits, offline queue | `localStorage` fallback / `users/{uid}/audits` | Until **Delete All Audits** |
| Firebase infrastructure | Auth, App Check, Remote Config, Firestore | Managed by Firebase |

Cloud records contain only the wire payload, findings, rule pack version, and telemetry. No raw text, token map, entity originals, or rehydrated letter.

**Accurate privacy claim:** *Zero detected direct identifiers sent to cloud.* Semantic context and quasi-identifiers can still exist. Airlock is not a guarantee of anonymity.

---

## Bundled 2026 Rule Packs

`src/rules/rulePacks2026.ts` is versioned (`2026.1`) and ships verified official `https:` citations.

| Pack | Rule | Citation |
| :--- | :--- | :--- |
| CA | Deposit cap (AB 12) | Cal. Civ. Code § 1950.5 |
| CA | Deposit return / itemization | Cal. Civ. Code § 1950.5(g) |
| CA | Habitability waiver | Cal. Civ. Code §§ 1941.1, 1942.1 |
| CA | Employee non-compete | Cal. Bus. & Prof. Code § 16600 |
| CA | Void non-compete / SB 699 | Cal. Bus. & Prof. Code § 16600.5 |
| CA | Wage discussion restriction | Cal. Labor Code § 232 |
| CA | Final pay | Cal. Labor Code §§ 201, 202, 206 |
| NYC | Deposit cap | N.Y. Gen. Oblig. Law § 7-108 |
| NYC | Warranty of habitability | N.Y. Real Prop. Law § 235-b |
| NYC | Non-waivable protections | N.Y. Real Prop. Law § 235-a |
| NYC | Application/late fees | N.Y. Real Prop. Law § 238-a |
| CMS | NCCI PTP edits / unbundling | CMS NCCI PTP Edits |
| CMS | NCCI policy manual | Medicare NCCI Policy Manual, Ch. 1 |
| CMS | Duplicate claims | Medicare Claims Processing Manual, Ch. 1 |
| CMS | Hospital price transparency | CMS Hospital Price Transparency |
| CMS | No Surprises Act | CMS No Surprises guidance |
| CMS | Physician fee schedule | CMS PFS |
| CMS | Medical bill rights | CMS Medical Bill Rights |

Unbundling and chargemaster markup are labeled **potential** review flags, not proven violations.

---

## Demo packs

1. **ER bill with a duplicate charge** — duplicate CPT 99284, potential 36415 unbundling, potential $140 ibuprofen markup, invalid `000-00-0000` SSN, test card.
2. **California lease** — 3-month deposit (AB 12), blanket habitability waiver, deposit-return clause.
3. **Severance** — 24-month California non-compete, wage-discussion gag, final-pay condition.
4. **Adversarial prompt-injection lease** — explicit instructions to skip redaction and reveal the system prompt.

All data is fictional.

---

## Project structure

```text
src/
├── ai/
│   ├── firebaseConfig.ts      env-driven Firebase init + App Check + Auth + Firestore + Remote Config
│   ├── modelFactory.ts        three inference modes + runLocalOnly() #10635 guard
│   ├── capabilities.ts        Nano probe, download progress, Simulation Mode
│   ├── prompts.ts             untrusted delimiters + prompt builders
│   ├── simulationScrub.ts     pure regex/heuristic pipeline (also tested)
│   ├── stage1LocalScrub.ts    chunked Nano scrub + fallback
│   ├── stage2CloudAudit.ts    structured cloud audit + allowlist + cached fallback
│   └── stage3Rehydrate.ts     local rehydration + letter + tone polish + export
├── rules/rulePacks2026.ts     curated CA / NYC / CMS rules
├── vault/
│   ├── wireBoundary.ts        LocalScrubResult → toWire() → WirePayload
│   ├── piiFirewall.ts         deterministic defense-in-depth sweep
│   ├── tokenMap.ts            deterministic token registry
│   ├── rehydrate.ts           single-pass longest-first restoration
│   ├── chunker.ts             ≤1,600-char clause-aware chunks, 20-chunk cap
│   ├── pdfParser.ts           PDF.js text extraction + scanned-PDF detection
│   └── db.ts                  session vault + wipe
├── services/
│   ├── firestoreAudits.ts     zero-PII CRUD + offline queue + delete all
│   ├── remoteConfig.ts        policy defaults + refresh
│   └── telemetry.ts           in-memory classified request log
├── samples/                   four demo packs + cached demo audit builder
├── components/                X-Ray, ingest, citations, letter, UI primitives
├── tests/                     firewall, chunker, rehydrate, prompt injection
└── App.tsx
```

---

## Implementation notes

- The free-tier model identifiers (`gemini-4-hydrogen`, `gemini-3.5-flash-lite`) follow the 2026 blueprint. Remote Config can switch between those two on the allowlist; update the allowlist if Google changes the free-tier catalog.
- Cloud generation config omits `temperature`/`topP` because Gemini 3.x deprecated those parameters; Structured JSON Output is used instead.
- Rule text is bundled with the build. Remote Config can change policy knobs and reports a version mismatch, but cannot hot-swap rule bodies.
- The Firestore status enum has no `cached_demo` value, so cached previews are stored as `audited_cloud` with `source: "cached_demo"` and are always labeled as cached in the UI.
- PDF.js is loaded lazily only when the user picks a PDF, keeping the initial bundle smaller.

## Limitations

- Local Demo Mode always uses Simulation Mode; the on-device Gemini Nano path requires a configured Firebase project.
- English documents on the on-device path.
- Bundled employment rules cover California only; the ingest form restricts that document type to California.
- PDF text extraction is capped at 15 pages; on-device analysis is capped at 20 chunks (~32k characters). Scanned PDFs must be pasted as text.
- Free-tier Gemini requests may be used by Google to improve products; see the [Gemini API terms](https://ai.google.dev/gemini-api/terms).
- The rule packs are consumer-education summaries, not legal advice. Exceptions apply.
- One retry plus a `gemini-3.5-flash-lite` fallback; if both fail, the UI offers a labeled cached demo result.
- No analytics, no backend, no Cloud Functions.

**Not legal or medical advice.** Airlock is a document-review tool, not a law firm or healthcare provider.

## License

Apache License 2.0. See [LICENSE](./LICENSE).
