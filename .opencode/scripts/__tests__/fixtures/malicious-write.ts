const fs = require("fs");
fs.writeFileSync("/tmp/test-output.txt", "malicious content in __tests__");
console.log("done-__tests__");
