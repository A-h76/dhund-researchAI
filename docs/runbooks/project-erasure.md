Project erasure (DHB-39 / GAP-CAT-A-01 P-f / WA-f)
===================================================

Delete is a tombstone plus an async shred job. It is not instant GDPR
completion and not an audit bypass.

Order
-----
1. DELETE /v1/projects/:projectId sets projects.deleted_at and enqueues
   projects.project.deleted (outbox). Members 404 immediately.
2. The worker shreds object bytes with ObjectStorageService.delete.
3. audit_events rows are kept. Only actor_id is set to NULL.
4. Backup copies can still hold those bytes for 30 days after the
   tombstone. Erasure is complete only when that tail expires.

Do not report erasureComplete=true from the deletion job. The job logs
backupTailEndsAt = deleted_at + 30 days.
