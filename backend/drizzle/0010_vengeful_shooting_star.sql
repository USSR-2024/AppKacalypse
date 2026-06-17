CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_member_unique" UNIQUE("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
-- 1) колонки добавляем nullable; backfill ниже, затем включаем NOT NULL.
ALTER TABLE "projects" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
-- 2) дефолтный воркспейс для существующих данных (одно-тенант → мульти-тенант).
INSERT INTO "workspaces" ("slug", "name") VALUES ('mig', 'MIG') ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
-- 3) backfill: все текущие данные → дефолтный воркспейс.
UPDATE "projects" SET "workspace_id" = (SELECT id FROM "workspaces" WHERE slug = 'mig') WHERE "workspace_id" IS NULL;--> statement-breakpoint
UPDATE "tasks" SET "workspace_id" = (SELECT id FROM "workspaces" WHERE slug = 'mig') WHERE "workspace_id" IS NULL;--> statement-breakpoint
UPDATE "teams" SET "workspace_id" = (SELECT id FROM "workspaces" WHERE slug = 'mig') WHERE "workspace_id" IS NULL;--> statement-breakpoint
-- 4) все существующие юзеры → участники дефолтного воркспейса (platform-owner → owner).
INSERT INTO "workspace_members" ("workspace_id", "user_id", "role")
  SELECT (SELECT id FROM "workspaces" WHERE slug = 'mig'), u.id,
         CASE WHEN u.role = 'owner' THEN 'owner'::workspace_role ELSE 'member'::workspace_role END
  FROM "users" u
  ON CONFLICT ("workspace_id", "user_id") DO NOTHING;--> statement-breakpoint
-- 5) данные заполнены — включаем NOT NULL.
ALTER TABLE "projects" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_members_workspace_idx" ON "workspace_members" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_workspace_idx" ON "projects" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "tasks_workspace_idx" ON "tasks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "teams_workspace_idx" ON "teams" USING btree ("workspace_id");