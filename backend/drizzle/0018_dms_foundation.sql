-- Модуль документооборота, фундамент: справочники, матрица, карточка, версии,
-- маршрут, замечания, записка, аудит. Спека — docs/ТЗ-документооборот.md.
-- Аддитивно: существующих таблиц не трогаем.

CREATE TYPE "public"."document_status" AS ENUM('draft', 'on_approval', 'rework', 'approved', 'on_signing', 'signed', 'active', 'expired', 'terminated', 'archived', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."org_unit_role" AS ENUM('lead', 'member', 'deputy');--> statement-breakpoint
CREATE TYPE "public"."route_status" AS ENUM('running', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."step_status" AS ENUM('pending', 'active', 'approved', 'rejected', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."remark_kind" AS ENUM('blocking', 'comment');--> statement-breakpoint

CREATE TABLE "doc_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parent_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_groups_ws_code_unique" UNIQUE("workspace_id","code")
);--> statement-breakpoint

CREATE TABLE "note_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_profiles_ws_code_unique" UNIQUE("workspace_id","code")
);--> statement-breakpoint

CREATE TABLE "doc_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"group_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"registry_mask" text DEFAULT '{TYPE}-{YYYY}-{NNNN}' NOT NULL,
	"requires_note" boolean DEFAULT false NOT NULL,
	"note_profile_id" uuid,
	"sla_days" integer DEFAULT 3 NOT NULL,
	"risk_level" text,
	"requires_counterparty" boolean DEFAULT false NOT NULL,
	"requires_validity" boolean DEFAULT false NOT NULL,
	"attr_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"template_object_key" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_types_ws_code_unique" UNIQUE("workspace_id","code")
);--> statement-breakpoint

CREATE TABLE "doc_registry_counters" (
	"workspace_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "doc_registry_counters_workspace_id_type_id_period_key_pk" PRIMARY KEY("workspace_id","type_id","period_key")
);--> statement-breakpoint

CREATE TABLE "org_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_units_ws_code_unique" UNIQUE("workspace_id","code")
);--> statement-breakpoint

CREATE TABLE "org_unit_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "org_unit_role" DEFAULT 'member' NOT NULL,
	"can_approve" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_unit_members_unique" UNIQUE("unit_id","user_id")
);--> statement-breakpoint

CREATE TABLE "approval_matrix" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"stage_no" integer DEFAULT 1 NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"sla_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_matrix_unique" UNIQUE("type_id","unit_id","stage_no")
);--> statement-breakpoint

CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"registry_number" text,
	"title" text NOT NULL,
	"type_id" uuid NOT NULL,
	"group_id" uuid,
	"status" "document_status" DEFAULT 'draft' NOT NULL,
	"author_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"counterparty_name" text,
	"date_signed" date,
	"effective_from" date,
	"effective_to" date,
	"is_perpetual" boolean DEFAULT false NOT NULL,
	"amount" numeric(18, 2),
	"currency" text,
	"current_version_id" uuid,
	"signed_version_id" uuid,
	"storage_location" text,
	"attrs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_registry_number_unique" UNIQUE("workspace_id","registry_number")
);--> statement-breakpoint

CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"object_key" text NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"file_hash" text NOT NULL,
	"mime_type" text NOT NULL,
	"author_id" uuid NOT NULL,
	"comment" text,
	"ds_key" text,
	"changes_object_key" text,
	"changes_history" jsonb,
	"ds_server_version" text,
	"is_signed_original" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_no_unique" UNIQUE("document_id","version_no")
);--> statement-breakpoint

CREATE TABLE "route_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"definition" jsonb NOT NULL,
	"status" "route_status" DEFAULT 'running' NOT NULL,
	"current_stage" integer DEFAULT 1 NOT NULL,
	"iteration" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);--> statement-breakpoint

CREATE TABLE "route_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_instance_id" uuid NOT NULL,
	"unit_id" uuid,
	"assignee_id" uuid,
	"stage_no" integer NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"status" "step_status" DEFAULT 'pending' NOT NULL,
	"decided_version_id" uuid,
	"is_ad_hoc" boolean DEFAULT false NOT NULL,
	"added_by" uuid,
	"due_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"decided_at" timestamp with time zone
);--> statement-breakpoint

CREATE TABLE "step_remarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"step_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"kind" "remark_kind" NOT NULL,
	"text" text NOT NULL,
	"version_id" uuid,
	"resolution" text,
	"is_accepted" boolean,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "explanatory_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"profile_id" uuid,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "explanatory_notes_doc_unique" UNIQUE("document_id")
);--> statement-breakpoint

CREATE TABLE "document_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"actor_id" uuid,
	"action" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- FK
ALTER TABLE "doc_groups" ADD CONSTRAINT "doc_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_groups" ADD CONSTRAINT "doc_groups_parent_id_doc_groups_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."doc_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_profiles" ADD CONSTRAINT "note_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_types" ADD CONSTRAINT "doc_types_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_types" ADD CONSTRAINT "doc_types_group_id_doc_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."doc_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_types" ADD CONSTRAINT "doc_types_note_profile_id_note_profiles_id_fk" FOREIGN KEY ("note_profile_id") REFERENCES "public"."note_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_registry_counters" ADD CONSTRAINT "doc_registry_counters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_registry_counters" ADD CONSTRAINT "doc_registry_counters_type_id_doc_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."doc_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_unit_members" ADD CONSTRAINT "org_unit_members_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."org_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_unit_members" ADD CONSTRAINT "org_unit_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_matrix" ADD CONSTRAINT "approval_matrix_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_matrix" ADD CONSTRAINT "approval_matrix_type_id_doc_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."doc_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_matrix" ADD CONSTRAINT "approval_matrix_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."org_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_id_doc_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."doc_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_group_id_doc_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."doc_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_instances" ADD CONSTRAINT "route_instances_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_route_instance_id_route_instances_id_fk" FOREIGN KEY ("route_instance_id") REFERENCES "public"."route_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_unit_id_org_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_decided_version_id_document_versions_id_fk" FOREIGN KEY ("decided_version_id") REFERENCES "public"."document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_remarks" ADD CONSTRAINT "step_remarks_step_id_route_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."route_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_remarks" ADD CONSTRAINT "step_remarks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_remarks" ADD CONSTRAINT "step_remarks_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_remarks" ADD CONSTRAINT "step_remarks_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_remarks" ADD CONSTRAINT "step_remarks_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explanatory_notes" ADD CONSTRAINT "explanatory_notes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explanatory_notes" ADD CONSTRAINT "explanatory_notes_profile_id_note_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."note_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explanatory_notes" ADD CONSTRAINT "explanatory_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_activity" ADD CONSTRAINT "document_activity_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_activity" ADD CONSTRAINT "document_activity_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_activity" ADD CONSTRAINT "document_activity_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Циклические ссылки карточка ↔ версия: ставим после создания обеих таблиц.
ALTER TABLE "documents" ADD CONSTRAINT "documents_current_version_id_document_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_signed_version_id_document_versions_id_fk" FOREIGN KEY ("signed_version_id") REFERENCES "public"."document_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Индексы
CREATE INDEX "doc_groups_ws_idx" ON "doc_groups" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "doc_types_ws_idx" ON "doc_types" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "org_units_ws_idx" ON "org_units" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "org_unit_members_unit_idx" ON "org_unit_members" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "org_unit_members_user_idx" ON "org_unit_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "approval_matrix_type_idx" ON "approval_matrix" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "documents_ws_idx" ON "documents" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "documents_owner_idx" ON "documents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "documents_type_idx" ON "documents" USING btree ("type_id","group_id");--> statement-breakpoint
CREATE INDEX "document_versions_doc_idx" ON "document_versions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "route_instances_doc_idx" ON "route_instances" USING btree ("document_id","iteration");--> statement-breakpoint
CREATE INDEX "route_steps_route_idx" ON "route_steps" USING btree ("route_instance_id","stage_no");--> statement-breakpoint
CREATE INDEX "route_steps_assignee_idx" ON "route_steps" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "step_remarks_doc_idx" ON "step_remarks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "step_remarks_step_idx" ON "step_remarks" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "document_activity_doc_idx" ON "document_activity" USING btree ("document_id","at");--> statement-breakpoint
CREATE INDEX "document_activity_ws_idx" ON "document_activity" USING btree ("workspace_id","at");--> statement-breakpoint

-- Подписанный оригинал ровно один на документ.
CREATE UNIQUE INDEX "document_versions_signed_unique" ON "document_versions" USING btree ("document_id") WHERE "is_signed_original";
