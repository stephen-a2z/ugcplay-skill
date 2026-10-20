# CLI review fixes

User authorized fixing all four review findings. Keep login rules and Agent-generated metadata unchanged.

- [x] Add failing regressions for malformed API success responses, credentials overwritten by concurrency, missing ZIP CRC checks and encoded file URL paths. Confirm each fails on the old implementation.
- [x] Validate upload session and completed game response fields, enforce completion game ID consistency and verify update sessions against the requested --game-id, and preserve uploadId for uncertain completion. Reject anonymous completion without a claim token.
- [x] Save credentials in atomic per-origin files; merge legacy credentials.json with new-format overrides/tombstones. Exercise same-process and separate-process concurrent writes.
- [x] Validate incremental CRC-32 against ZIP central directory CRC for each extracted asset, including empty files and stored/deflated ZIP entries.
- [x] Use fileURLToPath in runners; exercise the whole installed package in a path containing spaces and Unicode. Invoke npm via its JavaScript entrypoint, without direct .cmd spawning. Configure Windows CI and adapt Unix permission assertions/junction tests.
- [x] Run full test suite and isolated tarball verification. Independently review final implementation, investigate findings, and report verification limits.

No production upload, deployment, or registry publication is part of this fix.

Independent review found one additional response-boundary gap: a session could name a different game than the requested update. Reproduced with a failing test for both upload/link, then rejected before PUT/finalize while retaining uploadId. Other fixes had no important review findings. Final installed-package verification passed 12/12 tests after this change. Reviewer rechecked and reported no further findings. Space/Unicode installation verified locally on macOS; Windows execution is deferred to the configured CI matrix.
