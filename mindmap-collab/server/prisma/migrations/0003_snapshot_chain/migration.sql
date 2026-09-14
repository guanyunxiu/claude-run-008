-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "protected" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Snapshot" ADD COLUMN     "baseSnapshotId" TEXT,
ADD COLUMN     "checksum" TEXT,
ADD COLUMN     "chunked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "compression" TEXT,
ADD COLUMN     "formatVersion" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'full';

-- CreateTable
CREATE TABLE "SnapshotChunk" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "SnapshotChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SnapshotChunk_snapshotId_index_key" ON "SnapshotChunk"("snapshotId", "index");

-- AddForeignKey
ALTER TABLE "SnapshotChunk" ADD CONSTRAINT "SnapshotChunk_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

