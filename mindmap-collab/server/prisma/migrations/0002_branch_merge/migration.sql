-- AlterTable
ALTER TABLE "Snapshot" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "opSeq" INTEGER;

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "yjsState" BYTEA,
    "baseBranchId" TEXT,
    "baseVector" JSONB,
    "forkState" BYTEA,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operation" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "branchId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "type" TEXT NOT NULL DEFAULT 'update',
    "update" BYTEA,
    "vector" JSONB,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MergeRequest" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sourceBranchId" TEXT NOT NULL,
    "targetBranchId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "mergeKey" TEXT NOT NULL,
    "conflicts" JSONB,
    "resolutions" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mergedAt" TIMESTAMP(3),
    "mergedById" TEXT,

    CONSTRAINT "MergeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "documentId" TEXT,
    "branchId" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Branch_documentId_idx" ON "Branch"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "Operation_seq_key" ON "Operation"("seq");

-- CreateIndex
CREATE INDEX "Operation_branchId_seq_idx" ON "Operation"("branchId", "seq");

-- CreateIndex
CREATE INDEX "Operation_branchId_createdAt_idx" ON "Operation"("branchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MergeRequest_mergeKey_key" ON "MergeRequest"("mergeKey");

-- CreateIndex
CREATE INDEX "MergeRequest_documentId_status_idx" ON "MergeRequest"("documentId", "status");

-- CreateIndex
CREATE INDEX "AuditLog_documentId_createdAt_idx" ON "AuditLog"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "Snapshot_branchId_opSeq_idx" ON "Snapshot"("branchId", "opSeq");

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

