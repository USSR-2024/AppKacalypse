// Единые подписи ролей В ПРОСТРАНСТВЕ (workspace_members.role). Используются везде,
// чтобы owner-консоль, «Участники» и «Команда» показывали одно и то же.
export const WS_ROLE_LABEL: Record<string, string> = {
  owner: "Владелец",
  admin: "Глава",
  member: "Участник",
};

export const wsRoleLabel = (r: string): string => WS_ROLE_LABEL[r] ?? r;
