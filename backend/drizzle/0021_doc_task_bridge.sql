-- Мост «Документы → Задачи» (M2): согласование падает личной задачей во «Входящие».
-- tasks.document_id != null ⇒ задача СИСТЕМНАЯ: руками не закрыть, гаснет только реальным
-- действием (согласовал/вернул/маршрут пройден). route_steps.task_id — задача согласующего
-- для этого шага; documents.approval_task_id — трекинг-задача инициатора «провести до конца».
ALTER TABLE "tasks" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "route_steps" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "approval_task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_approval_task_id_tasks_id_fk" FOREIGN KEY ("approval_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_document_idx" ON "tasks" ("document_id");
