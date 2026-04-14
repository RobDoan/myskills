#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  parseArgs,
  resolveLockFileContent,
  parseLockFileYaml,
  installSkillRepos,
} from "../lib/install.js";

const USAGE = `Usage: myskills install [-g]

Install agentskills.io skill repos from skill-repos.lock.yml.

Options:
  -g    Install skills globally`;

const { command, global: isGlobal } = parseArgs(process.argv);

if (command !== "install") {
  console.error(USAGE);
  process.exit(1);
}

try {
  const cwd = process.cwd();
  const { content, source } = await resolveLockFileContent(cwd);

  if (source === "local") {
    console.log("Using local skill-repos.lock.yml");
  } else {
    console.log("Fetching skill-repos.lock.yml from RobDoan/myskills...");
  }

  const repos = parseLockFileYaml(content);

  const execFn = (cmd, args) =>
    new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: "inherit" });
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`Exit code ${code}`))
      );
      child.on("error", reject);
    });

  const result = await installSkillRepos(repos, {
    global: isGlobal,
    execFn,
    log: (msg) => console.log(msg),
  });

  if (result.failed > 0) {
    console.error(`\nFailed to install: ${result.failures.join(", ")}`);
    console.log(`Done. ${result.installed} installed, ${result.failed} failed.`);
    process.exit(1);
  }

  console.log(`Done. ${result.installed} skill repos installed.`);
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
