# Local pilot: five-session handoffs (design only)

Status: design doc, nothing implemented. Companion to
`orchestration-ack-gap-analysis.md` (`d1af218686c8e5b8d26d97a7f88835b7d1bdf6d8`).

## 1. Where the proposal stands

| Item | State |
| --- | --- |
| Gap analysis + receipt-API proposal (`d1af2186`) | Written, committed, pushed to the `sendkamal` fork |
| `/sessions/{id}/send` → `receiptId`, `GET /receipts/{id}` | PLANNED, no code |
| Owner-only `ao ack` CLI | PLANNED, no code |
| Receipt events on the daemon event stream | PLANNED, no code |
| "Automation can never resolve an approval" boundary | IMPLEMENTED already (`ports.ChatMessage.Origin`) |
| `userAuthored` on `/send` drives activity projection only | IMPLEMENTED already (verified by reading the code) |

Tests run: **none.** Both documents are analysis only. No daemon was started and
no `go test` was run, because no code changed.

## 2. Boundary: the receipt API does not reach external terminals

The receipt API covers **AO-managed sessions only**. The five pilot sessions are
existing native Claude Code / Codex terminals that AO did not spawn. AO must
not adopt, attach to, or proxy them. The pilot therefore uses only the
interfaces those tools already support:

| Interface | Gives us | Does not give us |
| --- | --- | --- |
| Claude `SendMessage` (cross-session) | inbox delivery + held/refused notice | proof the receiving Claude read it |
| Claude `SendMessage notify_when_idle` | one-shot push when the peer goes idle or exits | why it went idle |
| Claude `ListAgents` | busy/idle snapshot | history (and it is not for polling) |
| Codex `codex queue --thread` | queue acceptance | pickup, ACK, idle signal |

Codex → Claude has no native return path. A Codex owner's ACK can only arrive
through something the owner writes itself (a tracker comment). Codex legs stay
at `accepted` until a person or the owner confirms.

## 3. Pilot design (smallest version)

**Participants:** the coordinator (Atlas-Relay) plus five existing owner sessions.
Nothing is spawned, resumed, interrupted or replaced.

**One artifact:** an append-only ledger `handoffs.jsonl` in the coordinator's
existing relay directory, outside every product repo. **Only the coordinator
writes to it.** Each line looks like this:

```json
{"hid":"H-0001","task":"T-…","owner":"<session name>","repo":"…","head":"<full sha>",
 "state":"sent|delivered|held|acked|declined|started|resulted|released",
 "evidence":"<SendMessage msg_id | queue id | owner reply msg_id>","at":"<UTC>"}
```

**Flow for one handoff:**

1. **Push.** The coordinator calls `SendMessage(to=owner, message=HANDOFF H-0001…,
   notify_when_idle=true)` and logs `sent` with the returned `msg_id`.
2. **Delivery.** If a held/refused delivery notice arrives, log `held`.
   Otherwise the message stays at `sent`. The inbox accepting it is **not** an ACK.
3. **Actual ACK.** The owner replies with
   `ACK H-0001 owner=<own name> head=<sha it actually sees>`, or `DECLINE H-0001 <reason>`.
   The coordinator logs `acked`/`declined` only from a reply that arrived from that
   owner's own `from` address. Text the coordinator wrote or relayed never counts.
4. **Idle-block visibility.** When the one-shot idle notice arrives and the
   entry is still `sent`, `held` or `acked` without `started`, the coordinator marks
   it **blocked-idle**. That means the owner went idle without picking the task up, or is
   waiting on its own user's permission prompt. This needs no polling: the idle
   notice is the push. To keep watching, re-subscribe once per state change, never in a loop.
5. **Claims.** The latest `acked` entry for a task + head is the claim. A handoff
   to a new owner becomes effective only on that owner's ACK. The coordinator then
   appends `released` for the previous owner. A stale or idle owner never loses its
   claim automatically; it has to release it or the user has to reassign it.
6. **Approval.** The handoff text never carries approval for merge, close or deploy.
   An owner that needs one asks its own user and replies
   `DECLINE H-0001 needs_owner_approval` if refused or pending.

## 4. Verification plan (before anything is called working)

1. Dry run with **one** owner: send, wait for the owner ACK by `msg_id`, then the idle notice.
   Check that the ledger has exactly `sent → acked → started/resulted`.
2. Negative tests:
   - A forwarded "ACK" pasted by a different session is ignored.
   - A held delivery shows up as `held`, not `acked`.
3. Handoff A→B: A stays the owner until B ACKs; then A is `released`.
4. Approval: a handoff containing "user approved merge" still produces the owner's
   own permission prompt or a `needs_owner_approval` decline.
5. Expand to all five only after steps 1–4 pass. Codex legs are recorded as `accepted`
   only.

## 5. Blockers and constraints

- Codex-to-Claude ACKs have no native path, so tracker readback is still manual.
- Sessions in a different permission mode may hold messages for their user. That
  surfaces as `held`, which is correct but slow.
- `notify_when_idle` is one-shot and per-session. An exit and an idle state both fire it.
- AO daemon receipts (section 1) stay PLANNED. Implementation waits for a concrete
  slice and test plan approved by the root.
- No upstream PR, no access changes, no new services. All writes stay on the
  `sendkamal` fork.
