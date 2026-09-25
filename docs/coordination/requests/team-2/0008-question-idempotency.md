# Request 0008 — contextual question idempotency

- Target owners: TEAM-1 and TEAM-3
- Affected API: `api.questions.ask`
- Contract version: `1.0` (additive recovery field)

Pass and retain a fresh 16–128 character `idempotencyKey` when asking a contextual question. The typed client sends it only as the `Idempotency-Key` header. The field remains optional for source compatibility and the client creates a one-off UUID when omitted, but only an explicitly retained key can recover the same question after a provider/network failure. Retrying the same actor, context, question and key reuses the persisted question; using the same key with different input returns `IDEMPOTENCY_KEY_REUSED`.

This closes the provider-failure recovery gap where a question could be persisted without an answer and a UI retry would otherwise create a duplicate question and provider call.

Validation: update floor/studio callers to include the key, then run type checking and the question/flag route tests.
