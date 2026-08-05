## REMOVED Requirements

### Requirement: Transcript punctuation uses a strict Azure Responses contract

**Reason**: The canonical MAI transcript is now the immutable text authority;
an additional Luna transcript-polishing request adds cost and latency and is no
longer part of the approved pipeline.

**Migration**: Preserve historical punctuation ledger and artifact fields for
read/settlement compatibility, but do not configure or invoke a punctuation
provider for newly claimed jobs.

### Requirement: Transcript punctuation remains fidelity guarded and best effort

**Reason**: No new transcript-polishing request is issued, so a runtime fallback
contract for that removed request is no longer maintained.

**Migration**: Derive display text deterministically from provider text and
retain existing historical output without rewriting it.
