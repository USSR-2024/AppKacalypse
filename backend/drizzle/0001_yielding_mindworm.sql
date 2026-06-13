CREATE TABLE "bot_sessions" (
	"telegram_id" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"rounds" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
