# Fallback, never rotation

Players can list several models and keys, across providers, in a Fallback list. Every AI call starts at the top of the list and moves down only when an entry cannot answer (Spent, Unusable, busy, or rate limited). Every call starts at the top again whatever failed a moment ago (2026-09-19), except that an entry the provider said is Spent waits at the back of the order until its reset (2026-09-20), and an entry that said it was busy waits at the back for ten minutes (2026-09-21, after a night of 503s that took up to a minute each to arrive): a rate-limit mark is what a Settings row shows, not a place in the order, so the strongest model that can answer is asked first every time, while an allowance already declared gone, or a model already declared overloaded, is not re-asked on every call. We do not spread calls across entries (round-robin, load balancing, "use all keys for throughput"), and the app and wiki never suggest adding keys from several accounts on one provider.

The reason is provider terms. Rotating free-tier keys to multiply a daily allowance looks like getting around a usage limit. Falling back when one allowance runs out, most often from a free key to a paid key or a local model, is an ordinary backup. We want the feature to be the second thing in its code, not only in its marketing. So a PR adding a rotation or throughput mode should be turned down on these grounds, not judged on its code.

## Considered Options

- **Rotation mode as an opt-in setting.** Rejected. Once a quota-multiplying mode is in the code, it is what the feature is known for, whatever the default.
- **Detecting or blocking several keys on one provider.** Rejected. The app cannot see which account a key belongs to, and a player with a free key and a paid key on the same provider is a normal case.
