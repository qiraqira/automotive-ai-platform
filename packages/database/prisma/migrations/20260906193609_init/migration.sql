-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INVITED');

-- CreateEnum
CREATE TYPE "PermissionKey" AS ENUM ('READ_SOURCES', 'MANAGE_SOURCES', 'CREATE_STORY', 'UPDATE_STORY', 'CREATE_ARTICLE', 'UPDATE_ARTICLE', 'PUBLISH_ARTICLE', 'DELETE_ARTICLE', 'MODERATE_COMMENT', 'UPDATE_CAR', 'UPDATE_SEO', 'RUN_RESEARCH', 'GENERATE_IMAGE', 'MANAGE_USERS', 'MANAGE_AI_BUDGET', 'VIEW_AUDIT_LOG', 'MANAGE_SYSTEM_SETTINGS');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('HUMAN', 'AI_AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('en', 'es');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('RSS', 'ATOM', 'OFFICIAL_API', 'MANUFACTURER_PRESS_ROOM', 'GOVERNMENT', 'REGULATORY', 'FINANCIAL_FILING', 'NEWS_MEDIA', 'SOCIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceTier" AS ENUM ('PRIMARY', 'WIRE', 'SPECIALIST', 'REGIONAL', 'SOCIAL_LEAD', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "StoryStatus" AS ENUM ('DISCOVERED', 'CLUSTERING', 'RESEARCHING', 'FACT_CHECK', 'EDITORIAL_DRAFT', 'QUALITY_CHECK', 'READY', 'PUBLISHED', 'UPDATED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FactStatus" AS ENUM ('CONFIRMED', 'REPORTED', 'UNCONFIRMED', 'RUMOR', 'DISPUTED', 'OUTDATED');

-- CreateEnum
CREATE TYPE "ConflictResolution" AS ENUM ('UNRESOLVED', 'RESOLVED_A', 'RESOLVED_B', 'RESOLVED_BOTH_VALID', 'RESOLVED_MANUAL');

-- CreateEnum
CREATE TYPE "ArticleType" AS ENUM ('BREAKING_NEWS', 'NEWS', 'ANALYSIS', 'EXPLAINER', 'COMPARISON', 'REVIEW', 'GUIDE', 'MARKET', 'TECHNOLOGY', 'RUMOR', 'TIMELINE', 'MODEL_UPDATE');

-- CreateEnum
CREATE TYPE "ContentPurpose" AS ENUM ('BREAKING', 'UPDATE', 'BACKGROUND', 'ANALYSIS', 'EXPLAINER', 'COMPARISON', 'GUIDE', 'HISTORY', 'DATABASE', 'MARKET', 'TECHNOLOGY');

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'UPDATED', 'ARCHIVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AuthorType" AS ENUM ('HUMAN', 'AI_AGENT', 'HYBRID');

-- CreateEnum
CREATE TYPE "ArticleBlockType" AS ENUM ('TEXT', 'FACT_TABLE', 'SPEC_TABLE', 'TIMELINE', 'QUOTE', 'IMAGE', 'GALLERY', 'COMPARISON', 'RELATED_CARS', 'RELATED_STORIES', 'SOURCE_LIST', 'MAP', 'CHART');

-- CreateEnum
CREATE TYPE "ImageSourceType" AS ENUM ('OFFICIAL_PRESS', 'LICENSED_STOCK', 'OWN_PHOTO', 'USER_LICENSED', 'PUBLIC_DOMAIN', 'CREATIVE_COMMONS', 'AI_GENERATED', 'EMBED_ONLY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ImageRightsStatus" AS ENUM ('VERIFIED_LICENSE', 'OFFICIAL_USE_ALLOWED', 'LICENSE_REQUIRED', 'PUBLIC_DOMAIN', 'CC_BY', 'CC_BY_SA', 'EDITORIAL_ONLY', 'EMBED_ONLY', 'UNKNOWN', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ArticleImageRole" AS ENUM ('HERO', 'INLINE', 'GALLERY', 'OG');

-- CreateEnum
CREATE TYPE "AIJobType" AS ENUM ('DISCOVER_SOURCES', 'CLUSTER_STORY', 'RESEARCH_STORY', 'EXTRACT_FACTS', 'FACT_CHECK', 'WRITE_ARTICLE', 'QUALITY_CHECK', 'MODERATE_COMMENT', 'SEO_AUDIT', 'UPDATE_STALE_CONTENT');

-- CreateEnum
CREATE TYPE "AIJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RETRYING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AutonomyLevel" AS ENUM ('SAFE', 'CONTROLLED', 'HIGH_RISK');

-- CreateEnum
CREATE TYPE "EditorialReviewDecision" AS ENUM ('APPROVE', 'REJECT', 'EDIT', 'REGENERATE', 'MERGE', 'SPLIT');

-- CreateEnum
CREATE TYPE "CommentModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'FLAGGED_FOR_HUMAN');

-- CreateEnum
CREATE TYPE "SystemAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "key" "PermissionKey" NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "markets" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "unitSystem" TEXT NOT NULL,

    CONSTRAINT "markets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "feedUrl" TEXT,
    "country" TEXT,
    "language" TEXT,
    "type" "SourceType" NOT NULL,
    "tier" "SourceTier" NOT NULL DEFAULT 'UNVERIFIED',
    "trustScore" INTEGER NOT NULL DEFAULT 30,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "crawlInterval" INTEGER NOT NULL DEFAULT 900,
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "robotsStatus" TEXT,
    "termsUrl" TEXT,
    "crawlPolicy" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_score_events" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "newScore" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_score_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_authors" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT,
    "name" TEXT NOT NULL,
    "profileUrl" TEXT,

    CONSTRAINT "source_authors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_articles" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "authorId" TEXT,
    "url" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "language" TEXT,
    "rawMeta" JSONB,
    "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "storyId" TEXT,

    CONSTRAINT "source_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stories" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "status" "StoryStatus" NOT NULL DEFAULT 'DISCOVERED',
    "importanceScore" INTEGER NOT NULL DEFAULT 30,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "primaryTopicId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_sources" (
    "storyId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,

    CONSTRAINT "story_sources_pkey" PRIMARY KEY ("storyId","sourceId")
);

-- CreateTable
CREATE TABLE "story_events" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facts" (
    "id" TEXT NOT NULL,
    "storyId" TEXT,
    "carModelId" TEXT,
    "attribute" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "unit" TEXT,
    "marketId" TEXT,
    "status" "FactStatus" NOT NULL DEFAULT 'REPORTED',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "originalCurrency" TEXT,
    "originalValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact_evidence" (
    "id" TEXT NOT NULL,
    "factId" TEXT NOT NULL,
    "sourceArticleId" TEXT NOT NULL,
    "quote" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fact_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fact_conflicts" (
    "id" TEXT NOT NULL,
    "factAId" TEXT NOT NULL,
    "factBId" TEXT NOT NULL,
    "resolution" "ConflictResolution" NOT NULL DEFAULT 'UNRESOLVED',
    "resolvedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "fact_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articles" (
    "id" TEXT NOT NULL,
    "storyId" TEXT,
    "locale" "Locale" NOT NULL,
    "editionGroupId" TEXT,
    "type" "ArticleType" NOT NULL,
    "contentPurpose" "ContentPurpose" NOT NULL,
    "status" "ArticleStatus" NOT NULL DEFAULT 'DRAFT',
    "slug" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "subtitle" TEXT,
    "keyTakeaway" TEXT,
    "authorType" "AuthorType" NOT NULL DEFAULT 'AI_AGENT',
    "authorUserId" TEXT,
    "canonicalUrl" TEXT,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "publishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qualityScore" DOUBLE PRECISION,
    "originalityScore" DOUBLE PRECISION,
    "factualScore" DOUBLE PRECISION,
    "sourceScore" DOUBLE PRECISION,
    "valueScore" DOUBLE PRECISION,
    "readabilityScore" DOUBLE PRECISION,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_blocks" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "type" "ArticleBlockType" NOT NULL,
    "position" INTEGER NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "article_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_revisions" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "authorType" "AuthorType" NOT NULL,
    "authorUserId" TEXT,
    "changeType" TEXT NOT NULL,
    "diff" JSONB NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "related_articles" (
    "fromArticleId" TEXT NOT NULL,
    "toArticleId" TEXT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "related_articles_pkey" PRIMARY KEY ("fromArticleId","toArticleId")
);

-- CreateTable
CREATE TABLE "article_car_models" (
    "articleId" TEXT NOT NULL,
    "carModelId" TEXT NOT NULL,

    CONSTRAINT "article_car_models_pkey" PRIMARY KEY ("articleId","carModelId")
);

-- CreateTable
CREATE TABLE "citations" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "factId" TEXT,
    "sourceArticleId" TEXT,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,

    CONSTRAINT "citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "car_models" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "car_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generations" (
    "id" TEXT NOT NULL,
    "carModelId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startYear" INTEGER,
    "endYear" INTEGER,

    CONSTRAINT "generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trims" (
    "id" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "trims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engines" (
    "id" TEXT NOT NULL,
    "trimId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "powerKw" DOUBLE PRECISION,
    "powerHp" DOUBLE PRECISION,
    "fuel" TEXT,

    CONSTRAINT "engines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batteries" (
    "id" TEXT NOT NULL,
    "trimId" TEXT NOT NULL,
    "capacityKwh" DOUBLE PRECISION,
    "rangeKm" DOUBLE PRECISION,
    "rangeMiles" DOUBLE PRECISION,

    CONSTRAINT "batteries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_relations" (
    "id" TEXT NOT NULL,
    "fromType" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toType" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "images" (
    "id" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "localStorageUrl" TEXT,
    "sourceType" "ImageSourceType" NOT NULL,
    "rightsStatus" "ImageRightsStatus" NOT NULL DEFAULT 'UNKNOWN',
    "author" TEXT,
    "copyright" TEXT,
    "attribution" TEXT,
    "licenseId" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "mimeType" TEXT,
    "sha256" TEXT NOT NULL,
    "perceptualHash" TEXT,
    "generatedByAi" BOOLEAN NOT NULL DEFAULT false,
    "c2paMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_licenses" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "licenseType" TEXT NOT NULL,
    "licenseUrl" TEXT,
    "attributionRequired" BOOLEAN NOT NULL DEFAULT true,
    "commercialUseAllowed" BOOLEAN NOT NULL DEFAULT false,
    "modificationAllowed" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "image_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_images" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "role" "ArticleImageRole" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "altText" TEXT,

    CONSTRAINT "article_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_jobs" (
    "id" TEXT NOT NULL,
    "type" "AIJobType" NOT NULL,
    "status" "AIJobStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 50,
    "storyId" TEXT,
    "input" JSONB NOT NULL,
    "result" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "deadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ai_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_executions" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTemplateId" TEXT,
    "promptVersion" INTEGER,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agent_actions" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "autonomyLevel" "AutonomyLevel" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "confidence" DOUBLE PRECISION,
    "approvedByUserId" TEXT,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agent_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_versions" (
    "id" TEXT NOT NULL,
    "promptTemplateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "editorial_reviews" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "decision" "EditorialReviewDecision",
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "editorial_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "CommentModerationStatus" NOT NULL DEFAULT 'PENDING',
    "score" DOUBLE PRECISION,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_records" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "indexable" BOOLEAN NOT NULL DEFAULT true,
    "canonicalUrl" TEXT,
    "structuredData" JSONB,
    "lastCrawledAt" TIMESTAMP(3),
    "impressions" INTEGER,
    "clicks" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seo_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redirects" (
    "id" TEXT NOT NULL,
    "fromPath" TEXT NOT NULL,
    "toPath" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL DEFAULT 301,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redirects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_queries" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "locale" "Locale" NOT NULL,
    "resultsCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "articleId" TEXT,
    "path" TEXT NOT NULL,
    "sessionId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_alerts" (
    "id" TEXT NOT NULL,
    "severity" "SystemAlertSeverity" NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "system_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "markets_code_key" ON "markets"("code");

-- CreateIndex
CREATE INDEX "sources_type_active_idx" ON "sources"("type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "source_articles_url_key" ON "source_articles"("url");

-- CreateIndex
CREATE UNIQUE INDEX "source_articles_urlHash_key" ON "source_articles"("urlHash");

-- CreateIndex
CREATE INDEX "source_articles_storyId_idx" ON "source_articles"("storyId");

-- CreateIndex
CREATE INDEX "source_articles_publishedAt_idx" ON "source_articles"("publishedAt");

-- CreateIndex
CREATE INDEX "stories_status_idx" ON "stories"("status");

-- CreateIndex
CREATE INDEX "stories_importanceScore_idx" ON "stories"("importanceScore");

-- CreateIndex
CREATE INDEX "facts_carModelId_attribute_idx" ON "facts"("carModelId", "attribute");

-- CreateIndex
CREATE INDEX "facts_storyId_idx" ON "facts"("storyId");

-- CreateIndex
CREATE INDEX "articles_editionGroupId_idx" ON "articles"("editionGroupId");

-- CreateIndex
CREATE INDEX "articles_status_locale_idx" ON "articles"("status", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "articles_locale_slug_key" ON "articles"("locale", "slug");

-- CreateIndex
CREATE INDEX "article_blocks_articleId_position_idx" ON "article_blocks"("articleId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "car_models_brandId_slug_key" ON "car_models"("brandId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "generations_carModelId_slug_key" ON "generations"("carModelId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "trims_generationId_slug_key" ON "trims"("generationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "people_slug_key" ON "people"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "topics_slug_key" ON "topics"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tags_slug_key" ON "tags"("slug");

-- CreateIndex
CREATE INDEX "entity_relations_fromType_fromId_idx" ON "entity_relations"("fromType", "fromId");

-- CreateIndex
CREATE INDEX "entity_relations_toType_toId_idx" ON "entity_relations"("toType", "toId");

-- CreateIndex
CREATE UNIQUE INDEX "images_sha256_key" ON "images"("sha256");

-- CreateIndex
CREATE INDEX "images_perceptualHash_idx" ON "images"("perceptualHash");

-- CreateIndex
CREATE INDEX "ai_jobs_status_priority_idx" ON "ai_jobs"("status", "priority");

-- CreateIndex
CREATE INDEX "ai_executions_createdAt_idx" ON "ai_executions"("createdAt");

-- CreateIndex
CREATE INDEX "ai_agent_actions_entityType_entityId_idx" ON "ai_agent_actions"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_templates_key_key" ON "prompt_templates"("key");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_versions_promptTemplateId_version_key" ON "prompt_versions"("promptTemplateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "seo_records_articleId_key" ON "seo_records"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "redirects_fromPath_key" ON "redirects"("fromPath");

-- CreateIndex
CREATE INDEX "analytics_events_type_createdAt_idx" ON "analytics_events"("type", "createdAt");

-- CreateIndex
CREATE INDEX "system_alerts_resolved_severity_idx" ON "system_alerts"("resolved", "severity");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_score_events" ADD CONSTRAINT "source_score_events_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_articles" ADD CONSTRAINT "source_articles_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_articles" ADD CONSTRAINT "source_articles_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "source_authors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_articles" ADD CONSTRAINT "source_articles_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_primaryTopicId_fkey" FOREIGN KEY ("primaryTopicId") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_sources" ADD CONSTRAINT "story_sources_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_sources" ADD CONSTRAINT "story_sources_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_events" ADD CONSTRAINT "story_events_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facts" ADD CONSTRAINT "facts_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facts" ADD CONSTRAINT "facts_carModelId_fkey" FOREIGN KEY ("carModelId") REFERENCES "car_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facts" ADD CONSTRAINT "facts_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_evidence" ADD CONSTRAINT "fact_evidence_factId_fkey" FOREIGN KEY ("factId") REFERENCES "facts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_evidence" ADD CONSTRAINT "fact_evidence_sourceArticleId_fkey" FOREIGN KEY ("sourceArticleId") REFERENCES "source_articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_conflicts" ADD CONSTRAINT "fact_conflicts_factAId_fkey" FOREIGN KEY ("factAId") REFERENCES "facts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fact_conflicts" ADD CONSTRAINT "fact_conflicts_factBId_fkey" FOREIGN KEY ("factBId") REFERENCES "facts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_blocks" ADD CONSTRAINT "article_blocks_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_revisions" ADD CONSTRAINT "article_revisions_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_revisions" ADD CONSTRAINT "article_revisions_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "related_articles" ADD CONSTRAINT "related_articles_fromArticleId_fkey" FOREIGN KEY ("fromArticleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "related_articles" ADD CONSTRAINT "related_articles_toArticleId_fkey" FOREIGN KEY ("toArticleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_car_models" ADD CONSTRAINT "article_car_models_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_car_models" ADD CONSTRAINT "article_car_models_carModelId_fkey" FOREIGN KEY ("carModelId") REFERENCES "car_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "car_models" ADD CONSTRAINT "car_models_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generations" ADD CONSTRAINT "generations_carModelId_fkey" FOREIGN KEY ("carModelId") REFERENCES "car_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trims" ADD CONSTRAINT "trims_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "generations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engines" ADD CONSTRAINT "engines_trimId_fkey" FOREIGN KEY ("trimId") REFERENCES "trims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batteries" ADD CONSTRAINT "batteries_trimId_fkey" FOREIGN KEY ("trimId") REFERENCES "trims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_relations" ADD CONSTRAINT "entity_relation_story_fk" FOREIGN KEY ("fromId") REFERENCES "stories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_relations" ADD CONSTRAINT "entity_relation_person_fk" FOREIGN KEY ("fromId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_relations" ADD CONSTRAINT "entity_relation_company_fk" FOREIGN KEY ("fromId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "image_licenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_images" ADD CONSTRAINT "article_images_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_images" ADD CONSTRAINT "article_images_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ai_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_promptTemplateId_fkey" FOREIGN KEY ("promptTemplateId") REFERENCES "prompt_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_promptTemplateId_fkey" FOREIGN KEY ("promptTemplateId") REFERENCES "prompt_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editorial_reviews" ADD CONSTRAINT "editorial_reviews_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editorial_reviews" ADD CONSTRAINT "editorial_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_records" ADD CONSTRAINT "seo_records_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
