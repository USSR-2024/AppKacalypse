-- Поля карточки для фазы 1: описание, приоритет, срок.
-- Приоритет — 4 уровня (план, фаза 7): у трекера свои три (low/normal/high), это
-- ДРУГАЯ шкала, поэтому отдельный enum, а не переиспользование task_priority.
CREATE TYPE "public"."doc_priority" AS ENUM('critical', 'urgent', 'important', 'low');--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "priority" "doc_priority" DEFAULT 'important' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "priority_reason" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "due_at" timestamp with time zone;
