CREATE TYPE "public"."meeting_kind" AS ENUM('instant', 'scheduled', 'permanent');--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "kind" "meeting_kind" DEFAULT 'instant' NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "invite_code" text;--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_invite_code_unique" ON "meetings" USING btree ("invite_code");
