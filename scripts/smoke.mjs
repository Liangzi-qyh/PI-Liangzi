import { RpcClient } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { homedir } from "node:os";

const entryPath = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const cliPath = path.join(path.dirname(entryPath), "cli.js");
const cwd = path.resolve("..");

const client = new RpcClient({
  cliPath,
  cwd,
  env: { PI_CODING_AGENT_DIR: path.join(homedir(), ".pi", "agent") },
  args: ["--continue"],
});

await client.start();
try {
  const state = await client.getState();
  const models = await client.getAvailableModels();
  const commands = await client.getCommands();
  console.log(JSON.stringify({
    cwd,
    model: state.model ? { provider: state.model.provider, id: state.model.id } : null,
    models: models.map((model) => ({ provider: model.provider, id: model.id, name: model.name })),
    commands: commands.map((command) => command.name),
  }, null, 2));
} finally {
  await client.stop();
}
