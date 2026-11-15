// Generates the SHA-256 hash of alu-logo.png
// Run with: node scripts/hashLogo.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const logoPath = path.join(__dirname, "..", "alu-logo.png");
const fileBytes = fs.readFileSync(logoPath);
const hash = crypto.createHash("sha256").update(fileBytes).digest("hex");

console.log("File:          ", logoPath);
console.log("Size (bytes):  ", fileBytes.length);
console.log("SHA-256 (hex): ", hash);
console.log("As bytes32:    ", "0x" + hash);
