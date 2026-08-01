import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { OpenAiIntentClassifier } from "../src/runtime/openai-intent-classifier.js";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });

async function fixture(response: (body: string) => { status?: number; body: string; delay?: number }) {
  let received = "";
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      received = Buffer.concat(chunks).toString("utf8");
      const answer = response(received);
      setTimeout(() => { res.statusCode = answer.status ?? 200; res.setHeader("content-type", "application/json"); res.end(answer.body); }, answer.delay ?? 0);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, received: () => received };
}

describe("OpenAiIntentClassifier", () => {
  test("parses fenced JSON and sends bounded metadata without credentials", async () => {
    const f = await fixture(() => ({ body: JSON.stringify({ choices: [{ message: { content: "```json\n{\"intent\":\"stop\",\"confidence\":0.97}\n```" } }] }) }));
    const client = new OpenAiIntentClassifier({ baseUrl: f.baseUrl, model: "intent", timeoutMs: 1000 });
    expect(await client.classify({ text: "停一下", context: { hasThread: true, activeRun: true, pendingApprovalCount: 0, pendingPermissionCount: 0, hasImageDraft: false } }))
      .toEqual({ intent: "stop", confidence: 0.97 });
    expect(f.received()).toContain("停一下");
    expect(f.received()).not.toMatch(/authorization|token|secret/i);
  });

  test("rejects HTTP errors and times out", async () => {
    const bad = await fixture(() => ({ status: 500, body: "{}" }));
    await expect(new OpenAiIntentClassifier({ baseUrl: bad.baseUrl, model: "x", timeoutMs: 1000 }).classify({ text: "x", context: { hasThread: false, activeRun: false, pendingApprovalCount: 0, pendingPermissionCount: 0, hasImageDraft: false } })).rejects.toThrow(/500/);
    const slow = await fixture(() => ({ body: "{}", delay: 100 }));
    await expect(new OpenAiIntentClassifier({ baseUrl: slow.baseUrl, model: "x", timeoutMs: 10 }).classify({ text: "x", context: { hasThread: false, activeRun: false, pendingApprovalCount: 0, pendingPermissionCount: 0, hasImageDraft: false } })).rejects.toThrow();
  });
  test("sends task candidates without secret values", async () => {
    const f = await fixture(() => ({ body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ action: { kind: "stop_task", taskId: "tsk_1" }, imageDisposition: "none", confidence: 0.9 }) } }] }) }));
    const client = new OpenAiIntentClassifier({ baseUrl: f.baseUrl, model: "intent", timeoutMs: 1000 });
    expect(await client.classifyTask({ text: "停止酒店任务", conversationId: "wx", candidates: [{ taskId: "tsk_1", title: "酒店", aliases: [], workspaceKind: "travel", status: "running", objectiveSummary: "比较酒店", recentRequests: [] }], workspaces: [], pendingImageCount: 0, pendingInteractions: [] })).toMatchObject({ action: { taskId: "tsk_1" } });
    expect(f.received()).toContain("tsk_1");
    expect(f.received()).not.toMatch(/authorization|token|secret|replyCode/i);
  });

  test("preserves execution intent and constrains output-only classification", async () => {
    const f = await fixture(() => ({
      body: JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              action: {
                kind: "create_task",
                instruction: "生成一份新报告",
                workspaceKind: "work",
                executionIntent: "output_only",
              },
              imageDisposition: "none",
              confidence: 0.98,
            }),
          },
        }],
      }),
    }));
    const client = new OpenAiIntentClassifier({ baseUrl: f.baseUrl, model: "intent", timeoutMs: 1000 });

    expect(await client.classifyTask({
      text: "只生成一份新的报告，不修改工作区已有文件",
      conversationId: "wx",
      candidates: [],
      workspaces: [{ kind: "work", root: "C:\\Work", aliases: ["工作"] }],
      pendingImageCount: 0,
      pendingInteractions: [],
    })).toMatchObject({ action: { kind: "create_task", executionIntent: "output_only" } });

    const request = JSON.parse(f.received()) as { messages: Array<{ role: string; content: string }> };
    const systemPrompt = request.messages.find((message) => message.role === "system")?.content;
    expect(systemPrompt).toContain("executionIntent=output_only");
    expect(systemPrompt).toContain("explicitly requests creating new deliverables without modifying existing workspace files");
    expect(systemPrompt).toContain("otherwise use general");
  });

  test("instructs the task classifier to make explicit fail-closed image dispositions", async () => {
    const f = await fixture(() => ({ body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ action: { kind: "clarify", question: "图片属于哪个任务？", candidateTaskIds: [] }, imageDisposition: "clarify", confidence: 1 }) } }] }) }));
    const client = new OpenAiIntentClassifier({ baseUrl: f.baseUrl, model: "intent", timeoutMs: 1000 });
    await client.classifyTask({ text: "处理一下", conversationId: "wx", candidates: [], workspaces: [], pendingImageCount: 2, pendingInteractions: [] });
    const request = JSON.parse(f.received()) as { messages: Array<{ role: string; content: string }> };
    const prompt = request.messages.find((message) => message.role === "system")?.content ?? "";
    expect(prompt).toContain("imageDisposition=attach");
    expect(prompt).toContain("imageDisposition=discard");
    expect(prompt).toContain("imageDisposition=clarify");
    expect(prompt).toContain("pendingImageCount");
  });
});
