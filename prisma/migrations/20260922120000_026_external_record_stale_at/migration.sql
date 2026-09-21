-- DHB-71: mark failed external-record refresh without blanking the serving snapshot.
ALTER TABLE "external_records"
  ADD COLUMN "stale_at" TIMESTAMPTZ(3);
