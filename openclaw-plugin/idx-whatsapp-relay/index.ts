import {
  createWhatsappRelayHandler,
  resolveRelayConfig,
} from "./relay.ts";

type PluginApi = {
  pluginConfig?: Record<string, unknown>;
  logger: { error(message: string): void };
  on(
    hook: "before_agent_reply",
    handler: ReturnType<typeof createWhatsappRelayHandler>,
    options?: { priority?: number; timeoutMs?: number },
  ): void;
};

export default {
  id: "idx-whatsapp-relay",
  name: "IDX WhatsApp Relay",
  description: "Routes permitted WhatsApp messages directly to the IDX multi-agent coordinator.",
  register(api: PluginApi): void {
    const config = resolveRelayConfig(api.pluginConfig);
    api.on(
      "before_agent_reply",
      createWhatsappRelayHandler(config, {
        onError(error) {
          const message = error instanceof Error ? error.message : String(error);
          api.logger.error(`idx-whatsapp-relay: ${message}`);
        },
      }),
      { priority: 1_000, timeoutMs: config.timeoutMs + 1_000 },
    );
  },
};
