'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

async function run() {
  const root = process.env.CODEX_HOOK_TEST_ROOT;
  const result = { vscode: vscode.version, scope: 'real-IDE-public-command-local-fake-model' };
  try {
    const extension = vscode.extensions.getExtension('openai.chatgpt');
    await extension.activate();
    result.extensionVersion = extension.packageJSON.version;
    await vscode.commands.executeCommand('chatgpt.openSidebar');
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await vscode.commands.executeCommand('chatgpt.implementTodo', {
      line: 0,
      fileName: path.join(root, 'project', 'example.txt'),
      cwd: path.join(root, 'project'),
      comment: 'HOOK_FEASIBILITY_IDE: reply OK; do not use tools or change files.',
    });
    const events = path.join(root, 'project', '.codex', 'events');
    const until = Date.now() + 20000;
    while (Date.now() < until) {
      const observed = fs
        .readdirSync(events)
        .filter((name) => name.endsWith('.json'))
        .map((name) => JSON.parse(fs.readFileSync(path.join(events, name))));
      result.events = observed;
      if (observed.some((event) => event.event === 'Stop')) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    result.hookDelivery =
      result.events.some((event) => event.event === 'UserPromptSubmit') &&
      result.events.some((event) => event.event === 'Stop');
    if (!result.hookDelivery) throw new Error('IDE hook delivery failed');
    function completedTurns(directory) {
      if (!fs.existsSync(directory)) return [];
      return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) return completedTurns(target);
        if (!entry.name.endsWith('.jsonl')) return [];
        return fs
          .readFileSync(target, 'utf8')
          .split('\n')
          .flatMap((line) => {
            try {
              const record = JSON.parse(line);
              return record.type === 'event_msg' && record.payload?.type === 'task_complete'
                ? [record.payload.turn_id]
                : [];
            } catch {
              return [];
            }
          });
      });
    }
    const sessions = path.join(process.env.CODEX_HOME, 'sessions');
    const helper = path.join(root, 'project/.codex/observer.js');
    const source = fs.readFileSync(helper);
    result.failureCases = [];
    for (const label of ['receiver-absent', 'helper-missing', 'helper-hung', 'recovered']) {
      const before = new Set(completedTurns(sessions));
      if (label === 'receiver-absent') fs.renameSync(events, events + '-disabled');
      if (label === 'helper-missing') fs.renameSync(helper, helper + '-disabled');
      if (label === 'helper-hung') fs.writeFileSync(helper, 'setTimeout(() => {}, 10000);\n');
      const start = Date.now();
      try {
        await vscode.commands.executeCommand('chatgpt.implementTodo', {
          line: 0,
          fileName: path.join(root, 'project/example.txt'),
          cwd: path.join(root, 'project'),
          comment: 'HOOK_FEASIBILITY_' + label + ': reply OK without tools.',
        });
        const until = Date.now() + 15000;
        let completed = false;
        while (Date.now() < until) {
          completed = completedTurns(sessions).some((id) => !before.has(id));
          if (completed) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        result.failureCases.push({ label, completed, elapsedMs: Date.now() - start });
        if (!completed) throw new Error('IDE failed to complete: ' + label);
        // Let asynchronous helpers exit/timeout before the next condition.
        await new Promise((resolve) => setTimeout(resolve, label === 'helper-hung' ? 1200 : 250));
      } finally {
        if (label === 'receiver-absent') fs.renameSync(events + '-disabled', events);
        if (label === 'helper-missing') fs.renameSync(helper + '-disabled', helper);
        if (label === 'helper-hung') fs.writeFileSync(helper, source);
      }
    }
    result.failureIsolation = result.failureCases.every((entry) => entry.completed);
  } catch (error) {
    result.error = error.message;
  } finally {
    fs.writeFileSync(path.join(root, 'ide-result.json'), JSON.stringify(result, null, 2));
  }
}
module.exports = { run };
