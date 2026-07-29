# Mode: outcome

Record or update an outcome for a role:
- `offer` | `reject` | `withdraw` | `ghost`
- date
- short reason / `note` (user-provided only)

For **offer** outcomes, also write structured fields when the user provides them (never invent numbers):
- `base` (number)
- `bonus` (number)
- `currency` (e.g. `USD`)
- `equity_notes` (free text)
- `remote` (`remote` | `hybrid` | `onsite` | custom)
- `deadline` (YYYY-MM-DD)

Write back into the board pack `outcomes` map keyed by role id, or instruct the user how to paste into Settings. Never invent reasons or compensation.
