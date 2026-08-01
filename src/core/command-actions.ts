import type { WorkspaceKind } from "../state/types.js";

export type CommandAction =
  | { kind: "create_task"; instruction: string; workspaceKind?: WorkspaceKind; explicitPath?: string; collaborationMode?: "default" | "plan"; executionIntent?: "general" | "output_only" }
  | { kind: "continue_task" | "steer_task"; taskId?: string; instruction: string }
  | { kind: "stop_task" | "inspect_task" | "retry_task" | "archive_task" | "compact_task" | "reset_task"; taskId?: string }
  | { kind: "resume_task" | "fork_task"; taskId?: string; selector?: string; threadId?: string; turnId?: string }
  | { kind: "approve" | "deny" | "grant_turn" | "grant_session"; taskId?: string; requestId?: string; replyCode?: string; option?: string }
  | { kind: "answer_user_input" | "answer_mcp_field" | "decide_mcp_url"; taskId?: string; requestId?: string; replyCode?: string; value: string }
  | { kind: "discard_images"; conversationId?: string; senderKey?: string }
  | { kind: "submit_images"; taskId?: string; instruction: string }
  | { kind: "show_help" | "list_tasks" | "list_projects" | "list_threads" | "list_archived" | "show_status" | "show_host" | "show_usage" | "show_summary" | "show_files" | "show_diff" | "show_logs" | "show_identity" }
  | { kind: "show_history"; selector?: string }
  | { kind: "select_project"; selector: string }
  | { kind: "search_threads"; query: string }
  | { kind: "unarchive_thread"; selector: string }
  | { kind: "service_status" | "service_logs" | "service_restart" }
  | { kind: "clarify"; question: string; candidateTaskIds: string[] };

export function parseSlashCommand(text: string): CommandAction | null {
  const trimmed = text.trim(); if (!trimmed.startsWith("/")) return null;
  const [command, ...rest] = split(trimmed); const argument = rest.join(" ");
  switch (command.toLowerCase()) {
    case "/help": return { kind: "show_help" }; case "/status": return { kind: "show_status" }; case "/host": case "/health": return { kind: "show_host" };
    case "/projects": return { kind: "list_projects" }; case "/project": case "/cd": return { kind: "select_project", selector: argument };
    case "/threads": case "/sessions": return { kind: "list_threads" }; case "/archived": return { kind: "list_archived" }; case "/history": return { kind: "show_history", selector: argument || undefined };
    case "/search": return { kind: "search_threads", query: argument }; case "/resume": return { kind: "resume_task", selector: argument || undefined }; case "/fork": return { kind: "fork_task", selector: argument || undefined };
    case "/compact": return { kind: "compact_task" }; case "/archive": return { kind: "archive_task" }; case "/unarchive": return { kind: "unarchive_thread", selector: argument };
    case "/retry": return { kind: "retry_task" }; case "/usage": return { kind: "show_usage" }; case "/new": case "/reset": return { kind: "reset_task" }; case "/stop": return { kind: "stop_task" }; case "/steer": return { kind: "steer_task", instruction: argument };
    case "/summary": return { kind: "show_summary" }; case "/files": return { kind: "show_files" }; case "/diff": return { kind: "show_diff" }; case "/logs": return { kind: "show_logs" }; case "/whoami": return { kind: "show_identity" };
    case "/plan": return { kind: "create_task", instruction: argument, collaborationMode: "plan" };
    case "/service": return argument === "status" || !argument ? { kind: "service_status" } : argument === "logs" ? { kind: "service_logs" } : argument === "restart" ? { kind: "service_restart" } : null;
    case "/approve": return { kind: "approve", replyCode: rest[0], option: rest[1] }; case "/permit": return { kind: rest[1] === "session" ? "grant_session" : rest[1] === "turn" ? "grant_turn" : "deny", replyCode: rest[0], option: rest[1] };
    case "/answer": return { kind: "answer_user_input", replyCode: rest[0], value: rest.slice(1).join(" " ) }; case "/mcp-answer": return { kind: "answer_mcp_field", replyCode: rest[0], value: rest.slice(1).join(" " ) }; case "/mcp-decide": return { kind: "decide_mcp_url", replyCode: rest[0], value: rest[1] ?? "" };
    default: return null;
  }
}

function split(text: string): string[] { return text.match(/(?:[^\s"]+|"(?:\\.|[^"])*")+/gu)?.map((part) => part.startsWith('"') && part.endsWith('"') ? JSON.parse(part) as string : part) ?? []; }
