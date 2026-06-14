import useSWR, { mutate } from "swr";
import { fetcher } from "./api";
import type { Task, Project, ProjectDetail, User, Comment, Team, Broadcast } from "./types";

export function useTasks(query: string) {
  return useSWR<Task[]>(`/tasks${query}`, fetcher);
}

export function useTask(id: string) {
  return useSWR<Task>(id ? `/tasks/${id}` : null, fetcher);
}

export function useProjects() {
  return useSWR<Project[]>("/projects", fetcher);
}

export function useProjectDetail(id: string) {
  return useSWR<ProjectDetail>(id ? `/projects/${id}` : null, fetcher);
}

export function useTeams() {
  return useSWR<Team[]>("/teams", fetcher);
}

export function useBroadcasts() {
  return useSWR<Broadcast[]>("/broadcast", fetcher);
}

export function useUsers() {
  return useSWR<User[]>("/users", fetcher);
}

export function useComments(taskId: string) {
  return useSWR<Comment[]>(taskId ? `/tasks/${taskId}/comments` : null, fetcher);
}

/** Перечитать все списки задач после изменения. */
export function refreshTasks() {
  return mutate((key) => typeof key === "string" && key.startsWith("/tasks"));
}
