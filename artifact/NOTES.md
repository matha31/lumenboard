# Artifact design notes

Layout: three risk buckets (Urgent / Watch / Healthy) instead of a flat table.
Each account card: name, MRR, renewal date, one-line reason for its bucket.

Drill-down per account: usage sparkline + event-type breakdown, including positive
signals (seat_added, invite_sent), not just decline indicators.

Controls: filter by plan tier, renewal window (30/60/90 days), MRR; persist last
filter (localStorage); auto-refresh on open + manual reload.

See ../docs/NOTES.md for the fuller rationale.
