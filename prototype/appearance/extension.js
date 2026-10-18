'use strict';
// Independent feasibility prototype. No production modules, Codex connection,
// ownership registry, watchdog, retry loop, or diagnostics service is imported.
const vscode = require('vscode');
const path = require('node:path');
const colors = { processing: '#245A91', finished: '#625B78', approval: '#A66B16' };
let session;

class WorkspaceColors {
  constructor() {
    this.owned = [];
    this.hadOverride = undefined;
  }
  async show(state, surface) {
    const config = vscode.workspace.getConfiguration('workbench');
    const current = config.inspect('colorCustomizations').workspaceValue;
    if (this.hadOverride === undefined) this.hadOverride = current !== undefined;
    const next = structuredClone(current || {});
    // Restore only values still matching this prototype's last write.
    for (const entry of this.owned) {
      const block = entry.block ? next[entry.block] : next;
      if (!block || block[entry.key] !== entry.applied) continue;
      if (entry.had) block[entry.key] = entry.original;
      else delete block[entry.key];
      if (entry.block && Object.keys(block).length === 0) delete next[entry.block];
    }
    this.owned = [];
    const background = colors[state],
      palette = {};
    if (background && surface !== 'titleBar') {
      Object.assign(palette, {
        'statusBar.background': background,
        'statusBar.inactiveBackground': background,
        'statusBar.debuggingBackground': background,
        'statusBar.noFolderBackground': background,
        'statusBar.foreground': '#FFFFFF',
        'statusBar.debuggingForeground': '#FFFFFF',
        'statusBar.noFolderForeground': '#FFFFFF',
        'statusBar.border': background,
      });
    }
    if (background && surface !== 'statusBar') {
      Object.assign(palette, {
        'titleBar.activeBackground': background,
        'titleBar.inactiveBackground': background,
        'titleBar.activeForeground': '#FFFFFF',
        'titleBar.inactiveForeground': '#FFFFFF',
        'titleBar.border': background,
      });
    }
    const blocks = new Set([
      '',
      ...Object.keys(config.get('colorCustomizations', {})).filter((key) => key.startsWith('[')),
    ]);
    if (background)
      for (const name of blocks) {
        const block = name ? (next[name] ||= {}) : next;
        for (const [key, applied] of Object.entries(palette)) {
          this.owned.push({
            block: name,
            key,
            applied,
            had: Object.hasOwn(block, key),
            original: block[key],
          });
          block[key] = applied;
        }
      }
    const value = !this.hadOverride && Object.keys(next).length === 0 ? undefined : next;
    await config.update('colorCustomizations', value, vscode.ConfigurationTarget.Workspace);
  }
}

function activate(context) {
  const overlay = new WorkspaceColors();
  let state = 'idle',
    surface = 'both',
    focused = vscode.window.state.focused;
  let queue = Promise.resolve(),
    failure;
  const render = () => {
    const requestedState = state,
      requestedSurface = surface;
    queue = queue
      .then(() => overlay.show(requestedState, requestedSurface))
      .catch((error) => {
        failure = error;
      });
    return queue.then(() => {
      if (failure) throw failure;
    });
  };
  const set = (next, nextSurface = surface) => {
    if (!['idle', ...Object.keys(colors)].includes(next)) throw new Error('Invalid fixture state');
    state = next;
    surface = nextSurface;
    return render();
  };
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((event) => {
      const returned = event.focused && !focused;
      focused = event.focused;
      if (returned && state === 'finished') set('idle').catch(console.error);
    }),
  );
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (focused && state === 'finished' && [1, 2].includes(event.kind))
        set('idle').catch(console.error);
    }),
  );
  const api = {
    set,
    settle: () => queue,
    snapshot: () => ({
      host: process.pid,
      state,
      focused: vscode.window.state.focused,
      surface,
      file:
        vscode.workspace.workspaceFile?.fsPath ||
        path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.vscode/settings.json'),
      colors: vscode.workspace.getConfiguration('workbench').inspect('colorCustomizations')
        .workspaceValue,
    }),
  };
  session = api;
  return api;
}
async function deactivate() {
  if (session) await session.set('idle');
}
module.exports = { activate, deactivate };
