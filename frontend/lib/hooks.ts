import useSWR, { mutate } from "swr";
import { fetcher } from "./api";
import type { Task, Project, User, Comment } from "./types";

export function useTasks(query: string) {
  return useSWR<Task[]>(`/tasks${query}`, fetcher);
}

export function useTask(id: string) {
  return useSWR<Task>(id ? `/tasks/${id}` : null, fetcher);
}

export function useProjects() {
  return useSWR<Project[]>("/projects", fetcher);
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
