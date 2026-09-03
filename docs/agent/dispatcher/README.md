# Single Dispatcher control plane

The live model is:

```text
Product Owner
  -> External/Web Architect
  -> mechanical Dispatcher
  -> Luna High Implementation Worker
```

The Product Owner retains product, architecture, cost, provider/model,
data-policy, deployment, and Accepted Contract decisions. The Architect may
command bounded implementation execution. Dispatcher validates protocol facts,
reconciles state, launches Workers, and advances the closed lifecycle; it does
not decide whether an Architect's technical approach is good.

## Two durable buses

The control plane uses two distinct GitHub channels:

1. **Architect Command Bus — issue #135.** Authenticated top-level
   `ARCHITECT_DIRECTIVE_V1` comments are implementation execution commands.
   Their ACKs persist idempotency and effective-envelope overlays.
2. **Implementation PR.** The PR is the implementation artifact and carries
   exact-head CI, `ARCHITECT_REVIEW_CONTEXT_V1`, `ARCHITECT_VERDICT_V1`, and
   ordinary `DISPATCHER_REPAIR_V1` evidence.

Natural-language comments are never commands or gates. GitHub native approval
is not an Architect verdict. `ARCHITECT_RECOVERY_V1` remains legacy/advisory
compatibility; in Directive mode, executable implementation commands use only
`ARCHITECT_DIRECTIVE_V1` on the configured issue.

Command discovery is fixed by `control-plane.json`. Until freshly fetched
`origin/main` contains that enabled configuration and the complete protocol,
issue #135 remains inert. The configured author allowlist prevents marker
injection through the public issue.

## Base Task Card and effective envelope

The Task Card continues to control task identity, goal, base allowed files,
dependencies, base required tests, completion semantics, entry/exit gates, and
`depends_on`/`next_task`. Its header `Status:` is an issuance/planning snapshot,
not runtime state. Canonical queue/state reconciled from fresh main controls
runtime execution, so legacy `Status: DEFERRED` cannot block canonical
`IN_PROGRESS`.

For one current task until `DONE`:

```text
Effective Allowed Files = base files + all successful Directive ACK file overlays
Effective Required Tests = base tests + all successful Directive ACK test overlays
```

ACK snapshots, not mutable command text, are the durable overlay source. The
effective envelope follows the task across initial Worker launch, same-PR repair,
new heads, CI repair, and Architect review. Worker cannot go outside it.

No Directive can change Owner-frozen product behavior, Accepted Contracts,
architecture boundaries, task identity, queue topology, provider/model/data-
policy/cost decisions, or Owner-deferred work. Dispatcher validates
machine-checkable command boundaries; Worker stops with `PRODUCT_AMBIGUITY` if
the instruction's actual meaning crosses a protected boundary.

## Mechanical pulse

Every bounded pulse performs, in order:

1. `git fetch origin main` as its first external action;
2. read exact refreshed governance/configuration/queue/state/Task Card;
3. read issue #135 comments and ACKs;
4. read current PR/head/CI/comments/merge/main facts;
5. reconcile durable facts, including projected `DONE` and recoverable blockers;
6. execute one valid unconsumed current-task Directive, if present;
7. otherwise execute one ordinary closed-state transition.

Directive reconciliation is before ordinary `BLOCKED`/wait/no-op, old repair
fingerprint dedupe, and an unmerged old `PASS`. A unique valid Directive can
mechanically recover `BLOCKED -> IN_PROGRESS`, relaunch the current Worker, and
keep the same task/PR. `PR:null` + `HEAD:null` supports pre-PR and failed-launch
recovery when no PR is bound or discoverable. A Directive never creates a new
task or successor.

Each Directive has a globally unique ID and normalized SHA-256 payload digest.
Successful `LAUNCHED`/`APPLIED` ACK means consumed. Same ID/different payload
fails closed. Deterministic Worker identity and `WORKER_REF` prevent duplicate
launch after ACK loss. An old `DISPATCHER_REPAIR_V1` fingerprint suppresses only
that CI-failure event; a new Directive ID is a new authorization.

## Review, verdict, and completion

After exact-head PR CI success, Dispatcher publishes a Review Context containing:

```text
TASK
PR
CURRENT_HEAD
BASE_MAIN_SHA
TASK_CARD
ALLOWED_SCOPE
ACCEPTED_CONTRACTS
REQUIRED_TESTS
APPLIED_DIRECTIVES
```

Scope/tests are the effective unions and `APPLIED_DIRECTIVES` lists every applied
ID. A successful Directive immediately fences all earlier context/verdict evidence,
even before head change. A valid verdict must match current head and be created
after the valid current-envelope context.

The non-bypassable lifecycle remains:

```text
implementation
-> exact-head PR CI SUCCESS
-> effective-envelope Review Context
-> exact-head Architect review and PASS
-> fresh recheck and merge
-> accepted merge in refreshed current-main ancestry
-> exact-current-main CI SUCCESS
-> three-file state synchronization
-> DONE
-> predefined successor only
```

`PASS` alone never means `DONE`. Main CI is irrelevant before the accepted PASS
head is merged and attributable. A later exact-current-main rerun may mechanically
clear `BLOCKED / MAIN_VERIFY_FAILED` without a new Directive or Architect verdict.

## Files

- [`control-plane.json`](control-plane.json): fixed command-bus discovery and authorized issuers.
- [`architect-directive-v1.md`](architect-directive-v1.md): sole Directive/ACK/idempotency/overlay contract.
- [`transition-contract.md`](transition-contract.md): closed pulse priority and state transitions.
- [`dispatcher-state.json`](dispatcher-state.json): canonical topology plus reconstructable runtime projection.
- [`dispatcher-state.schema.json`](dispatcher-state.schema.json): queue/task projection schema.
- [`worker-profiles/luna-high.json`](worker-profiles/luna-high.json): native Worker profile.
- [`luna-high-launch-contract.md`](luna-high-launch-contract.md): effective-envelope launch and hand-back.
- [`task-card-template.md`](task-card-template.md): base Task Card semantics.
- [`dispatcher-dry-run.mjs`](dispatcher-dry-run.mjs): deterministic reconciliation simulation.
- [`fixtures/reconciliation-cases.json`](fixtures/reconciliation-cases.json): ordinary and Directive fixtures.

Every pulse advances at most one safe stage. Waiting, `NO_READY_TASK`, `REVIEW`,
`BLOCKED`, `DONE`, `DEFERRED`, `next_task:null`, or Owner Checkpoint ends only
that pulse and never disables the persistent dispatcher heartbeat. Only the
Product Owner may disable or delete it.
