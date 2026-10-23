# English expression

Use this reference for English prose and English sections of bilingual documents. Apply the meaning-preservation requirements in `SKILL.md` throughout.

## Verbs, actors, and references

- Prefer a direct verb: “configure the client” instead of “perform the configuration of the client.” Keep a precise technical verb when a simpler substitute would change the operation.
- Use an imperative for an instruction that the reader must perform. Use a descriptive sentence for system behavior. Do not turn a recommendation or permission into an unconditional command.
- Name an actor when the source establishes one and the reader needs it. Passive voice is useful when the actor is unknown or irrelevant: “The key was revoked.” Do not invent an administrator to make that sentence active.
- Put a prerequisite before its dependent action. Keep the scope of “only if,” “unless,” “except,” and “until” intact when splitting sentences.
- Replace an ambiguous “it,” “this,” or “they” with the relevant noun. Keep pronouns that have a clear referent.
- Unpack a noun chain when its relationships are unclear. Keep established terms such as “connection pool” intact; turning every noun phrase into an “of” phrase makes prose harder to read.

## Modality and terminology

- Distinguish obligation (`must`), recommendation (`should`), permission (`may`, `is permitted to`), ability (`can`), and possibility (`may`, `might`, `can`). Determine the intended meaning from context before replacing a modal.
- Use the project's normative definitions when it defines terms such as MUST or SHOULD. Preserve their strength and capitalization where meaningful.
- Keep qualifiers that carry evidence limits: “approximately,” “in this sample,” “usually,” and “may” are not filler when they change the claim.
- Use one term for one concept within the document. Introduce unfamiliar abbreviations when needed; keep API names, command flags, UI labels, and code identifiers exact.
- Prefer familiar words when meanings match. Avoid promotional claims, metaphors, and invented compound labels in technical instructions; name the concrete behavior or result.

## Natural sentences and formatting

- Make each sentence carry a manageable claim or action. Split at a logical boundary and preserve the relationship with words such as “if” or “because” when needed.
- Vary sentence length enough to explain relationships naturally. Do not split every clause or expand a clear short term merely to meet a word-count target.
- Keep articles, number, tense, and countability natural. Use tense to distinguish planned work, observed results, and current behavior.
- Use parallel grammar in lists. Preserve fragments in comments, headings, and UI text when the repository uses them.
- Follow the project's spelling, capitalization, punctuation, and unit conventions. In bilingual text, preserve the same numbers, comparison operators, and units unless an explicit, verified conversion is part of the task.

## Review examples

These examples illustrate editing decisions, not facts about the current project or specimens of verified STE conformity.

| Source | Revision or action | Meaning to preserve |
| --- | --- | --- |
| “When the cache is cold, a request may take approximately 2 s to complete.” | “With a cold cache, a request may take about 2 s.” | The condition, possibility, and approximation remain. |
| “The operator may retry the upload.” | Keep the sentence, or use “The operator is permitted to retry the upload” if permission needs emphasis. | Permission is not an instruction to retry. |
| “Backups should be encrypted.” | Keep the recommendation unless the task authorizes a policy change. | Do not add an actor or change `should` to `must`. |
| “This was not tested on Windows.” | Preserve the explicit statement that Windows testing did not occur. | Do not rewrite it as a failed test or a platform incompatibility. |
| “Close it after it stops.” | Establish which object to close and which operation must stop. | Fluency cannot resolve a missing referent. |
| “Run `tool sync --dry-run` and inspect the output.” | Keep the command exact; separate the two actions if that helps the procedure. | Editing prose does not authorize changing flags or executing the command. |
