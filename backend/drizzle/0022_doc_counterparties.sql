-- Справочник контрагентов (M2). Ручной ввод + задел под синк из учётной системы
-- (external_id/external_source). documents.counterparty_id ссылается сюда; строковый
-- counterparty_name остаётся для свободного ввода и обратной совместимости.
CREATE TABLE "doc_counterparties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"inn" text,
	"note" text,
	"external_id" text,
	"external_source" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_counterparties_ws_name_unique" UNIQUE("workspace_id","name")
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "counterparty_id" uuid;--> statement-breakpoint
ALTER TABLE "doc_counterparties" ADD CONSTRAINT "doc_counterparties_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_counterparty_id_doc_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."doc_counterparties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_counterparties_ws_idx" ON "doc_counterparties" ("workspace_id");
