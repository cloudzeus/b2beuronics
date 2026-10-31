-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "s1Trdr" INTEGER,
    "name" TEXT NOT NULL,
    "afm" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "s1BranchId" INTEGER,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "secretsEnc" TEXT,
    "secretKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secretsSetAt" TIMESTAMP(3),
    "storeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "lastTestAt" TIMESTAMP(3),
    "lastOkAt" TIMESTAMP(3),
    "eventAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectionTest" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "sample" JSONB NOT NULL,
    "locations" JSONB NOT NULL,
    "total" INTEGER,
    "fieldHints" JSONB,
    "requestedBy" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,

    CONSTRAINT "ConnectionTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationMap" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "storeId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushKey" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PushKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundBatch" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "accepted" INTEGER NOT NULL,
    "rejected" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "gz" BYTEA NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestNonce" (
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestNonce_pkey" PRIMARY KEY ("nonce")
);

-- CreateIndex
CREATE UNIQUE INDEX "Partner_s1Trdr_key" ON "Partner"("s1Trdr");

-- CreateIndex
CREATE UNIQUE INDEX "Store_s1BranchId_key" ON "Store"("s1BranchId");

-- CreateIndex
CREATE INDEX "Store_partnerId_idx" ON "Store"("partnerId");

-- CreateIndex
CREATE INDEX "Connection_partnerId_idx" ON "Connection"("partnerId");

-- CreateIndex
CREATE INDEX "Connection_status_idx" ON "Connection"("status");

-- CreateIndex
CREATE INDEX "ConnectionTest_connectionId_startedAt_idx" ON "ConnectionTest"("connectionId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LocationMap_connectionId_externalRef_key" ON "LocationMap"("connectionId", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "PushKey_hash_key" ON "PushKey"("hash");

-- CreateIndex
CREATE INDEX "PushKey_connectionId_idx" ON "PushKey"("connectionId");

-- CreateIndex
CREATE INDEX "InboundBatch_connectionId_receivedAt_idx" ON "InboundBatch"("connectionId", "receivedAt");

-- CreateIndex
CREATE INDEX "InboxEvent_receivedAt_idx" ON "InboxEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "RequestNonce_expiresAt_idx" ON "RequestNonce"("expiresAt");

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectionTest" ADD CONSTRAINT "ConnectionTest_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationMap" ADD CONSTRAINT "LocationMap_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationMap" ADD CONSTRAINT "LocationMap_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushKey" ADD CONSTRAINT "PushKey_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundBatch" ADD CONSTRAINT "InboundBatch_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

