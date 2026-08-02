const { spawn } = require("node:child_process");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  windowsHide: true,
  stdio: "ignore",
});
console.log("GRANDCHILD_PID=" + child.pid);
setInterval(() => {}, 1000);
