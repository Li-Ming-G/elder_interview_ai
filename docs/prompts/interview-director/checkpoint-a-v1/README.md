# Interview Director Prompt — Checkpoint A V1

Status: `FORMAL / IMMUTABLE / OWNER-CHECKPOINT-A-ONLY`

This bundle is the only formal prompt bundle introduced by CPA-04. `system.md` is a byte-for-byte
copy of the Product Owner artifact at
`docs/prompts/interview-director/owner-inputs/Interview_Director_System_v2.md` from durable commit
`22760af1adc5d08f51f5dd3ed0aebca5f3c7d984`. It is intentionally separate from both `v1/` and
`v2-draft/`; neither is overwritten, renamed, or used as a fallback.

`task.md` contains only the mechanical Context/Output/JSON/evidence-round wrapper required by the
accepted Checkpoint A and P5 contracts. The loader verifies the Owner source hash, formal status,
exact version, and the digest of the exact loaded system/task bytes before returning the bundle.

This bundle is local Checkpoint A only. It does not select a provider, model, data policy, ASR
path, evaluation flow, or UI.
