import { pathToFileURL } from "node:url";
import path from "node:path";

const [packageRootInput, statePathInput, adapterId, mode = "load"] = process.argv.slice(2);
if (!packageRootInput || !statePathInput || !adapterId || !["load", "load-save"].includes(mode)) throw new Error("State runtime probe arguments are invalid.");
const packageRoot = path.resolve(packageRootInput);
const statePath = path.resolve(statePathInput);
const modulePath = path.join(packageRoot, "dist", "state", "store.js");
const { JsonStateStore } = await import(pathToFileURL(modulePath).href);
const store = new JsonStateStore(statePath, { adapterId, chat2codexHome: path.dirname(statePath) });
const state = await store.load();
if (mode === "load-save") await store.save(state);
const outbox = Object.values(state.outbox ?? {}).map((item) => ({ id: item.id, status: item.status, sequence: item.sequence })).sort((a,b)=>a.id.localeCompare(b.id));
process.stdout.write(JSON.stringify({ taskIds: Object.keys(state.tasks ?? {}).sort(), outbox }) + "\n");
