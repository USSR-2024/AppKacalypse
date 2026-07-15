-- Беспарольный вход по коду на почту + одноразовые/авто-одобряемые приглашения.
-- Писано вручную: db:generate интерактивный и в пайпе висит.

CREATE TABLE IF NOT EXISTS "email_login_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"invite_code" text,
	"link_user_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_login_codes" ADD CONSTRAINT "email_login_codes_link_user_id_users_id_fk"
   FOREIGN KEY ("link_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_login_codes_email_idx" ON "email_login_codes" USING btree ("email");
--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD COLUMN IF NOT EXISTS "auto_approve" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD COLUMN IF NOT EXISTS "uses_left" integer;
