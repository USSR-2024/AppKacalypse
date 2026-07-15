CREATE TYPE "public"."recording_status" AS ENUM('none', 'active', 'processing', 'ready', 'failed');--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "recording_status" "recording_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "egress_id" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "recording_key" text;--> statement-breakpoint
ALTER TABLE "meetings" DROP COLUMN IF EXISTS "recording";
