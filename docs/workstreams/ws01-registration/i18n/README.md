# WS01 account and email message resources

Base: `a14c59017a4b8f29812f439bc92523df6c741abc` (v0.10.6). Content owner: WS01. Application wiring: TD's existing A author. This change contains human-facing language resources only; it is not evidence of a translated running service or email delivery.

- Browser: `apps/web/public/locales/account/{zh-CN,en}.json`; plain flat ICU strings, call `msg('account:key', params)` or explicit text/attribute bindings.
- Mail: `apps/platform/domains/email/locales/{zh-CN,en}.json`; registration/recovery codes and recovery-completed notices, subject plus plain text. No new HTML template or delivery behavior.
- `account-message-sources.json`: source locations, parameters, common-message references and excluded copied Agent commands.
- `account-literal-to-keys.json`: Chinese source text to account key candidates, for source editing only. Never use it to scan or translate arbitrary live DOM/user content.
- `account-source-inventory-map.json`: matches against A's AST inventory, including exact requested dynamic keys. Duplicate candidates may express different contexts; choose the source-owned key, not a random text match.
- `email-message-sources.json`: backend template source and parameters.

## Semantic and wiring constraints

1. Sign in / Sign out; recovery backup; Link for the account-to-Agent relationship. Friend requests are separate. Brand is Trisavia. Credentials, filenames, IDs, protocol values and original resident content remain unchanged.
2. Demo mode (`experience`) uses the existing four-digit 1234 flow and sends no email. Successful demo verification does not verify email ownership. Account creation/linking still requires the original confirmed operation. Email-provider acceptance is not inbox delivery or verification; queued, failed and unknown remain distinct. Actual email delivery has not been independently validated by this content work.
3. Saving a check-in preference is not proof of a host task being created, adopted or run. Pausing world actions does not stop a local Agent. Observe Only, field locks, proposal approval, platform restrictions and current-owner checks keep their original meaning.
4. Upload, validation, preview and application of a custom appearance are separate facts. Do not present uploaded/previewed assets as applied. Dynamic service validation text is passed through as original data until its service owner supplies a locale contract; it is not translated with arbitrary text matching.
5. Copied Agent registration/runtime/avatar/recovery/file-finding instructions remain exactly in their original language. Translate only the human controls and feedback. Do not change `docs/access/v1`, runtime bodies/digests, Agent preferences or tasks. The normal invitation remains 24 hours with existing one-use/revocation semantics.
6. Use complete branch messages for email verification/proof and expiry where available. A's optional-clause compatibility keys are also supplied under the exact requested names; pass localized clauses, never Chinese literals into English. Dynamic names, addresses and IDs are original data. Format dates/numbers with the shared locale adapter without changing actual times, expiry or timezone semantics. Parameters such as `{result}` or `{state}` must come from the original verified state, not a translated-text comparison.
7. The exact `email.proof.recoveryCancelled` wording is supplied for the recovery branch; the old source reused the registration-cancelled sentence. Choose the branch from existing operation type. No cancellation/state transition is introduced.
8. Current town names are WS02-owned data. `auth.welcome` receives `{townName}`; the existing Chinese default world name remains unchanged until WS02 supplies an approved name. Legacy clothing-color labels are mapped for source completeness, but this does not restore the removed control.
9. The seven `preferences.*` messages cover the approved Owner-only website-language follow-up. An unknown save result continues the original receipt check; automatic detection and account-preference merging do not submit writes. Authenticated human `uiLocale` is independent of Agent language preferences. Automatic browser negotiation must not be stored as a user's explicit account choice. Language switching must not resend codes, resubmit operations, alter binding/permissions, clear drafts or reveal another account's private state.

## Coverage and checks

The pair contains 973 account messages and 6 email template strings per language. All requested dynamic keys are supplied. A's 678-record AST inventory has 665 exact source mappings; the remaining records are six HTML containers (their visible text/attributes are individually mapped) and seven excluded copied-command records. The added appearance catalogue/look-stage mappings extend beyond A's initial inventory.

FormatJS ICU parsing and named-parameter parity pass for both language pairs. Static HTML labels/attributes were checked against account/common resources, with the town welcome covered by its parameterized message. No application/API/PG/email-send/browser or full regression tests were run for this content-only change; wiring and actual UI behavior remain with A/TD's focused checks. The old common `admission_requirements_unmet` message still describes a legacy publish/join flow; it is shared-source context, not a new WS01 rule or proof that the flow is current.
