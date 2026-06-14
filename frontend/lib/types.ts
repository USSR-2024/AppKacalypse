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

export interface Me {
  id: string;
  displayName: string;
  avatarUrl: string | null;
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
