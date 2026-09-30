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
