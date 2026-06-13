export type TaskStatus = "queued" | "in_progress" | "done" | "cancelled" | "archived";
export type Priority = "low" | "normal" | "high";
export type TaskSource = "app" | "telegram" | "email" | "calendar" | "ai";

export interface Task {
  id: string;
  title: string;
  description: string;
  projectId: string | null;
  creatorId: string;
  assigneeId: string | null;
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

export interface Me {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
  timezone: string;
  lang: string;
  notifyMorning: boolean;
  notifyEvening: boolean;
  morningTime: string;
  eveningTime: string;
  notifyChannels: string[];
}
