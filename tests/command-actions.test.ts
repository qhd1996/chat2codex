import { describe, expect, test } from "bun:test";
import { parseSlashCommand } from "../src/core/command-actions.js";

describe("command actions", () => {
  test("maps the complete compatibility command surface", () => {
    const cases: Array<[string, string]> = [["/help","show_help"],["/status","show_status"],["/host","show_host"],["/projects","list_projects"],["/project 2","select_project"],["/threads","list_threads"],["/sessions","list_threads"],["/history 1","show_history"],["/search foo","search_threads"],["/resume 1","resume_task"],["/fork --turn 2","fork_task"],["/retry","retry_task"],["/usage","show_usage"],["/archive","archive_task"],["/archived","list_archived"],["/unarchive 1","unarchive_thread"],["/service status","service_status"],["/service logs","service_logs"],["/service restart","service_restart"],["/compact","compact_task"],["/plan inspect","create_task"],["/new","reset_task"],["/reset","reset_task"],["/cd C:\\repo","select_project"],["/stop","stop_task"],["/steer focus","steer_task"],["/answer abc value","answer_user_input"],["/mcp-answer abc field value","answer_mcp_field"],["/approve abc 1","approve"],["/permit abc session","grant_session"],["/mcp-decide abc accept","decide_mcp_url"],["/summary","show_summary"],["/files","show_files"],["/diff","show_diff"],["/logs","show_logs"],["/whoami","show_identity"]];
    for (const [input, kind] of cases) expect(parseSlashCommand(input)?.kind, input).toBe(kind);
  });
  test("does not manufacture privileged actions from unknown input", () => { expect(parseSlashCommand("ordinary task")).toBeNull(); expect(parseSlashCommand("/future unsafe")).toBeNull(); expect(parseSlashCommand("/service destroy")).toBeNull(); });
});
