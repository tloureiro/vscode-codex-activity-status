'use strict';
const crypto = require('node:crypto');
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const PRESENTATION = {
  working: {
    title: 'Working',
    detail: 'Activity observed in this project',
    color: '#2864e8',
    ink: '#ffffff',
    symbol: '◌',
  },
  attention: {
    title: 'Attention requested',
    detail: 'Check the latest request in Codex',
    color: '#edb537',
    ink: '#27200f',
    symbol: '!',
  },
  finished: {
    title: 'Finished',
    detail: 'Ready for your review',
    color: '#8453d6',
    ink: '#ffffff',
    symbol: '✓',
  },
  interrupted: {
    title: 'Interrupted',
    detail: 'The turn ended before completion',
    color: '#454553',
    ink: '#ffffff',
    symbol: '■',
  },
  checking: {
    title: 'Checking outcome',
    detail: 'Waiting for the final session record',
    color: '#454553',
    ink: '#ffffff',
    symbol: '…',
  },
  failed: {
    title: 'Failed',
    detail: 'Check the error in Codex',
    color: '#a13e4b',
    ink: '#ffffff',
    symbol: '!',
  },
  unknown: {
    title: 'Activity unknown',
    detail: 'No recent signal · check Codex',
    color: '#454553',
    ink: '#ffffff',
    symbol: '?',
  },
  idle: {
    title: 'Ready',
    detail: 'No unread completions',
    color: '#303039',
    ink: '#e5e5ef',
    symbol: '○',
  },
};
function presentation(model) {
  if (!model.enabled)
    return {
      title: 'Monitoring off',
      detail: 'Enable activity monitoring to receive project signals',
      color: '#303039',
      ink: '#e5e5ef',
      symbol: '○',
    };
  if (!model.project)
    return {
      title: 'Open a local project',
      detail: 'Activity is available in local macOS workspaces',
      color: '#303039',
      ink: '#e5e5ef',
      symbol: '○',
    };
  if (model.health.code === 'error' || model.health.code === 'conflict')
    return {
      title: 'Setup needs attention',
      detail: model.health.detail,
      color: '#303039',
      ink: '#e5e5ef',
      symbol: '!',
    };
  if (['setup', 'repair'].includes(model.health.code))
    return {
      title: model.health.code === 'repair' ? 'Update project hooks' : 'Enable project activity',
      detail: model.health.detail,
      color: '#303039',
      ink: '#e5e5ef',
      symbol: '○',
    };
  if (!model.summary.connected && !model.summary.unread)
    return {
      title: 'Waiting for activity',
      detail: 'Open Codex settings → Hooks, review the Codex Activity hooks, then start a new chat',
      color: '#303039',
      ink: '#e5e5ef',
      symbol: '○',
    };
  return PRESENTATION[model.summary.state] || PRESENTATION.unknown;
}
function html(model) {
  const p = presentation(model);
  const nonce = crypto.randomBytes(18).toString('base64');
  const install = model.enabled && model.project && ['setup', 'repair'].includes(model.health.code);
  const acknowledge = model.summary.unread > 0;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
  *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;min-height:90px}body{font-family:var(--vscode-font-family);background:${p.color};color:${p.ink}}
  main{height:100%;min-height:90px;display:flex;align-items:center;gap:20px;padding:16px 28px;overflow:hidden}
  .symbol{font-size:36px;font-weight:600;width:48px;min-width:48px;height:48px;display:grid;place-items:center;border:3px solid currentColor;border-radius:${model.summary.state === 'attention' ? '10px' : '50%'};line-height:1}
  h1{font-size:clamp(18px,3vw,27px);letter-spacing:-.5px;font-weight:650;margin:0 0 5px}.detail{font-size:12px;opacity:.9;line-height:1.4;max-width:65ch}.right{margin-left:auto;text-align:right;min-width:100px}.project{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600}.scope{font-size:10px;opacity:.8;margin-top:5px}
  .actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end;margin-top:10px}button{cursor:pointer;background:transparent;color:inherit;border:1px solid currentColor;border-radius:5px;padding:5px 9px;font-family:inherit;font-size:11px}button:hover{background:#ffffff20}button:focus-visible{outline:2px solid currentColor;outline-offset:2px}
  @media(max-width:500px){main{gap:12px;padding:12px}.symbol{min-width:35px;width:35px;height:35px;font-size:25px}.right{min-width:65px}.scope{display:none}.detail{font-size:11px}}
  </style></head><body><main role="status" aria-live="polite"><div class="symbol" aria-hidden="true">${p.symbol}</div><div><h1>${escape(p.title)}</h1><div class="detail">${escape(p.detail)}</div></div><div class="right"><div class="project">${escape(model.projectName || 'Codex Activity')}</div><div class="scope">${escape(model.sessionId ? 'Thread ' + model.sessionId.slice(0, 8) : 'All project conversations')}</div><div class="actions">${install ? '<button data-action="install">' + (model.health.code === 'repair' ? 'Update hooks' : 'Install project hooks') + '</button>' : ''}${acknowledge ? '<button data-action="acknowledge">Acknowledge</button>' : ''}${model.project ? '<button data-action="select">Choose scope</button>' : ''}${model.health.code === 'conflict' ? '<button data-action="openHooks">Review hooks</button>' : ''}</div></div></main>
  <script nonce="${nonce}">const api=acquireVsCodeApi();document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>api.postMessage({action:button.dataset.action})));</script></body></html>`;
}
class ActivityView {
  constructor(getModel, onAction) {
    this.getModel = getModel;
    this.onAction = onAction;
  }
  resolveWebviewView(view) {
    this.view = view;
    this.signature = null;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    this.message = view.webview.onDidReceiveMessage((message) => {
      if (message && ['install', 'acknowledge', 'select', 'openHooks'].includes(message.action))
        this.onAction(message.action);
    });
    this.visibility = view.onDidChangeVisibility(() => {
      if (view.visible) this.update();
    });
    view.onDidDispose(() => {
      this.message?.dispose();
      this.visibility?.dispose();
      this.view = null;
    });
    this.update();
  }
  update() {
    const model = this.getModel();
    const signature = JSON.stringify(model);
    if (this.view && signature !== this.signature) {
      this.view.webview.html = html(model);
      this.signature = signature;
    }
  }
  dispose() {
    this.message?.dispose();
    this.visibility?.dispose();
  }
}
module.exports = { ActivityView, presentation, html };
