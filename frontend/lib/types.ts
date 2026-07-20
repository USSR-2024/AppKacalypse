export type TaskStatus = "queued" | "in_progress" | "done" | "cancelled" | "archived";
export type ProjectView = "list" | "board" | "table";
export type Priority = "low" | "normal" | "high";
export type TaskSource = "app" | "telegram" | "email" | "calendar" | "ai";

export interface Assignee {
  userId: string | null;
  externalName: string | null;
  displayName: string;
  avatarUrl: string | null;
}

export interface Comment {
  id: string;
  body: string;
  mentions: string[];
  createdAt: string;
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  projectId: string | null;
  sectionId: string | null;
  creatorId: string;
  controllerId: string | null;
  assignees: Assignee[];
  status: TaskStatus;
  priority: Priority;
  isImportant: boolean;
  isTriaged: boolean;
  dueAt: string | null;
  remindAt: string | null;
  completedAt: string | null;
  source: TaskSource;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  color: string | null;
  ownerId: string;
  isArchived: boolean;
}

export interface ProjectMember {
  userId: string;
  role: string;
  accessScope: "own" | "all";
  displayName: string;
  avatarUrl: string | null;
}

export interface Section {
  id: string;
  projectId: string;
  name: string;
  position: number;
}

export interface ProjectDetail extends Project {
  members: ProjectMember[];
  sections: Section[];
}

export interface TeamMember {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface Team {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  members: TeamMember[];
}

export interface Broadcast {
  id: string;
  title: string;
  body: string;
  channels: string[];
  recipientCount: number;
  createdAt: string;
  senderName: string;
}

export interface ChangelogEntry {
  id: string;
  text: string;
  announcedAt: string | null;
  createdAt: string;
}

export interface User {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
}

export interface AdminUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
}

export type TranscriptionStatus = "queued" | "transcribing" | "transcribed" | "failed";
export type ProtocolStatus = "none" | "queued" | "running" | "ready" | "failed";

export interface Transcription {
  id: string;
  filename: string;
  lang: "auto" | "ru" | "es";
  status: TranscriptionStatus;
  protocolStatus: ProtocolStatus;
  error: string | null;
  createdAt: string;
}

export type MeetingStatus = "active" | "ended";
export type MeetingKind = "instant" | "scheduled" | "permanent";
export type RecordingStatus = "none" | "active" | "processing" | "ready" | "failed";

export interface Meeting {
  id: string;
  title: string;
  status: MeetingStatus;
  kind: MeetingKind;
  startAt: string | null;      // только у scheduled
  inviteUrl: string | null;    // null, если нет права звать (не owner/admin)
  captions: boolean;
  recordingStatus: RecordingStatus;
  recordingKey: string | null;
  transcriptionId: string | null;
  createdAt: string;
  endedAt: string | null;
  canManage?: boolean;
}

export interface Me {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;      // привязана ли почта (второй способ входа)
  role: string;
  timezone: string;
  lang: string;
  projectView: ProjectView;
  notifyMorning: boolean;
  notifyEvening: boolean;
  morningTime: string;
  eveningTime: string;
  notifyChannels: string[];
}

// ── Документы (модуль ДМС) ───────────────────────────────────────────────────
export type DocumentStatus =
  | "draft" | "on_approval" | "rework" | "approved" | "on_signing"
  | "signed" | "active" | "expired" | "terminated" | "archived" | "cancelled";
export type DocPriority = "critical" | "urgent" | "important" | "low";

export interface DocVersion {
  id: string;
  versionNo: number;
  fileName: string;
  fileSize: number;
  fileHash: string;
  mimeType: string;
  comment: string | null;
  isSignedOriginal: boolean;
  createdAt: string;
  authorName: string | null;
}

export interface DocRow {
  id: string;
  registryNumber: string | null;
  title: string;
  status: DocumentStatus;
  priority: DocPriority;
  dueAt: string | null;
  counterpartyName: string | null;
  typeName: string | null;
  groupName: string | null;
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocCard extends DocRow {
  description: string | null;
  priorityReason: string | null;
  typeId: string;
  groupId: string | null;
  currentVersionId: string | null;
  amount: string | null;
  currency: string | null;
  versions: DocVersion[];
  canEdit: boolean;
  canSubmit: boolean;
  canManage: boolean;
}

export interface DocType {
  id: string;
  name: string;
  code: string;
  requiresNote: boolean;
}

export interface DocActivity {
  id: string;
  entity: string;
  action: string;
  payload: Record<string, unknown>;
  at: string;
  actorName: string | null;
}

// ── Маршрут согласования ─────────────────────────────────────────────────────
export type StepStatus = "pending" | "active" | "approved" | "rejected" | "skipped";
export type RouteStatus = "running" | "approved" | "rejected" | "cancelled";
export type RemarkKind = "blocking" | "comment";

export interface DocMember {
  id: string;
  displayName: string;
  role: "owner" | "admin" | "member";
}

export interface DocRouteStep {
  id: string;
  stageNo: number;
  status: StepStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  activatedAt: string | null;
  decidedAt: string | null;
}

export interface DocRemark {
  id: string;
  stepId: string;
  kind: RemarkKind;
  text: string;
  createdAt: string;
  authorName: string | null;
}

export interface DocRoute {
  route: { id: string; status: RouteStatus; currentStage: number; iteration: number; startedAt: string } | null;
  steps: DocRouteStep[];
  remarks: DocRemark[];
  canDecide?: boolean;
  activeStepId?: string | null;
}

// ── Админка модуля («Настройки») ─────────────────────────────────────────────
export interface DocAdminGroup {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface DocAdminType {
  id: string;
  code: string;
  name: string;
  groupId: string | null;
  groupName: string | null;
  registryMask: string;
  requiresNote: boolean;
  slaDays: number;
  requiresCounterparty: boolean;
  requiresValidity: boolean;
  riskLevel: string | null;
  isActive: boolean;
}

export type OrgUnitRole = "lead" | "member" | "deputy";

export interface DocUnitMember {
  unitId: string;
  userId: string;
  role: OrgUnitRole;
  canApprove: boolean;
  displayName: string;
}

export interface DocUnit {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  members: DocUnitMember[];
}

export interface DocMatrixRow {
  id: string;
  unitId: string;
  unitName: string;
  stageNo: number;
  isRequired: boolean;
  slaDays: number | null;
}

export interface DocAccessMember {
  userId: string;
  displayName: string;
  wsRole: "owner" | "admin" | "member";
  canCreate: boolean;
  canManage: boolean;
  canViewAll: boolean;
  isOverride: boolean;
}

export interface DocAccess {
  documentsEnabled: boolean;
  members: DocAccessMember[];
}

export interface DocPreviewRow {
  unitId: string;
  unitName: string;
  stageNo: number;
  isRequired: boolean;
  assigneeId: string | null;
  assigneeName: string | null;
}

export interface DocRoutePreview {
  mode: "matrix" | "manual";
  rows?: DocPreviewRow[];
  canSubmit?: boolean;
  unresolvedRequired?: string[];
}

export interface DocInboxItem {
  id: string;
  registryNumber: string | null;
  title: string;
  status: DocumentStatus;
  priority: DocPriority;
  dueAt: string | null;
  counterpartyName: string | null;
  typeName: string | null;
  ownerName: string | null;
  stageNo: number;
  activatedAt: string | null;
  updatedAt: string;
}
