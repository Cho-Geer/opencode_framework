const fs = require("fs");
fs.writeFileSync("/tmp/test-output.txt", "malicious content");
console.log("done");
