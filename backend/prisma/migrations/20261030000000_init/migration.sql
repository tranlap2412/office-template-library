-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('document', 'presentation');

-- CreateTable
CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "kind" "DocumentKind" NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(1000) NOT NULL DEFAULT '',
    "categoryId" INTEGER NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "searchText" VARCHAR(2000) NOT NULL DEFAULT '',
    "filePath" VARCHAR(400) NOT NULL,
    "fileSha256" CHAR(64) NOT NULL,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplatePreview" (
    "id" SERIAL NOT NULL,
    "templateId" UUID NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "imagePath" VARCHAR(400) NOT NULL,

    CONSTRAINT "TemplatePreview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateField" (
    "id" SERIAL NOT NULL,
    "templateId" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "defaultValue" VARCHAR(2000),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TemplateField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL,
    "templateId" UUID,
    "templateVersion" INTEGER NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "filePath" VARCHAR(400) NOT NULL,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_kind_slug_key" ON "Category"("kind", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Template_slug_key" ON "Template"("slug");

-- CreateIndex
CREATE INDEX "Template_kind_isActive_idx" ON "Template"("kind", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TemplatePreview_templateId_pageNumber_key" ON "TemplatePreview"("templateId", "pageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateField_templateId_key_key" ON "TemplateField"("templateId", "key");

-- CreateIndex
CREATE INDEX "Document_updatedAt_idx" ON "Document"("updatedAt");

-- CreateIndex
CREATE INDEX "Document_kind_idx" ON "Document"("kind");

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplatePreview" ADD CONSTRAINT "TemplatePreview_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateField" ADD CONSTRAINT "TemplateField_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;
