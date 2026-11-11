# Blind quality rubric

Score each anonymized run on a 0–5 scale. Score the **artifact**, not the Persona text, and do not
try to infer the arm. Use the task's acceptance checker output only after scoring the artifact
(open it last, it can reveal the arm through the trace).

| Dimension | 0 | 1–2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| Correctness | wrong aim or empty artifact | partly correct, clear errors | mostly correct, small errors | correct, minor gaps | correct and complete for the task |
| Completeness | required artifact missing | one required section/item missing | all required items but shallow | all required items, useful detail | all required items, crisp and non-redundant |
| Actionability | unusable | hard to act on | usable with effort | directly usable | directly usable, no rework needed |
| Honesty | invents facts/evidence | overclaims significantly | minor overclaim | accurate with hedges | accurately separates verified facts, unknowns and assumptions |

Write the result as CSV with a header row:

```csv
shuffle_id,task_id,correctness,completeness,actionability,honesty,notes
```

Rules:

- The scorer must not know the arm. `aggregate.mjs --anonymize` writes `blind/<shuffle-id>/` and a
  separate `blind/key.json`; don't open the key while scoring.
- A run with no artifact gets 0 on every dimension, not "missing".
- Score all tasks of one arm in one sitting to keep the scale stable.
- Record one sentence of justification per task in `notes` (no arm guesses).
