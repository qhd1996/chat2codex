import { appendFile } from "node:fs/promises";
import { readPublicNativeLifecycleEvidence } from "../dist/quality/native-lifecycle-workflow-evidence.js";

const reportPath = process.argv[2] ?? ".tmp/native-lifecycle-status.json";
const evidence = await readPublicNativeLifecycleEvidence(reportPath, "publication");
let published = evidence;
if (process.env.GITHUB_STEP_SUMMARY) {
  try { await appendFile(process.env.GITHUB_STEP_SUMMARY, JSON.stringify(evidence) + "\n"); }
  catch { published = { schemaVersion: 1, verdict: "fail", failure: { stage: "workflow_publication/summary_write", code: "unavailable" }, cleanup: { attempted: false, succeeded: false } }; }
}
const source = JSON.stringify(published);
const escaped = source.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
const level = published.verdict === "pass" ? "notice" : "error";
process.stdout.write(`::${level} title=Native lifecycle evidence::${escaped}\n`);
process.exitCode = 0;
