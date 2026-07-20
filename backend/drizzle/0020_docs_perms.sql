-- Права и фиче-флаги модуля «Документы» (M1): включение модуля на воркспейс +
-- возможности пользователя (создавать / администрировать / видеть все).
CREATE TABLE "workspace_features" (
	"workspace_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "workspace_features_workspace_id_feature_pk" PRIMARY KEY("workspace_id","feature")
);
--> statement-breakpoint
CREATE TABLE "doc_member_perms" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"can_create" boolean DEFAULT true NOT NULL,
	"can_manage" boolean DEFAULT false NOT NULL,
	"can_view_all" boolean DEFAULT false NOT NULL,
	CONSTRAINT "doc_member_perms_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_features" ADD CONSTRAINT "workspace_features_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "doc_member_perms" ADD CONSTRAINT "doc_member_perms_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "doc_member_perms" ADD CONSTRAINT "doc_member_perms_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
