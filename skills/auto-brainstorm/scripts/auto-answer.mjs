import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { loadConfig, resolvePromptPath } from './config.mjs';
import { SessionState } from './state.mjs';
import { Logger } from './logger.mjs';
import { buildClassifierPrompt, parseClassifierResponse, classify } from './classifier.mjs';
import { getHandler } from './handlers/index.mjs';
import { buildAnswersMap } from './answer-mapper.mjs';

function resolveProjectDir() {
  // Claude Code sets this env var for hooks
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  // Fallback: git root
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

export async function orchestrate({ question, configPath, pluginRoot, sessionPid }) {
  const logPath = path.join('/tmp', `auto-brainstorm-${sessionPid}.log`);
  const logger = new Logger(logPath);

  // Load config
  const defaultConfigPath = path.join(pluginRoot, 'config', 'default.yml');
  let config;
  try {
    config = loadConfig(configPath, defaultConfigPath);
  } catch (err) {
    logger.log(`config error: ${err.message}`);
    return { action: 'escalate', reason: `Config error: ${err.message}` };
  }

  // Load brief
  const briefPath = config.session?.brief_path || '.claude/auto-brainstorm-brief.md';
  const projectDir = resolveProjectDir();
  const resolvedBriefPath = path.isAbsolute(briefPath)
    ? briefPath
    : path.join(projectDir, briefPath);

  if (!fs.existsSync(resolvedBriefPath)) {
    logger.log('no brief file found');
    return { action: 'escalate', reason: 'No design brief found. Please provide one.' };
  }
  const brief = fs.readFileSync(resolvedBriefPath, 'utf8');

  // Load state
  const stateDir = config.session?.state_dir || '/tmp';
  const statePath = path.join(stateDir, `auto-brainstorm-${sessionPid}.json`);
  const state = new SessionState(statePath, sessionPid);

  // Check escalation before doing work
  const maxRejections = config.classifier?.max_consecutive_rejections || 3;
  if (state.shouldEscalate(maxRejections)) {
    logger.log(`escalating: ${state.data.consecutive_rejections} consecutive rejections`);
    return {
      action: 'escalate',
      reason: `Auto-answer couldn't satisfy this question after ${maxRejections} attempts.`,
    };
  }

  // Classify question
  const classifierConfig = {
    model: config.classifier?.model || 'haiku',
    promptPath: resolvePromptPath('prompts/classifier.md', pluginRoot),
  };

  let classification;
  try {
    classification = await classify(
      question,
      config.agents,
      state.getHistory(),
      classifierConfig
    );
    logger.log(
      `classifier → ${classification?.agent} (${classification?.confidence})`
    );
  } catch (err) {
    logger.log(`classifier error: ${err.message}`);
    return { action: 'escalate', reason: `Classifier error: ${err.message}` };
  }

  if (!classification) {
    logger.log('classifier returned unparseable response');
    return { action: 'escalate', reason: 'Classifier could not determine agent.' };
  }

  // Check confidence
  const threshold = config.classifier?.confidence_threshold || 0.7;
  if (classification.confidence < threshold) {
    logger.log(
      `low confidence: ${classification.confidence} < ${threshold}`
    );
    return { action: 'escalate', reason: `Low classifier confidence: ${classification.confidence}` };
  }

  // Get agent config
  const agentName = classification.agent;
  const agentConfig = config.agents[agentName];
  if (!agentConfig) {
    // Fallback to first agent by order
    const fallback = Object.entries(config.agents)
      .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0))[0];
    logger.log(`unknown agent "${agentName}", falling back to "${fallback[0]}"`);
    return orchestrateAgent(fallback[0], fallback[1], question, brief, state, logger, pluginRoot);
  }

  return orchestrateAgent(agentName, agentConfig, question, brief, state, logger, pluginRoot);
}

async function orchestrateAgent(agentName, agentConfig, question, brief, state, logger, pluginRoot) {
  const handler = getHandler(agentConfig.handler);

  // Load prompt content (for SDK handler)
  let promptContent = '';
  if (agentConfig.prompt) {
    try {
      const promptPath = resolvePromptPath(agentConfig.prompt, pluginRoot);
      promptContent = fs.readFileSync(promptPath, 'utf8');

      // Inject response-format if referenced
      const responseFormatPath = resolvePromptPath('prompts/response-format.md', pluginRoot);
      if (fs.existsSync(responseFormatPath)) {
        const responseFormat = fs.readFileSync(responseFormatPath, 'utf8');
        promptContent = promptContent.replace('{{response-format}}', responseFormat);
      }
    } catch (err) {
      logger.log(`prompt load error: ${err.message}`);
      return { action: 'escalate', reason: `Prompt load error: ${err.message}` };
    }
  }

  // Dispatch
  let answer;
  const startTime = Date.now();
  try {
    answer = await handler(question, brief, agentConfig, promptContent);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.log(`${agentName} (${agentConfig.model}) → ${answer.length} chars, ${duration}s`);
  } catch (err) {
    logger.log(`${agentName} handler error: ${err.message}`);
    state.recordRejection();
    state.save();
    return { action: 'escalate', reason: `Agent error: ${err.message}` };
  }

  // Update state
  state.recordNewQuestion();
  state.recordAnswer(agentName, answer);
  state.save();

  return { action: 'answer', answer, agent: agentName };
}

// CLI entry point — runs when invoked by hook
const isMain = process.argv[1] === new URL(import.meta.url).pathname;

if (isMain && process.stdin.isTTY === undefined) {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0); // unparseable payload: let tool run normally
  }

  // AskUserQuestion payload shape: tool_input.questions = [{question, options, ...}]
  // Older/alternate shapes fall back to tool_input.question / tool_input.text as a string.
  const questions = payload?.tool_input?.questions;
  const questionText = Array.isArray(questions) && questions.length > 0
    ? questions.map((q) => q.question).join('\n---\n')
    : (payload?.tool_input?.question || payload?.tool_input?.text || '');

  if (!questionText) {
    process.exit(0);
  }

  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT
    || path.resolve(new URL('.', import.meta.url).pathname, '..');
  const projectDir = resolveProjectDir();
  const configPath = path.join(projectDir, '.claude', 'auto-brainstorm.yml');
  const sessionPid = process.env.CLAUDE_SESSION_ID
    || process.ppid?.toString()
    || process.pid.toString();

  let result;
  try {
    result = await orchestrate({
      question: questionText,
      configPath,
      pluginRoot,
      sessionPid,
    });
  } catch (err) {
    process.stderr.write(`auto-brainstorm unexpected error: ${err.message}\n`);
    process.exit(0);
  }

  if (result.action === 'answer' && Array.isArray(questions) && questions.length > 0) {
    const { answers, unmatched } = buildAnswersMap(questions, result.answer);

    if (unmatched.length > 0) {
      // Record as rejection so the 3-strikes escalation advances.
      try {
        const cfg = loadConfig(configPath, path.join(pluginRoot, 'config', 'default.yml'));
        const stateDir = cfg.session?.state_dir || '/tmp';
        const statePath = path.join(stateDir, `auto-brainstorm-${sessionPid}.json`);
        const state = new SessionState(statePath, sessionPid);
        state.recordRejection();
        state.save();
      } catch {
        /* best effort; never make things worse than vanilla */
      }
      process.stderr.write(
        `auto-brainstorm: could not map answer for: ${unmatched.join(', ')}\n`
      );
      process.exit(0);
    }

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: { questions, answers },
      },
    }));
    process.exit(0);
  }

  if (result.action === 'answer') {
    // Non-AskUserQuestion shape (legacy text): we cannot synthesize a typed
    // tool result reliably, so escalate cleanly and let the tool run.
    process.stderr.write(
      `auto-brainstorm: ${result.agent} suggested: ${result.answer}\n` +
      `Tool call will run normally.\n`
    );
    process.exit(0);
  }

  // escalate
  if (result.reason) process.stderr.write(result.reason);
  process.exit(0);
}
