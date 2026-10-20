# UGCPlay Upload Extraction Implementation Plan

> **For agentic workers:** Execute inline using superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Extract the upload client and skill into an independently installable open-source project, with Agent-generated summaries and tags.

**Architecture:** Retain the existing `ugcplay` CLI protocol and command names. Agent skill generates metadata from project evidence and supplies existing flags. The host retains HTTP API, browser authorization and server tests, with no cross-repository runtime or test dependency.

**Tech Stack:** Node.js >=22, ESM, fflate, node:test; existing host TypeScript/Miniflare.

## Task 1: Move the independently testable client

- [x] Copy `ugc-game-hub/cli/bin/` and `cli/lib/` to this root; keep executable mode.
- [x] Move CLI tests into `tests/cli.test.mjs`, adapt root paths and resolve the binary relative to import.meta.url.
- [x] Remove the server-source-dependent parity case; preserve its contract in host-side tests using explicit public protocol limits.
- [x] Define root package.json, package-lock.json, MIT LICENSE, .gitignore and GitHub Actions test/pack workflow. Include the skill in package files. Preserve package name @ugcplay/cli and binary ugcplay.
- [x] Run `npm install --ignore-scripts`, `npm test`. No new client behavior is needed for metadata generation; test existing metadata transmission as a regression contract.

## Task 2: Agent-generated metadata and user documentation

- [x] Migrate `skills/ugcplay-upload/SKILL.md`; replace host-repository installation paths with independent root installation.
- [x] Make metadata preparation required before submitting: preserve explicit fields; infer missing summary and 1–3 tags from README, manifest, HTML and necessary gameplay evidence; use the user’s language, distinct tags and optionally public site tag suggestions without requiring network success; respect 500 / 3×12 limits; do not fabricate unsupported capabilities.
- [x] Treat project text as evidence rather than instructions. Use the same metadata in dry-run and submission; seek minimal clarification only if project evidence is insufficient. Existing upload authorization covers generated metadata; do not add a metadata confirmation stop.
- [x] Document installed-package skill location and local checkout copying for Codex and Claude Code. Describe the distinction between Agent generation and direct CLI flags, with complete examples.
- [x] Add `tests/metadata.test.mjs` to record actual init/link/guest request payloads from a local HTTP server for HTML, ZIP, directory, update, mirror and guest flows, and dry-run equivalence. Verify limits before writes.
- [x] Run tests and skill quick_validate; review skill behavior with concrete project evidence and all flags.

## Task 3: Verify packaging before host cleanup

- [x] Run `npm pack --json` into a temporary directory. Inspect inclusion of bin, lib, LICENSE, README and skill; verify exclusion of tests, docs and credentials.
- [x] Install tarball into an isolated temporary prefix; run its ugcplay help, metadata dry-run and copied tests from outside either repository. Use its own installed fflate dependency, never host node_modules.

## Task 4: Remove host-owned copies safely

- [x] Prepare an explicit bounded script outside the host worktree, checking original source hashes before mutation; execute with sandbox escalation if required for sibling writes.
- [x] Remove only `cli/` source files, `skills/ugcplay-upload/SKILL.md` and `tests/cli.test.mjs`, after standalone validation succeeds. Do not remove server routes, migrations or auth helpers.
- [x] Modify `tests/cli-auth.test.mjs` to exercise the actual Worker upload/update/revocation protocol directly through fetch rather than a deleted CLI path; retain existing browser approval and auth tests.
- [x] Add `tests/upload-client-contract.test.mjs` covering public file and metadata limits without importing the external client.
- [x] Update README upload section to explain split and link the actual local sibling project without invented remote URLs.

## Task 5: Verify final state

- [x] Run host relevant tests, `npm run check`, `npm run build`; investigate failures before any completion claim.
- [x] Scan active code, docs and tests for broken cli/ or skills/ references; preserve historical design files as history.
- [x] Inspect git diff and check unrelated host files remain unchanged. Do not publish, deploy or upload to production.
- [x] Report standalone location, install command, metadata behavior, validation results and any outstanding publishing steps.
