#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  parseArgs,
  resolveConfigContent,
  parseConfigYaml,
  installSkillRepos,
  addRepoToConfig,
  saveConfigFile,
} from "../lib/install.js";

const USAGE = `Usage: myskills <command>

Commands:
  install [-g]       Install skill repos from skill-repos.yml
  add <repo>         Install all skills, add a new repo, and update config`;

const { command, global: isGlobal, repo } = parseArgs(process.argv);

const execFn = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`Exit code ${code}`))
    );
    child.on("error", reject);
  });

if (command === "install") {
  try {
    const cwd = process.cwd();
    const { content, source } = await resolveConfigContent(cwd);

    if (source === "local") {
      console.log("Using local skill-repos.yml");
    } else {
      console.log("Fetching skill-repos.yml from RobDoan/myskills...");
    }

    const repos = parseConfigYaml(content);

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
} else if (command === "add") {
  try {
    const cwd = process.cwd();

    // Step 1: Resolve config (download if no local copy)
    const { content, source } = await resolveConfigContent(cwd);

    if (source === "remote") {
      console.log("Fetching skill-repos.yml from RobDoan/myskills...");
      await saveConfigFile(cwd, content);
    } else {
      console.log("Using local skill-repos.yml");
    }

    // Step 2: Check if repo already in config
    const updated = addRepoToConfig(content, repo);
    if (updated === null) {
      console.log(`${repo} already exists in skill-repos.yml, skipping.`);
      process.exit(0);
    }

    // Step 3: Install all existing repos from config
    const repos = parseConfigYaml(content);
    const installResult = await installSkillRepos(repos, {
      global: false,
      execFn,
      log: (msg) => console.log(msg),
    });

    if (installResult.failed > 0) {
      console.error(`\nFailed to install: ${installResult.failures.join(", ")}`);
      console.log(`Done. ${installResult.installed} installed, ${installResult.failed} failed.`);
      process.exit(1);
    }

    // Step 4: Install the new repo
    console.log(`Installing ${repo}...`);
    try {
      await execFn("npx", ["skills", "add", "-p", repo]);
    } catch {
      console.error(`Failed to install ${repo}. Config not updated.`);
      process.exit(1);
    }

    // Step 5: Update config file
    await saveConfigFile(cwd, updated);
    console.log(`Added ${repo} to skill-repos.yml`);
    console.log("Done.");
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
} else {
  console.error(USAGE);
  process.exit(1);
}
