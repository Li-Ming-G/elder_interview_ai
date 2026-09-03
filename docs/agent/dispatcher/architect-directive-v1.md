# Architect Directive Protocol V1

This file is the sole durable contract for `ARCHITECT_DIRECTIVE_V1` commands and
`DISPATCHER_DIRECTIVE_ACK_V1` acknowledgements. The standing command bus is the
repository and issue configured by `control-plane.json`. Natural-language
comments, pull-request comments, chat messages, GitHub native reviews, and any
other marker are not execution commands.

The protocol grants the External/Web Architect bounded implementation execution
authority. It does not transfer Product Owner authority over product behavior,
architecture, Accepted Contracts, provider/model/data-policy/cost decisions, or
queue topology.

## Directive marker

A command is exactly one top-level issue comment with this marker and field set:

```text
<!-- ARCHITECT_DIRECTIVE_V1 -->
DIRECTIVE_ID: <globally unique stable id>
TASK: <canonical task id>
PR: <positive integer|null>
HEAD: <full 40-character sha|null>
DECISION_CLASS: IMPLEMENTATION_ONLY
ACTION: IMPLEMENT
ADD_ALLOWED_FILES: <semicolon-separated repository-relative paths or none>
ADD_REQUIRED_TESTS: <semicolon-separated commands or none>
INSTRUCTION: <single-line bounded instruction>
KEEP_SAME_PR: true|false
```

No extra or repeated fields are permitted. `ACTION` has only `IMPLEMENT` in V1.
`DIRECTIVE_ID` is the primary idempotency identity and must match
`^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`. `INSTRUCTION` is a single non-empty line;
line breaks or additional machine fields make the directive invalid.

`PR` and `HEAD` are a pair: both are concrete or both are `null`. A concrete pair
must equal the freshly reconciled canonical PR and its exact current head. A null
pair is permitted only when no PR is bound to or durably discoverable for the
current task. `KEEP_SAME_PR` must be `true` when a concrete PR is supplied. A null
pair may use either value; `false` permits the first Worker to create the task's
canonical PR, while `true` instructs it to reuse one if discovered during launch.

## Mechanical validation

Before ordinary wait/no-op/repair/verdict/merge handling, the Dispatcher reads
the configured issue and considers current-task directives in comment creation
order. A directive is executable only when all of these facts hold:

- `control-plane.json` exists on freshly fetched `origin/main`, is enabled, names
  this protocol, repository, issue, and the directive comment author's exact
  GitHub login; ACKs are accepted only from an exact configured Dispatcher login;
- the comment is top-level and its schema, field set, value forms, and path forms
  are valid;
- `TASK` equals the one canonical runtime task and that task is `READY`,
  `IN_PROGRESS`, `REVIEW`, or `BLOCKED`; `DEFERRED` and `DONE` cannot be revived;
- the Task Card dependencies and entry gates are satisfied from canonical runtime
  facts; its header `Status:` is not a runtime gate;
- the `PR`/`HEAD` pair satisfies the concrete or null freshness rule above;
- the `DIRECTIVE_ID` has no successful acknowledgement, no conflicting payload,
  and no already-running deterministic Worker that still lacks its recovered ACK;
- `DECISION_CLASS` and `ACTION` have their fixed V1 values;
- additive paths are normalized repository-relative paths, contain no glob or
  traversal, and do not target `AGENTS.md`, `AI-DEVELOPMENT-CURRENT.md`,
  `docs/agent/00-task-board.md`, `docs/agent/dispatcher/**`, the Task Card, or any
  Accepted Contract named by the Task Card;
- the command is additive implementation work. The Architect attests this with
  `DECISION_CLASS`; the Dispatcher does not judge technical merit or interpret
  product meaning.

If a bounded instruction or added file would in fact change an Owner-frozen
product decision, an Accepted Contract, an architecture boundary, task identity,
`depends_on`/`next_task`, production provider/model/data-policy/cost, or another
Owner-deferred decision, the Worker must stop with `PRODUCT_AMBIGUITY`. The
Dispatcher never uses technical disagreement as a veto and never treats the
Architect's attestation as authority to cross those boundaries.

## Normalized payload and idempotency

The Dispatcher computes `DIRECTIVE_SHA256` as lowercase SHA-256 hex over the
UTF-8 bytes of the ten directive field lines above, in exactly the documented
order, using `\n` separators, excluding the HTML marker and with no trailing
newline. Field values are trimmed once; semicolon lists preserve their declared
order after trimming each item and removing duplicates.

The first valid payload observed for a `DIRECTIVE_ID` binds that ID. The same ID
with a different normalized digest is `REJECTED_INVALID` and
`PRODUCT_AMBIGUITY`; it is never a correction mechanism. Authors must publish a
new ID. A successful `LAUNCHED` or `APPLIED` ACK consumes the ID permanently.
A rejected exact digest receives at most one rejection ACK and is not retried on
every pulse. A transient launch failure is ACKed as `LAUNCH_FAILED` with
`RESULT: WORKER_LAUNCH_FAILED_ATTEMPT_<n>`. It may be retried only after fresh
reconciliation, with the same deterministic Worker identity, and never more than
three bounded launch attempts; the third failure becomes `WORKER_FAILED`.

Worker identity is deterministic:

```text
architect-directive/<TASK>/<DIRECTIVE_ID>
```

Before any launch the Dispatcher scans existing Codex tasks for that identity.
If the Worker exists but a success ACK was lost, the Dispatcher reconstructs and
publishes `ACTION: APPLIED` with the existing stable `WORKER_REF`; it does not
launch a duplicate.

## Acknowledgement marker

The Dispatcher posts exactly one durable outcome per directive digest to the
same command-bus issue:

```text
<!-- DISPATCHER_DIRECTIVE_ACK_V1 -->
DIRECTIVE_ID: <id>
DIRECTIVE_SHA256: <lowercase 64-character sha256>
TASK: <task id>
PR: <number|null>
HEAD: <full sha|null>
ACTION: LAUNCHED|APPLIED|LAUNCH_FAILED|REJECTED_STALE|REJECTED_INVALID
WORKER_REF: <stable Codex task id|none>
EFFECTIVE_ALLOWED_FILES: <semicolon-separated normalized union|none>
EFFECTIVE_REQUIRED_TESTS: <semicolon-separated normalized union|none>
RESULT: <single-line stable result code>
```

`LAUNCHED` means the deterministic Worker was created successfully. `APPLIED`
means the same Worker was durably rediscovered after ACK loss. Both are successful
consumption and persist the additive overlay snapshot. `LAUNCH_FAILED` is not
successful consumption and uses `WORKER_REF: none`; multiple such ACKs are
permitted only for monotonically numbered attempts 1 through 3. Rejection ACKs
also use `WORKER_REF: none` and do not add an overlay. There may be at most one
success or rejection outcome for a directive digest.

The safe side-effect order is: persist any permitted runtime transition, create
or rediscover the deterministic Worker, then publish the success ACK. The ACK is
the durable source for applied overlay reconstruction; mutable directive text is
not reread as the scope source after successful consumption.

## Effective execution envelope

For the current task until it reaches `DONE`:

```text
Effective Allowed Files
= Task Card base allowed files
+ normalized union of EFFECTIVE_ALLOWED_FILES snapshots from all successful ACKs

Effective Required Tests
= Task Card required tests
+ normalized union of EFFECTIVE_REQUIRED_TESTS snapshots from all successful ACKs
```

All valid successful ACKs for the task remain applied across the first Worker,
repairs, new PR heads, CI repairs, relaunches, and Architect review. An ordinary
`DISPATCHER_REPAIR_V1` fingerprint suppresses only its own CI-failure event; a
new unique valid Directive is a new execution authorization and must still launch.

## Review and merge fence

Successful Directive consumption immediately invalidates every earlier
`ARCHITECT_REVIEW_CONTEXT_V1` and `ARCHITECT_VERDICT_V1`, even if the PR head has
not changed yet. Merge is fenced until implementation produces a reviewable head,
exact-head required PR CI succeeds, and a new Review Context is posted after the
latest successful ACK.

The current Review Context must contain `APPLIED_DIRECTIVES` equal to the ordered
semicolon-separated IDs of every successful task ACK (or `none`). Its
`ALLOWED_SCOPE` and `REQUIRED_TESTS` are the effective unions above. A verdict is
actionable only when it matches the exact current head and was created after that
valid current-envelope Review Context. Directives never bypass implementation,
exact-head CI, review, `PASS`, merge ancestry, exact-current-main CI, `DONE`, or
predefined-successor gates.
