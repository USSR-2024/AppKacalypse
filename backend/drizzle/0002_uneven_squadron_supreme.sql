CREATE TABLE IF NOT EXISTS "bot_login_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tg_outbox" ADD COLUMN IF NOT EXISTS "markup" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bot_login_codes" ADD CONSTRAINT "bot_login_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
