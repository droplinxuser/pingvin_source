-- Profile pictures live on disk and are versioned by this timestamp.
ALTER TABLE "User" ADD COLUMN "avatarUpdatedAt" DATETIME;
