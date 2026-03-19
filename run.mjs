#!/usr/bin/env node
import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";

const ROOT = import.meta.dirname;
const EXT_APPS = resolve(ROOT, "ext-apps");
const BASIC_HOST = resolve(EXT_APPS, "examples/basic-host");

// Parse server URLs from args or default to localhost:3001
const args = process.argv.slice(2);
const servers = args.length > 0 ? args : ["http://localhost:3001/mcp"];

// Clone ext-apps if not present
if (!existsSync(EXT_APPS)) {
  console.log("Cloning ext-apps...");
  execSync("git clone https://github.com/modelcontextprotocol/ext-apps.git", {
    cwd: ROOT,
    stdio: "inherit",
  });
  console.log("Installing dependencies...");
  execSync("npm install", { cwd: EXT_APPS, stdio: "inherit" });
}

const serversJson = JSON.stringify(servers);
console.log(`\nStarting basic-host with servers: ${serversJson}`);
console.log("Open http://localhost:8080 to test your MCP Apps\n");

execSync(`npm run start`, {
  cwd: BASIC_HOST,
  stdio: "inherit",
  env: { ...process.env, SERVERS: serversJson },
});
