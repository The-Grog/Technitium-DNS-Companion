# Advanced Blocking timed pause recovery

Companion owns the Advanced Blocking timer. It persists the original root
`enableBlocking` value (including absence) before attempting a remote write.
The browser session is needed only for interactive admission; reconciliation uses
the configured schedule credential.

## Writes and topology

Interactive pause, extension, and Resume now require Apps: Modify on the exact
schedule-resolved write endpoint. Every Advanced Blocking writer uses the same
canonical per-target gate and requires confirmed standalone or cluster topology.
Queued operations re-resolve the current Primary after acquiring that gate.
A changed endpoint causes a conflict so the caller can retry with fresh admission.

Config reads and writes validate Technitium's response envelope. An unavailable
or malformed config never becomes an empty replacement document. Activation
and restoration both verify the live root before reporting completion.
Restoration patches the current JSONC document, retaining concurrent group,
list, mapping, comment, and unknown-field changes.

The gate serializes writers within one Companion process. It does not provide a
distributed lock between separate Companion instances or atomic compare-and-swap
against independent Technitium UI/API clients.

## Recovery

Resume now persists an immediate expiry after admission. A failure therefore
remains a restore request across subsequent ticks and restarts; it cannot be
mistaken for a request to reactivate the pause. Schedule reconciliation must
finish before a captured root is restored.

New intents record that their baseline must be captured before a remote write.
If such an intent expires without a captured baseline, Companion cancels it
inside the mutation gate without changing remote config. Migrated records with
unknown baselines retain conservative legacy semantics: they remain visible
for manual recovery, do not impose a new false root, and block config edits that
would otherwise invent or overwrite their original state.

Failed live verification is reported as unconfirmed. Initial unreadable nodes
are reported in the operation's probe errors; they are not silently counted as
paused or given unattended write ownership. A successful app inventory can
distinguish an installation without Advanced Blocking from an unreadable node.

## Schedule credentials in native clusters

Technitium tokens can be node-local. A scalar schedule token or version-1 group
token issued by the confirmed current Primary is sufficient for Primary-only
Advanced Blocking writes when it has Apps: Modify. A rejected or unreachable
Secondary does not revoke that capability. Companion uses the authenticated
Primary's topology response for the cluster and rechecks the exact target's
credential and role immediately before each schedule config POST.

Schedule status exposes `primaryCredential`, `failoverCoverage`, and
`secondaryCredentialUnavailableNodeIds`, alongside the existing admitted,
failed, and unreachable node lists. A Primary can be ready with partial failover
coverage. Cache flush admission remains per node; an unavailable Secondary is
not authorized for cache deletion by the Primary's token.

Scalar and version-1 group tokens do **not** provide unattended failover when
tokens are node-local. If a different node becomes Primary, writes fail closed.
Configure a schedule token issued by the new Primary, restart Companion to load
the changed secret, and revalidate DNS Schedules credentials. Existing pause
ownership is retained for recovery; it is not proof that restoration succeeded.

Missing or unusable admission returns HTTP 503 with credential/routing guidance.
The dependency lockfile keeps Nest's common package shared with its HTTP layer,
so these exceptions retain their intended HTTP status and message.

### Proposed per-node credential map (not implemented)

A future version-2 schedule map can use
`groups[groupId] = { username, nodes: { [configuredNodeId]: { token } } }`.
The loader must reject unknown/cross-group node IDs, duplicate keys, mixed
group-token/node-token entries, and invalid schemas without including secrets
in errors. Version-1 and scalar loading must remain backward compatible.

Both initial validation and returning-node recovery must select only the token
for the exact configured endpoint. A validated topology determines the current
Primary; only its independently authenticated token and Apps: Modify permission
admit a write. No other node's token or interactive session may be substituted.
Coverage is complete only when all potential configured Primary endpoints have
validated credentials and consistent topology/identity. V2 must be implemented
across loading, request selection, revalidation, status, and failover tests
together; this fix does not accept a version-2 map.

## Other writers and UI

Configuration Sync reads configured root state underneath any pause override,
so a source pause cannot become a destination's permanent disabled state.
It also passes the destination revision to the shared mutation path.
Domain Groups apply/import, rule optimization, DNS Schedules, comment editing,
raw saves, and History restore retain a pause-owned false root.

The header handles Built-in and Advanced Blocking independently, including when
both are enabled on one node. Pending restoration keeps Resume now visible.
Mixed-operation errors remain errors even when another method succeeds.

## Validation boundary

Regression suites exercise real pause, SQLite state, Advanced Blocking,
Configuration Sync, Domain Groups, History, and DNS Schedule code with simulated
Technitium transport. React tests exercise the rendered header and handlers.
These checks do not establish live cluster failover, real container restart,
or browser/mobile visual correctness.
