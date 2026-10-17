// Exact identities and observed storage aliases. A directory-name match alone
// remains medium-confidence; manifests and multiple markers provide evidence.
export const agentRules = [
  ['Claude', [], ['Claude', 'Claude-3p'], ['com.anthropic.claudefordesktop']],
  ['Claude Twin', [], ['Claude Twin', 'Claude Twin-3p']],
  ['Claude Code', ['.claude']], ['Codex', ['.codex', '.codex-one'], ['Codex', 'CodexOne', 'CodexOneRenderer', 'com.openai.codex'], ['com.openai.codex']],
  ['Cursor', ['.cursor'], ['Cursor']], ['Windsurf', ['.codeium/windsurf'], ['Windsurf']],
  ['Trae', ['.trae', '.trae-cn'], ['Trae', 'Trae CN']], ['Gemini / Antigravity', ['.gemini'], ['Antigravity']],
  ['Continue', ['.continue']], ['OpenCode', ['.config/opencode', '.local/share/opencode', '.local/state/opencode'], ['OpenCode', 'ai.opencode.desktop', 'opencode'], ['ai.opencode.desktop']],
  ['Pi', ['.pi/agent']], ['Grok', ['.grok']], ['Grok Bot', ['.grokbot'], ['Grok Bot'], ['com.anysphere.sand']],
  ['Hermes', ['.hermes', '.local/share/hermes-workspace'], ['Hermes'], ['com.nousresearch.hermes.setup']],
  ['Comate', ['.comate', '.comate-engine'], ['Comate'], ['com.baidu.comate.x']],
  ['Ducc / Baidu CC', ['.baidu-cc']], ['Kimi Code', ['.kimi', '.kimi-code']], ['Qwen Code', ['.qwen']], ['Kiro', ['.kiro'], ['Kiro']],
  ['Goose', ['.config/goose', '.local/share/goose']], ['Aider', ['.aider.conf.yml', '.aider.model.settings.yml']],
  ['Amp', ['.config/amp', '.local/share/amp']], ['OpenClaw', ['.openclaw'], ['openclaw']],
  ['CodeBuddy', ['.codebuddy'], ['CodeBuddy', 'CodeBuddyExtension']],
  ['WorkBuddy', ['.workbuddy', '.workbuddy-key-fallback'], ['WorkBuddy', 'com.workbuddy.workbuddy'], ['com.tencent.workbuddy.mac']],
  ['Qoder', ['.qoder', '.qoder-cn', '.qmind/.qoder-cn'], ['Qoder', 'Qoder CN', 'com.qodercn.app.stable', 'com.qoder.installer'], ['com.qoder.app', 'com.qodercn.app', 'com.qoder.installer']],
  ['CodeArts', ['.codearts'], ['codearts', 'CodeArts'], ['com.codearts.work']],
  ['DeepSeek dsh', ['.dsh']], ['Serena', ['.serena']], ['QMind', ['.qmind']], ['SheetAgent', ['.sheetagent']],
  ['DuMate / 千帆', ['.qianfan'], ['DuMate', 'qianfan-desktop-app'], ['com.baidu.qianfan.desktop']],
  ['Baidu XAgent', [], ['.Baidu XAgent'], ['com.baidu.xagent']],
  ['ima', [], ['com.tencent.imamac', 'ima.copilot'], ['com.tencent.imamac']],
  ['Relay Memory', [], ['Relay Memory App', 'Relay Memory']],
  ['Browser Use', ['.config/browser-use']], ['Agent Reach', ['.agent-reach']],
  ['共享 Agent 资源', ['.agents']],
  ['GitHub Copilot', ['.copilot']], ['Augment', ['.augment']], ['iFlow', ['.iflow']], ['Crush', ['.config/crush', '.local/share/crush']],
  ['LM Studio', ['.lmstudio/models'], ['LM Studio']], ['Jan', [], ['Jan']], ['AnythingLLM', [], ['AnythingLLM']],
  ['ChatGPT', [], ['ChatGPT'], ['com.openai.chat']], ['Ollama', ['.ollama/models']], ['Hugging Face', ['.cache/huggingface']], ['PyTorch', ['.cache/torch']],
];

export const packageIdentities = new Map([
  ['@anthropic-ai/claude-code', 'Claude Code'], ['@openai/codex', 'Codex'], ['opencode-ai', 'OpenCode'], ['@opencode-ai/desktop', 'OpenCode'],
  ['@google/gemini-cli', 'Gemini / Antigravity'], ['@qwen-code/qwen-code', 'Qwen Code'], ['openclaw', 'OpenClaw'],
  ['@deepseek-ai/dsh', 'DeepSeek dsh'], ['@sourcegraph/amp', 'Amp'], ['@github/copilot', 'GitHub Copilot'],
  ['@augmentcode/auggie', 'Augment'], ['@iflow-ai/iflow-cli', 'iFlow'], ['Comate', 'Comate'],
  ['hermes-agent', 'Hermes'], ['hermes-workspace', 'Hermes'],
  ['@mariozechner/pi-coding-agent', 'Pi'], ['@earendil-works/pi-coding-agent', 'Pi'],
]);
export const componentIdentities = new Map([
  ...['@mariozechner', '@earendil-works'].flatMap(scope => [
    [`${scope}/pi-coding-agent`, ['Pi', '内嵌编码引擎']], [`${scope}/pi-agent-core`, ['Pi', '代理运行库']],
    [`${scope}/pi-ai`, ['Pi', '模型访问库']], [`${scope}/pi-tui`, ['Pi', '终端界面库']],
  ]),
  ['@anthropic-ai/claude-agent-sdk', ['Claude Code', 'Agent SDK']], ['@anthropic-ai/claude-code', ['Claude Code', '内嵌 CLI']],
  ['@openai/codex-sdk', ['Codex', 'Agent SDK']], ['@openai/codex', ['Codex', '内嵌 CLI']],
  ['@opencode-ai/sdk', ['OpenCode', 'Agent SDK']], ['opencode-ai', ['OpenCode', '内嵌 CLI']],
  ['@google/gemini-cli-core', ['Gemini / Antigravity', 'Agent 核心']], ['@google/gemini-cli', ['Gemini / Antigravity', '内嵌 CLI']],
  ['@qwen-code/qwen-code', ['Qwen Code', '内嵌 CLI']], ['@openclaw/ai', ['OpenClaw', '模型运行库']],
  ['@zed-industries/claude-code-acp', ['Claude Code', 'ACP 适配组件']],
]);
export const extensionIdentities = new Map([
  ['baidu.baidu-cc', 'Ducc / Baidu CC'], ['baiducomate.comate', 'Comate'], ['continue.continue', 'Continue'],
  ['saoudrizwan.claude-dev', 'Cline'], ['rooveterinaryinc.roo-cline', 'Roo Code'], ['kilocode.kilo-code', 'Kilo Code'],
  ['github.copilot', 'GitHub Copilot'], ['github.copilot-chat', 'GitHub Copilot'], ['augment.vscode-augment', 'Augment'],
  ['anthropic.claude-code', 'Claude Code'], ['openai.chatgpt', 'Codex'],
]);
export const pythonIdentities = new Map([['hermes-agent', 'Hermes'], ['browser-use', 'Browser Use'], ['aider-chat', 'Aider'], ['serena-agent', 'Serena'], ['agent-reach', 'Agent Reach'], ['kimi-cli', 'Kimi Code']]);
export const commandIdentities = new Map([
  ['claude', 'Claude Code'], ['codex', 'Codex'], ['opencode', 'OpenCode'], ['pi', 'Pi'], ['grok', 'Grok'], ['hermes', 'Hermes'],
  ['comate', 'Comate'], ['ducc', 'Ducc / Baidu CC'], ['qwen', 'Qwen Code'], ['kimi', 'Kimi Code'], ['dsh', 'DeepSeek dsh'],
  ['openclaw', 'OpenClaw'], ['qoder', 'Qoder'], ['qodercli', 'Qoder'], ['qoder-cn', 'Qoder'], ['qodercn', 'Qoder'],
  ['codebuddy', 'CodeBuddy'], ['amp', 'Amp'], ['goose', 'Goose'], ['aider', 'Aider'], ['copilot', 'GitHub Copilot'],
  ['auggie', 'Augment'], ['iflow', 'iFlow'], ['crush', 'Crush'], ['browser-use', 'Browser Use'], ['agent-reach', 'Agent Reach'],
]);
export const signatureRules = [
  ['Grok', ['config.toml', 'agent_id', 'active_sessions.json']], ['Grok Bot', ['.grokbot-data-root-v1']],
  ['Hermes', ['config.yaml', 'SOUL.md', 'state.db']], ['Comate', ['.baidu-cx', 'ctrl-servers.json']],
  ['Serena', ['serena_config.yml', 'language_servers']], ['WorkBuddy', ['workbuddy.db', 'workspace-state.json', 'tasks']],
  ['Qoder', ['.qoder-app-status.json', 'installation_id', 'entry']], ['CodeArts', ['skills-config.json', 'agent-team', 'kernel']],
];
export const additionalCaches = new Map([['OpenCode', ['.cache/opencode']], ['LM Studio', ['.cache/lm-studio']]]);
export const installationRoots = new Map([['Codex', ['.cache/codex-runtimes']], ['Grok', ['.grok/bin', '.grok/downloads', '.grok/bundled']], ['Comate', ['.local/share/comate']]]);
export const installationNames = new Map([
  ['Qoder', ['.bin', 'bin', 'entry', 'app']], ['Hermes', ['bin', 'node', 'hermes-agent', 'runtime']],
  ['Comate', ['bin', 'extensions', '.baidu-cx', 'baidu-cc', 'better-sqlite3', 'zulu-cli']],
  ['WorkBuddy', ['binaries', 'app']], ['Serena', ['language_servers']], ['OpenCode', ['node_modules', 'bin']],
]);
export const embeddedCommands = [['Comate', 'Codex', '.comate/.baidu-cx/baidu-cx/codex/bin/codex'], ['Comate', 'Ducc / Baidu CC', '.comate/.baidu-cx/baidu-cx/bin/ducx']];
const transientNames = new Map([
  ['Claude Code', ['debug']], ['Hermes', ['audio_cache', 'image_cache', 'bootstrap-cache']], ['Grok', ['marketplace-cache']],
  ['Grok Bot', ['attachment-image-cache', 'link-favicon-cache', 'link-preview-cache', 'plugin-logo-cache', 'v8-code-cache']],
  ['Comate', ['mcp-log', 'performance-log']], ['CodeArts', ['app-logs', 'npm-cache']], ['Ducc / Baidu CC', ['reportlog']],
]);
export const cacheLeaves = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'ShaderCache', 'CachedData', 'CachedExtensionVSIXs', 'cache', '.cache', 'caches', 'logs', 'Logs', 'log']);
export function storageCategory(tool, name) {
  if (['logs', 'Logs', 'log', 'mcp-log', 'performance-log', 'app-logs', 'reportlog'].includes(name) || tool === 'Claude Code' && name === 'debug' || /\.log(?:\.\d+)?(?:\.gz)?$/.test(name)) return 'log';
  return cacheLeaves.has(name) || transientNames.get(tool)?.includes(name) ? 'cache' : 'state';
}
