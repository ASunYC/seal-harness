# @seal-harness/compaction-llm

Summarizes old conversation history through `ModelService` before retaining a recent user-boundary
window. The summarizer receives no tools and cannot enter the Agent loop. Provider failures fall
back to the deterministic window summary; cancellation is always propagated.
