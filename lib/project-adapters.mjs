import path from 'node:path';
import { agentRules } from './agent-catalog.mjs';
import { within } from './project-discovery.mjs';

// Discovery supplies locations; adapters define formats, never a user's home.
export function projectProfiles(snapshot, home) {
  const profiles = new Map((snapshot.discovery?.profiles || []).map(row => [row.path, row]));
  if (!snapshot.discovery?.profiles) for (const [agent, locations = []] of agentRules) for (const relative of locations) {
    const base = path.join(home, relative);
    if (snapshot.items.some(row => within(row.path, base) || within(base, row.path))) profiles.set(base, { agent, path: base, role: 'profile' });
  }
  for (const row of snapshot.items) {
    if (row.installation || row.installedComponent || !['state', undefined].includes(row.aiCategory || row.aiKind)) continue;
    if (![...profiles.keys()].some(base => within(row.path, base))) profiles.set(row.path, { agent: row.aiTool, path: row.path, role: 'profile' });
  }
  return [...profiles.values()].filter(row => within(row.path, home));
}

export const databaseAdapters = {
  Hermes: [['projects.db', 'project_folders', ['project_id', 'path'], 'path', 'workspace'], ['state.db', 'sessions', ['id', 'cwd', 'title'], 'cwd']],
  WorkBuddy: [['workbuddy.db', 'sessions', ['id', 'cwd', 'title'], 'cwd']],
  OpenCode: [['opencode.db', 'session', ['id', 'directory', 'title'], 'directory']],
  Grok: [['sessions/session_search.sqlite', 'session_docs', ['session_id', 'cwd', 'title'], 'cwd']],
};
export const sessionDirectories = {
  'Claude Code': ['projects'], WorkBuddy: ['projects'], Comate: ['projects'], Pi: ['sessions'], Codex: ['sessions', 'archived_sessions'],
};
