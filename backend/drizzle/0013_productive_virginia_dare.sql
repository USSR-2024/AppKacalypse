CREATE TYPE "public"."protocol_status" AS ENUM('none', 'queued', 'running', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."transcription_status" AS ENUM('queued', 'transcribing', 'transcribed', 'failed');--> statement-breakpoint
CREATE TABLE "transcriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"lang" text DEFAULT 'auto' NOT NULL,
	"status" "transcription_status" DEFAULT 'queued' NOT NULL,
	"protocol_status" "protocol_status" DEFAULT 'none' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transcriptions" ADD CONSTRAINT "transcriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD CONSTRAINT "transcriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transcriptions_workspace_idx" ON "transcriptions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "transcriptions_status_idx" ON "transcriptions" USING btree ("status");