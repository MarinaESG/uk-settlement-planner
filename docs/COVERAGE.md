# Sources and coverage

Review date: **19 October 2026**. This is a source-linked catalogue, not a legal certification or a promise of automatic updates.

The catalogue is based on the official [settlement overview](https://www.gov.uk/indefinite-leave-to-remain) and [Immigration Rules index](https://www.gov.uk/guidance/immigration-rules). Each entry in `src/catalogue.js` retains its own official link and review date. Catalogue entries include grouped routes, legacy provisions, an alternative scheme and signposts; the entry count is not a count of distinct legal routes.

| Coverage level | Implemented |
| --- | --- |
| All 33 catalogue/signpost entries | Record keeping, references, review notes and backups |
| Long residence only | Absence arithmetic and exception-review flags |
| Other routes | No automatic eligibility, qualifying-period, income or absence-rule calculation |
| Specialist/uncatalogued provisions | Full Rules index signpost; individual analysis not implemented |

The broad catalogue includes the main work routes and their family members; legacy business routes; partner, parent, child, adult-relative and adoption provisions; private life and long residence; protection and relevant family routes; ARAP; armed forces and specified veterans; ancestry; BN(O); statelessness; and returning residents. EU settled status is identified separately. Student/Graduate is a signpost, not a direct settlement route. Route closure, transitional eligibility and individual circumstances still require source review.

## Long-residence method

Primary sources:

- [Appendix Long Residence](https://www.gov.uk/guidance/immigration-rules/immigration-rules-appendix-long-residence).
- [Appendix Continuous Residence](https://www.gov.uk/guidance/immigration-rules/immigration-rules-appendix-continuous-residence), especially CR 3.1–3.4.
- [Continuous residence caseworker guidance](https://www.gov.uk/government/publications/continuous-residence-caseworker-guidance/continuous-residence-guidance-accessible-version), including the transitional examples and whole-day method.

The indicators exclude departure and arrival days. For trips starting before 11 April 2024, a full-trip indicator flags more than 184 days; the aggregate counts only whole days before that date within the selected review period and flags more than 548. Trips starting on or after the cutoff feed the rolling calendar-year indicator, which flags more than 180 days. A trip beginning before the cutoff is not included in the post-change rolling calculation. Overlapping records contribute unique days once and produce a reconciliation flag.

The selected period is a user proposal, not a verified qualifying period. Boundary-crossing trips are flagged. Exceptions are not adjudicated or deducted. Records outside the period remain visible for review. The tool does not determine permission continuity, lawful residence, excluded categories, evidence sufficiency or eligibility. Results are not an application recommendation.

## Change control

For each rule change, record the source URL, publication/effective date, affected routes, changed behaviour, boundary tests and reviewer approval. Preserve old calculations only with a clearly labelled rules version. Do not silently represent a content refresh as a legal review.

An independent route-by-route legal review, historical rule versions, complete specialist coverage and a systematic update service are **outstanding** for any wider eligibility product. No user should infer those capabilities from this release.
