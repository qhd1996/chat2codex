import { readPublicNativeLifecycleEvidence } from "../dist/quality/native-lifecycle-workflow-evidence.js";

const reportPath = process.argv[2] ?? ".tmp/native-lifecycle-status.json";
const evidence = await readPublicNativeLifecycleEvidence(reportPath, "enforcement");
process.stdout.write("NATIVE_LIFECYCLE_ENFORCE " + JSON.stringify(evidence) + "\n");
if (evidence.verdict !== "pass") process.exitCode = 1;
