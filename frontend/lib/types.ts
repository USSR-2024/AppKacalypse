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
