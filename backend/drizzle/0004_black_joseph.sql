CREATE TABLE "task_assignees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" uuid,
	"external_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_assignee_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "tasks_assignee_idx";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "controller_id" uuid;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_assignees_task_idx" ON "task_assignees" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_assignees_user_idx" ON "task_assignees" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_controller_id_users_id_fk" FOREIGN KEY ("controller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_controller_idx" ON "tasks" USING btree ("controller_id");--> statement-breakpoint
INSERT INTO "task_assignees" ("task_id","user_id") SELECT "id","assignee_id" FROM "tasks" WHERE "assignee_id" IS NOT NULL;--> statement-breakpoint
UPDATE "tasks" SET "controller_id" = "creator_id" WHERE "controller_id" IS NULL;--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "assignee_id";