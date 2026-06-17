CREATE TYPE "public"."project_access" AS ENUM('own', 'all');--> statement-breakpoint
ALTER TABLE "project_members" ADD COLUMN "access_scope" "project_access" DEFAULT 'all' NOT NULL;