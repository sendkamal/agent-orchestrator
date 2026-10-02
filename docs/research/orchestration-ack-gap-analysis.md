# Orchestration ACK / ownership gap analysis

Status: research note, analysis only. No code changes. Base: `8213dff60`.

## What exists today

- **Daemon boundary.** `POST /api/v1/sessions/{id}/send`
  (`backend/internal/httpd/controllers/sessions.go`) queues a message to an
  AO-managed session. It returns `{ok, sessionId, message}`. That result means
  *accepted for delivery*. It does not mean the receiver picked the message up.
- **Delegation.** `POST /api/v1/orchestrators/delegate` spawns a worker with an
  explicit `approvalMode`. `POST /sessions/{id}/pr/claim` binds a PR to a session.
- **Approval boundary already in code.** `ports.ChatMessage.Origin` is
  documented as *"Automation shares the queue with the user and can never resolve
  an approval."* The `userAuthored` flag on `/send` only drives
  activity projection (`RecordSessionHumanMessage`). It does not grant any
  authority.
- **External relay (outside this repo).** Codex `queue` deliveries and Claude
  Code cross-session `SendMessage` are both transport-only. The October 1
  inspection already notes that queue acceptance is not pickup and that no
  ACK came back for PORTFOLIO-CHANNEL-1001.

## Gaps

1. **No delivery-state ladder.** Callers can't tell these states apart:
   `accepted` (queued), `delivered` (the receiving agent's turn consumed it),
   `acknowledged` (the owner explicitly accepted the task), and
   `started`/`resulted`. Every relay ends up inferring these from tracker
   comments.
2. **No first-class task claim.** Ownership is tracked by convention (tracker
   rows and receipt JSON files). The only daemon-level claim is
   `pr/claim`. Nothing records "task T is owned by session S at head H", and
   nothing gives a handoff receipt for a transfer.
3. **Approval context is ambiguous across hops.** When a user's approval is
   forwarded as message text, it reaches the receiver as delegated content.
   Local autoreview correctly refused to merge or close on that basis, twice.
   **This is the boundary working, not a bug.** The gap is that there is no
   supported way for the receiver to tell its *own* user "a peer asks for X,
   please approve here". Without that, operators reach for workarounds.

## Proposal: one minimal extension

Add a **message receipt record** to the existing `/send` path, plus one
read endpoint. Do not add a new coordinator or a new transport.

```
POST /api/v1/sessions/{id}/send  -> adds  receiptId  to the response
GET  /api/v1/receipts/{receiptId} -> { state, sessionId, taskId?, headSha?,
                                       acceptedAt, deliveredAt?, ackedAt?,
                                       ackBy?, outcome? }
state: accepted | delivered | acked | declined | started | resulted | expired
```

- **accepted / delivered** are set by the daemon. `delivered` is set when the
  session manager hands the message to the agent's turn. This is a fact the
  daemon already observes.
- **acked / declined / started / resulted** can be set **only by the receiving
  session itself**, via `ao ack <receiptId> [--decline] [--task T --head SHA]`.
  The CLI resolves the caller's session from its environment. A peer can't ACK
  on behalf of an owner.
- **Ownership:** an `acked` receipt carrying `taskId` + `headSha` is the claim
  record. A handoff is a new `/send` to the new owner. Ownership transfers only
  when the new owner ACKs, and the old receipt moves to `resulted` with
  `outcome: handed_off`. A stale heartbeat never transfers a claim.
- **Approval:** receipts carry **no** approval field, by design. If a task
  needs a privileged action (merge, close, deploy), the receiver raises it in
  its own session's normal permission prompt, which its own user answers. The
  receipt can show `declined: needs_owner_approval` so the sender learns
  *why* the task stalled, without anyone forging user context.
- **Push vs. poll:** expose receipt transitions on the daemon's existing event
  stream. The relay subscribes once and needs no new polling loop.

## Explicit non-goals

- No mechanism lets a peer or relay message satisfy another session's approval
  prompt.
- No adoption of external, non-AO terminals. No new credentials. No
  scheduler.

## Verification (when implemented, separately approved)

1. Unit: receipt state machine. Owner-only transitions; `delivered` can't be
   set by an API caller.
2. Integration: `/send` → receipt `accepted` → agent turn → `delivered` →
   `ao ack` from the target session → `acked`. An `ao ack` from a different
   session → 403.
3. Handoff: A acked, send to B, B acks → A `resulted/handed_off`, B owner.
4. Approval: a message whose text says "user approved merge" still triggers the
   receiver's own permission prompt. The receipt shows `declined:
   needs_owner_approval` if the prompt is refused.

## Blockers / constraints

- The daemon isn't running locally (per the inspection). Nothing here was
  executed.
- External Codex threads aren't AO-managed, so the receipts apply only to
  AO sessions. Bridging Codex needs a supported event interface. That remains
  unproven.
- Implementation, push, and PR need separate user approval.
