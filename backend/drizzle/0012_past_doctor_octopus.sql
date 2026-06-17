CREATE TYPE "public"."member_status" AS ENUM('active', 'pending');--> statement-breakpoint
CREATE TABLE "workspace_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" text NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invite_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "status" "member_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_invites_workspace_idx" ON "workspace_invites" USING btree ("workspace_id");