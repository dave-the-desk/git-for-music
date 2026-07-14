-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "GroupMemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "ProcessingJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "ProcessingJobType" AS ENUM ('WAVEFORM', 'TRANSCODE', 'NORMALIZE', 'STEM_SPLIT', 'TEMPO_ANALYSIS', 'KEY_ANALYSIS', 'TIME_STRETCH_TO_PROJECT', 'PROJECT_RETEMPO_FROM_TRACK');

-- CreateEnum
CREATE TYPE "TrackVersionOperationType" AS ENUM ('ORIGINAL', 'TIME_STRETCH');

-- CreateEnum
CREATE TYPE "TempoSource" AS ENUM ('MANUAL', 'ANALYZED', 'IMPORTED');

-- CreateEnum
CREATE TYPE "KeySource" AS ENUM ('MANUAL', 'ANALYZED', 'IMPORTED');

-- CreateEnum
CREATE TYPE "DemoVersionKind" AS ENUM ('AUTO', 'SEMANTIC', 'EXPLICIT', 'REVERT', 'BRANCH', 'MERGE');

-- CreateEnum
CREATE TYPE "AudioAssetKind" AS ENUM ('ORIGINAL', 'DERIVED', 'PEAKS', 'ANALYSIS');

-- CreateEnum
CREATE TYPE "PluginVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "PluginBundleKind" AS ENUM ('SINGLE_MODULE', 'ZIP_BUNDLE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "id" TEXT NOT NULL,
    "role" "GroupMemberRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Demo" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "Demo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoVersion" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "kind" "DemoVersionKind" NOT NULL DEFAULT 'EXPLICIT',
    "operationSeq" INTEGER,
    "tempoBpm" DOUBLE PRECISION,
    "timeSignatureNum" INTEGER NOT NULL DEFAULT 4,
    "timeSignatureDen" INTEGER NOT NULL DEFAULT 4,
    "musicalKey" TEXT,
    "tempoSource" "TempoSource" NOT NULL DEFAULT 'MANUAL',
    "keySource" "KeySource" NOT NULL DEFAULT 'MANUAL',
    "parentId" TEXT,
    "isMerge" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "demoId" TEXT NOT NULL,

    CONSTRAINT "DemoVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoVersionParent" (
    "versionId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "DemoVersionParent_pkey" PRIMARY KEY ("versionId","parentId","order")
);

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "demoId" TEXT NOT NULL,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackVersion" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sourceFileUrl" TEXT,
    "startOffsetMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "sampleRate" INTEGER,
    "channels" INTEGER,
    "mimeType" TEXT,
    "sizeBytes" BIGINT,
    "checksum" TEXT,
    "isDerived" BOOLEAN NOT NULL DEFAULT false,
    "operationType" "TrackVersionOperationType" NOT NULL DEFAULT 'ORIGINAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parentTrackVersionId" TEXT,
    "processingJobId" TEXT,
    "trackId" TEXT NOT NULL,
    "demoVersionId" TEXT NOT NULL,

    CONSTRAINT "TrackVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "startMs" DOUBLE PRECISION NOT NULL,
    "endMs" DOUBLE PRECISION NOT NULL,
    "timelineStartMs" DOUBLE PRECISION,
    "gainDb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fadeInMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fadeOutMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isMuted" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "trackVersionId" TEXT NOT NULL,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingJob" (
    "id" TEXT NOT NULL,
    "type" "ProcessingJobType" NOT NULL,
    "status" "ProcessingJobStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "error" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "trackVersionId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoUserActiveVersion" (
    "id" TEXT NOT NULL,
    "demoId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activeVersionId" TEXT NOT NULL,
    "isFollowingHead" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoUserActiveVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "timestampMs" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "demoId" TEXT NOT NULL,
    "trackId" TEXT,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "groupId" TEXT,
    "projectId" TEXT,
    "demoId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Annotation" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "timestampMs" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trackVersionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,

    CONSTRAINT "Annotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LyricSegment" (
    "id" TEXT NOT NULL,
    "startMs" DOUBLE PRECISION NOT NULL,
    "endMs" DOUBLE PRECISION NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "trackVersionId" TEXT NOT NULL,

    CONSTRAINT "LyricSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "notes" TEXT,

    CONSTRAINT "EquipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectEquipmentRequirement" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "projectId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,

    CONSTRAINT "ProjectEquipmentRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectOperationLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "demoId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "baseSnapshotId" TEXT,
    "baseOperationSeq" INTEGER NOT NULL,
    "operationSeq" INTEGER NOT NULL,
    "operationType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,
    "clientOperationId" TEXT NOT NULL,

    CONSTRAINT "ProjectOperationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "demoId" TEXT NOT NULL,
    "operationSeq" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudioAssetMetadata" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "demoId" TEXT NOT NULL,
    "trackId" TEXT,
    "trackVersionId" TEXT,
    "assetKind" "AudioAssetKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sampleRate" INTEGER NOT NULL,
    "bitDepth" INTEGER NOT NULL,
    "channelCount" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "checksum" TEXT NOT NULL,
    "parentAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudioAssetMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluginMetadata" (
    "id" TEXT NOT NULL,
    "pluginKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "description" TEXT,
    "version" TEXT NOT NULL,
    "manufacturer" TEXT,
    "parameterSchema" JSONB NOT NULL,
    "ownerId" TEXT,
    "visibility" "PluginVisibility" NOT NULL DEFAULT 'PRIVATE',
    "moduleObjectKey" TEXT,
    "bundlePrefix" TEXT,
    "bundleKind" "PluginBundleKind",
    "sizeBytes" BIGINT,
    "checksum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluginMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluginGrant" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "demoId" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PluginGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Group_slug_key" ON "Group"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_groupId_userId_key" ON "GroupMember"("groupId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_groupId_slug_key" ON "Project"("groupId", "slug");

-- CreateIndex
CREATE INDEX "DemoVersionParent_versionId_order_idx" ON "DemoVersionParent"("versionId", "order");

-- CreateIndex
CREATE INDEX "DemoVersionParent_parentId_order_idx" ON "DemoVersionParent"("parentId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "TrackVersion_processingJobId_key" ON "TrackVersion"("processingJobId");

-- CreateIndex
CREATE UNIQUE INDEX "DemoUserActiveVersion_demoId_userId_key" ON "DemoUserActiveVersion"("demoId", "userId");

-- CreateIndex
CREATE INDEX "Comment_demoId_createdAt_idx" ON "Comment"("demoId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_trackId_createdAt_idx" ON "Comment"("trackId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_trackId_timestampMs_idx" ON "Comment"("trackId", "timestampMs");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_groupId_idx" ON "Notification"("groupId");

-- CreateIndex
CREATE INDEX "Notification_demoId_idx" ON "Notification"("demoId");

-- CreateIndex
CREATE INDEX "ProjectOperationLog_projectId_operationSeq_idx" ON "ProjectOperationLog"("projectId", "operationSeq");

-- CreateIndex
CREATE INDEX "ProjectOperationLog_demoId_operationSeq_idx" ON "ProjectOperationLog"("demoId", "operationSeq");

-- CreateIndex
CREATE INDEX "ProjectOperationLog_actorUserId_createdAt_idx" ON "ProjectOperationLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectOperationLog_baseSnapshotId_idx" ON "ProjectOperationLog"("baseSnapshotId");

-- CreateIndex
CREATE INDEX "ProjectOperationLog_idempotencyKey_idx" ON "ProjectOperationLog"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProjectOperationLog_clientOperationId_idx" ON "ProjectOperationLog"("clientOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectOperationLog_demoId_operationSeq_key" ON "ProjectOperationLog"("demoId", "operationSeq");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectOperationLog_demoId_idempotencyKey_key" ON "ProjectOperationLog"("demoId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectOperationLog_demoId_clientOperationId_key" ON "ProjectOperationLog"("demoId", "clientOperationId");

-- CreateIndex
CREATE INDEX "ProjectSnapshot_projectId_operationSeq_idx" ON "ProjectSnapshot"("projectId", "operationSeq");

-- CreateIndex
CREATE INDEX "ProjectSnapshot_demoId_operationSeq_idx" ON "ProjectSnapshot"("demoId", "operationSeq");

-- CreateIndex
CREATE INDEX "ProjectSnapshot_createdById_createdAt_idx" ON "ProjectSnapshot"("createdById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AudioAssetMetadata_storageKey_key" ON "AudioAssetMetadata"("storageKey");

-- CreateIndex
CREATE INDEX "AudioAssetMetadata_projectId_createdAt_idx" ON "AudioAssetMetadata"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AudioAssetMetadata_demoId_createdAt_idx" ON "AudioAssetMetadata"("demoId", "createdAt");

-- CreateIndex
CREATE INDEX "AudioAssetMetadata_trackId_createdAt_idx" ON "AudioAssetMetadata"("trackId", "createdAt");

-- CreateIndex
CREATE INDEX "AudioAssetMetadata_trackVersionId_createdAt_idx" ON "AudioAssetMetadata"("trackVersionId", "createdAt");

-- CreateIndex
CREATE INDEX "AudioAssetMetadata_assetKind_idx" ON "AudioAssetMetadata"("assetKind");

-- CreateIndex
CREATE INDEX "AudioAssetMetadata_parentAssetId_idx" ON "AudioAssetMetadata"("parentAssetId");

-- CreateIndex
CREATE INDEX "PluginMetadata_pluginKey_idx" ON "PluginMetadata"("pluginKey");

-- CreateIndex
CREATE INDEX "PluginMetadata_ownerId_idx" ON "PluginMetadata"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "PluginMetadata_pluginKey_version_key" ON "PluginMetadata"("pluginKey", "version");

-- CreateIndex
CREATE INDEX "PluginGrant_demoId_idx" ON "PluginGrant"("demoId");

-- CreateIndex
CREATE INDEX "PluginGrant_pluginId_idx" ON "PluginGrant"("pluginId");

-- CreateIndex
CREATE UNIQUE INDEX "PluginGrant_pluginId_demoId_key" ON "PluginGrant"("pluginId", "demoId");

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Demo" ADD CONSTRAINT "Demo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Demo" ADD CONSTRAINT "Demo_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "DemoVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoVersion" ADD CONSTRAINT "DemoVersion_demoId_fkey" FOREIGN KEY ("demoId") REFERENCES "Demo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoVersion" ADD CONSTRAINT "DemoVersion_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DemoVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoVersionParent" ADD CONSTRAINT "DemoVersionParent_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DemoVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoVersionParent" ADD CONSTRAINT "DemoVersionParent_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DemoVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_demoId_fkey" FOREIGN KEY ("demoId") REFERENCES "Demo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackVersion" ADD CONSTRAINT "TrackVersion_parentTrackVersionId_fkey" FOREIGN KEY ("parentTrackVersionId") REFERENCES "TrackVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackVersion" ADD CONSTRAINT "TrackVersion_processingJobId_fkey" FOREIGN KEY ("processingJobId") REFERENCES "ProcessingJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackVersion" ADD CONSTRAINT "TrackVersion_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackVersion" ADD CONSTRAINT "TrackVersion_demoVersionId_fkey" FOREIGN KEY ("demoVersionId") REFERENCES "DemoVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_trackVersionId_fkey" FOREIGN KEY ("trackVersionId") REFERENCES "TrackVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_trackVersionId_fkey" FOREIGN KEY ("trackVersionId") REFERENCES "TrackVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoUserActiveVersion" ADD CONSTRAINT "DemoUserActiveVersion_demoId_fkey" FOREIGN KEY ("demoId") REFERENCES "Demo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoUserActiveVersion" ADD CONSTRAINT "DemoUserActiveVersion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemoUserActiveVersion" ADD CONSTRAINT "DemoUserActiveVersion_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "DemoVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_demoId_fkey" FOREIGN KEY ("demoId") REFERENCES "Demo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_trackVersionId_fkey" FOREIGN KEY ("trackVersionId") REFERENCES "TrackVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LyricSegment" ADD CONSTRAINT "LyricSegment_trackVersionId_fkey" FOREIGN KEY ("trackVersionId") REFERENCES "TrackVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEquipmentRequirement" ADD CONSTRAINT "ProjectEquipmentRequirement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEquipmentRequirement" ADD CONSTRAINT "ProjectEquipmentRequirement_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "EquipmentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOperationLog" ADD CONSTRAINT "ProjectOperationLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOperationLog" ADD CONSTRAINT "ProjectOperationLog_demoId_fkey" FOREIGN KEY ("demoId") REFERENCES "Demo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOperationLog" ADD CONSTRAINT "ProjectOperationLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectOperationLog" ADD CONSTRAINT "ProjectOperationLog_baseSnapshotId_fkey" FOREIGN KEY ("baseSnapshotId") REFERENCES "ProjectSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSnapshot" ADD CONSTRAINT "ProjectSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSnapshot" ADD CONSTRAINT "ProjectSnapshot_demoId_fkey" FOREIGN KEY ("demoId") REFERENCES "Demo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSnapshot" ADD CONSTRAINT "ProjectSnapshot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioAssetMetadata" ADD CONSTRAINT "AudioAssetMetadata_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioAssetMetadata" ADD CONSTRAINT "AudioAssetMetadata_demoId_fkey" FOREIGN KEY ("demoId") REFERENCES "Demo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioAssetMetadata" ADD CONSTRAINT "AudioAssetMetadata_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioAssetMetadata" ADD CONSTRAINT "AudioAssetMetadata_trackVersionId_fkey" FOREIGN KEY ("trackVersionId") REFERENCES "TrackVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioAssetMetadata" ADD CONSTRAINT "AudioAssetMetadata_parentAssetId_fkey" FOREIGN KEY ("parentAssetId") REFERENCES "AudioAssetMetadata"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginMetadata" ADD CONSTRAINT "PluginMetadata_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginGrant" ADD CONSTRAINT "PluginGrant_pluginId_fkey" FOREIGN KEY ("pluginId") REFERENCES "PluginMetadata"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginGrant" ADD CONSTRAINT "PluginGrant_demoId_fkey" FOREIGN KEY ("demoId") REFERENCES "Demo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginGrant" ADD CONSTRAINT "PluginGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

