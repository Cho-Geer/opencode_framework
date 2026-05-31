// safe_bash: allow-write
const fs = require("fs");
fs.writeFileSync("/tmp/test-output.txt", "opted-in content");
console.log("done with opt-in");
