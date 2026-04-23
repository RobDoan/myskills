import { handleSdk } from './sdk.mjs';
import { handleWebhook } from './webhook.mjs';
import { handleCommand } from './command.mjs';
import { handleHcom } from './hcom.mjs';

const handlers = {
  sdk: handleSdk,
  webhook: handleWebhook,
  command: handleCommand,
  hcom: handleHcom,
};

export function getHandler(type) {
  const handler = handlers[type];
  if (!handler) throw new Error(`Unknown handler type: "${type}"`);
  return handler;
}
