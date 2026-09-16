# GLP-1 Pad

A prescriber companion for GLP-1 receptor agonist therapy. Pick the indication, read the labeled titration schedule, generate the prior authorization letter, print the bilingual handout, and write the note.

- Single HTML file. Runs entirely in the browser, works offline after first load.
- No login, no server, no analytics, no patient identifiers, ever.
- All patient-facing content in English and Spanish with a language toggle.

**GLP-1 Pad does not recommend doses.** Titration screens reproduce the schedule printed in the FDA label and calculate the next calendar date from a start date you enter. No code in this file reads patient characteristics and returns a dose. Every prescribing decision stays with the clinician.

Clinical content is drawn from current FDA prescribing information for semaglutide, tirzepatide, and liraglutide. Values not yet verified against the label carry a `TODO` comment in the source and must be confirmed before release.

Forked from RheumPad by the same author. Commercial license pending; do not redistribute.
