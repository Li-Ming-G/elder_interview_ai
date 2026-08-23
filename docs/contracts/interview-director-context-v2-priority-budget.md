# InterviewDirectorContextV2 Priority and Budget Policy / P4C-02

状态：`FORMAL POLICY / REVIEW CANDIDATE`。本文与
[`interview-director-context-v2-priority-budget.schema.json`](interview-director-context-v2-priority-budget.schema.json)
及 synthetic fixtures 共同定义 P4C-02 的 deterministic priority and budget policy surface。
它是 P4C-01 membership/freeze contract 的 successor policy artifact；不实现 assembly runtime、Director
wiring、provider/model/tokenizer/embedding 或生产 numeric budget。

## 1. Authority and boundary

`InterviewDirectorContextV2`、其 complete source-bearing membership manifest、`membership_digest` 和
`context_digest` 仍由 P4C-01 定义。P4C-02 不修改 section shape、source eligibility、membership identity、
source revision 或 digest algorithm，也不创建第二份 semantic memory authority。

The policy consumes a complete P4C-01 frozen membership and produces a deterministic selection plan made of
typed references (`section`, `source_type`, `source_id`, `source_revision`). It never copies semantic values into
the plan. A later assembly implementation may use that plan to create a budgeted presentation, but must retain the
P4C-01 complete manifest separately so clipping cannot rewrite or hide the source-complete freeze evidence.

The policy is provider-neutral. A configured budget is an injected, auditable input. No production numeric budget,
tokenizer, cost model, model, provider or fallback value is selected here.

## 2. Fixed priority classes

Every P4C-01 required section has exactly one policy class. Priority is assigned from the frozen section name; it is
not inferred from semantic content, retrieval score, model output, wall-clock time or array insertion order.

| Class | Sections | Policy guarantee |
| --- | --- | --- |
| `protected` | `interview_state`, `boundaries` | Every member is retained. Partial retention is invalid. These members are never clipped or demoted. |
| `high` | `working_memory`, `active_memory`, `resumed_memory`, `actual_asked`, `displayed`, `current_presentation` | Selected before `normal` and `optional`; a member is never displaced by a lower class. |
| `normal` | `recent_transcript`, `memory_candidates` | Selected after all eligible `high` members, in deterministic order. |
| `optional` | `question_bank` | Selected last and is the first non-protected class eligible for clipping. |

The `protected` class preserves high-priority interview state and boundary membership. A resolved budget that cannot
retain every protected member fails closed; it must not return a partial state, omit a boundary, or fall back to V1.
An empty P4C-01 section remains an explicit empty section and requires no selection entry.

## 3. Deterministic ordering and tie-breaking

Selection precedence is fixed as follows:

1. priority class: `protected`, then `high`, then `normal`, then `optional`;
2. the section's order in P4C-01 `freeze.required_sections`;
3. the P4C-01 entry order tuple: `input_order`, `source_id_lexicographic`, then `revision_ascending`.

The policy must preserve the P4C-01 entry order after applying these keys. If two distinct entries still have equal
keys, the policy fails closed rather than depending on object-key order, database order, provider order or a hidden
tie-breaker. The same frozen membership, policy revision and resolved configuration therefore produce the same
selection plan.

## 4. Configuration injection

The P4C-01 `budget.config_ref` and `budget.policy_version` are the required configuration seam. A P4C-02 policy input
must additionally identify:

- `capacity_profile_ref`: the externally managed capacity/profile that resolves the available budget;
- `entry_cost_profile_ref`: the externally managed deterministic cost profile for frozen membership entries;
- `config_digest`: a digest of the resolved configuration, when the configuration service provides one.

These references are opaque to P4. The injected configuration must declare `policy_version=
"p4-priority-budget-v1"`, be available before selection, and be stable for the whole freeze. Missing, unresolved,
stale, or policy-mismatched configuration is a fail-closed error. P4 does not guess a numeric capacity, tokenize text,
or silently use a default profile.

Synthetic fixtures may use explicit numeric capacities and costs solely to demonstrate clipping. Those fixture values
are test inputs, not production recommendations or an accepted budget.

## 5. Clipping and fail-closed behavior

Clipping applies only to the selection plan; it never mutates P4C-01 source arrays or manifests.

1. Validate complete P4C-01 membership, scope, source revisions, digests and section counts first.
2. Resolve and validate the injected policy/configuration references.
3. Retain every `protected` entry. If the protected set cannot fit, fail closed with no plan.
4. Traverse `high`, then `normal`, then `optional` entries in the fixed order above.
5. For a non-protected entry, retain it only when the injected cost profile says it fits the remaining capacity.
6. Once an entry does not fit, clip that entry and all later entries in the same ordered class; lower classes are not
   allowed to displace it. No partial content, field, source reference or boundary is emitted.

The clipping result is a reference set, not a new source of truth. If a later write/read fence detects a membership,
revision, policy or configuration digest mismatch, dependent AI work is cancelled and no newly assembled fallback is
used.

## 6. Machine surface and test boundary

The machine artifact freezes the policy version, class-to-section mapping, ordering keys, fail-closed rules and opaque
configuration references. It intentionally does not prescribe a production capacity, token unit, tokenizer or provider.
Fixtures cover: protected state and boundaries surviving lower-class clipping; deterministic tie-breaking; missing or
mismatched configuration rejection; and rejection of a plan that changes the complete P4C-01 membership manifest.

This contract does not implement runtime assembly, Director integration, provider/model/tokenizer/embedding selection,
P2-D, P5 evidence tools, P6 orchestration, migrations, or real-data fixtures.

Machine artifact: [`interview-director-context-v2-priority-budget.schema.json`](interview-director-context-v2-priority-budget.schema.json).
Fixtures: [`fixtures/interview-director-context-v2-priority-budget.fixtures.json`](fixtures/interview-director-context-v2-priority-budget.fixtures.json).
