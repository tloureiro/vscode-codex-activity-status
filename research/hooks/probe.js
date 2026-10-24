'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { runTests } = require('@vscode/test-electron');
const { Client } = require('./rpc');

async function main() {
  const project = path.resolve(__dirname, '../..');
  const manifest = JSON.parse(fs.readFileSync(path.join(project, 'sources/manifest.json')));
  const root = fs.mkdtempSync('/private/tmp/codex-hook-feasibility-');
  const workspace = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const hookDir = path.join(workspace, '.codex');
  const eventDir = path.join(hookDir, 'events');
  for (const dir of [
    codexHome,
    eventDir,
    path.join(root, 'user/User'),
    path.join(root, 'extensions'),
  ])
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.copyFileSync(path.join(__dirname, 'helper.js'), path.join(hookDir, 'observer.js'));
  fs.writeFileSync(path.join(workspace, 'example.txt'), 'Disposable hook test.\n');
  const events = [
    'SessionStart',
    'UserPromptSubmit',
    'PreToolUse',
    'PermissionRequest',
    'PostToolUse',
    'Stop',
    'Interrupt',
  ];
  const hooks = Object.fromEntries(
    events.map((event) => [
      event,
      [
        {
          hooks: [
            {
              type: 'command',
              command: `'${process.execPath}' '${path.join(hookDir, 'observer.js')}'`,
              async: true,
              timeout: 1,
            },
          ],
        },
      ],
    ]),
  );
  fs.writeFileSync(path.join(hookDir, 'hooks.json'), JSON.stringify({ hooks }, null, 2));
  const env = { ...process.env, CODEX_HOME: codexHome, CODEX_HOOK_TEST_ROOT: root };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const key of Object.keys(env))
    if (
      /^(OPENAI|ANTHROPIC|AZURE_OPENAI|CHATGPT)_/.test(key) ||
      (key.startsWith('CODEX_') && !['CODEX_HOME', 'CODEX_HOOK_TEST_ROOT'].includes(key))
    )
      env[key] = '';
  let modelCalls = 0;
  let responseMode = 'normal';
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (!req.url.endsWith('/responses')) {
        res.writeHead(404).end();
        return;
      }
      modelCalls++;
      if (responseMode === 'hold') return;
      const id = 'response-' + modelCalls;
      const values = [
        { type: 'response.created', response: { id } },
        {
          type: 'response.output_item.done',
          item: {
            type: 'message',
            role: 'assistant',
            id: 'msg-' + modelCalls,
            content: [{ type: 'output_text', text: 'OK' }],
          },
        },
        {
          type: 'response.completed',
          response: { id, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } },
        },
      ];
      if (responseMode === 'approval') {
        responseMode = 'normal';
        values[1] = {
          type: 'response.output_item.done',
          item: {
            type: 'function_call',
            call_id: 'test-approval',
            name: 'exec_command',
            arguments: JSON.stringify({
              cmd: '/bin/echo HOOK_FEASIBILITY',
              sandbox_permissions: 'require_escalated',
              justification: 'Disposable hook feasibility test',
            }),
          },
        };
      }
      if (responseMode === 'question') {
        responseMode = 'normal';
        values[1] = {
          type: 'response.output_item.done',
          item: {
            type: 'function_call',
            call_id: 'test-question',
            name: 'request_user_input',
            arguments: JSON.stringify({
              questions: [
                {
                  id: 'confirm',
                  header: 'Confirm',
                  question: 'Continue the disposable test?',
                  options: [
                    { label: 'Yes', description: 'Continue.' },
                    { label: 'No', description: 'Stop.' },
                  ],
                },
              ],
            }),
          },
        };
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(
        values.map((value) => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`).join(''),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  fs.writeFileSync(
    path.join(codexHome, 'config.toml'),
    `model = "mock-model"\nmodel_provider = "hook_test"\napproval_policy = "never"\nsandbox_mode = "read-only"\ncli_auth_credentials_store = "file"\n[analytics]\nenabled = false\n[model_providers.hook_test]\nname = "Local deterministic test"\nbase_url = "${baseUrl}"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\nrequest_max_retries = 0\nstream_max_retries = 0\n[projects.${JSON.stringify(workspace)}]\ntrust_level = "trusted"\n`,
  );
  const binary = path.join(manifest.codexExtension.installedPath, 'bin/macos-aarch64/codex');
  const result = {
    root,
    versions: manifest.installed,
    extension: manifest.codexExtension.version,
    cases: [],
  };
  const profile = path.join(root, 'isolation.sb');
  fs.writeFileSync(
    profile,
    `(version 1)\n(allow default)\n(deny file-write* (subpath ${JSON.stringify(os.homedir())}))\n(allow file-write* (subpath ${JSON.stringify(root)}))\n(deny file-write* (subpath "/Applications"))\n(deny file-read* (subpath ${JSON.stringify(path.join(os.homedir(), '.codex'))}))\n(deny network-outbound)\n(allow network-outbound (remote ip "localhost:*"))\n`,
  );
  console.log('Disposable hook test: ' + root);
  const client = new Client(binary, workspace, env, profile);
  try {
    await client.initialize();
    const listing = await client.request('hooks/list', { cwds: [workspace] });
    result.discovery = listing;
    assert.equal(listing.data[0].hooks.length, events.length);
    assert.ok(listing.data[0].hooks.every((hook) => hook.trustStatus === 'untrusted'));
    // Trust only exact test definitions in this disposable Codex home, using its public RPC.
    await client.request('config/batchWrite', {
      edits: [
        {
          keyPath: 'hooks.state',
          value: Object.fromEntries(
            listing.data[0].hooks.map((hook) => [hook.key, { trusted_hash: hook.currentHash }]),
          ),
          mergeStrategy: 'upsert',
        },
      ],
      filePath: null,
      expectedVersion: null,
      reloadUserConfig: true,
    });
    async function turn(label) {
      const start = Date.now();
      const { thread } = await client.request('thread/start', {
        cwd: workspace,
        model: 'mock-model',
      });
      const { turn } = await client.request('turn/start', {
        threadId: thread.id,
        input: [{ type: 'text', text: label }],
      });
      const completed = await client.wait(
        (message) =>
          message.method === 'turn/completed' &&
          message.params.threadId === thread.id &&
          message.params.turn.id === turn.id,
      );
      assert.equal(completed.params.turn.status, 'completed');
      result.cases.push({ label, completed: true, elapsedMs: Date.now() - start });
      await new Promise((resolve) => setTimeout(resolve, 250));
      return { thread, turn };
    }
    await turn('normal-receiver');
    result.received = fs
      .readdirSync(eventDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(eventDir, name))));
    assert.ok(result.received.some((event) => event.event === 'UserPromptSubmit'));
    assert.ok(result.received.some((event) => event.event === 'Stop'));
    fs.renameSync(eventDir, eventDir + '-disabled');
    await turn('receiver-absent');
    fs.renameSync(eventDir + '-disabled', eventDir);
    fs.renameSync(path.join(hookDir, 'observer.js'), path.join(hookDir, 'observer-disabled.js'));
    await turn('helper-missing');
    fs.renameSync(path.join(hookDir, 'observer-disabled.js'), path.join(hookDir, 'observer.js'));
    const helperSource = fs.readFileSync(path.join(hookDir, 'observer.js'));
    fs.writeFileSync(path.join(hookDir, 'observer.js'), 'setTimeout(() => {}, 10000);\n');
    await turn('helper-hung-async-timeout');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    fs.writeFileSync(path.join(hookDir, 'observer.js'), helperSource);
    await turn('recovery-after-helper-restored');
    responseMode = 'approval';
    const approvalThread = await client.request('thread/start', {
      cwd: workspace,
      model: 'mock-model',
      approvalPolicy: 'on-request',
    });
    await client.request('turn/start', {
      threadId: approvalThread.thread.id,
      input: [{ type: 'text', text: 'approval-test' }],
    });
    const approval = await client.wait(
      (message) => message.method === 'item/commandExecution/requestApproval',
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    result.approvalHook = fs
      .readdirSync(eventDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(eventDir, name))))
      .find(
        (event) =>
          event.sessionId === approvalThread.thread.id && event.event === 'PermissionRequest',
      );
    assert.ok(result.approvalHook, 'Approval-request hook delivered before answering approval');
    // Decline the synthetic command; our observer never decides approvals.
    client.child.stdin.write(
      JSON.stringify({ id: approval.id, result: { decision: 'decline' } }) + '\n',
    );
    await client.wait(
      (message) =>
        message.method === 'turn/completed' && message.params.threadId === approvalThread.thread.id,
    );
    result.cases.push({
      label: 'approval-request-observed-and-declined-by-test-driver',
      completed: true,
    });
    responseMode = 'hold';
    const interrupted = await client.request('thread/start', {
      cwd: workspace,
      model: 'mock-model',
    });
    const interruptedTurn = await client.request('turn/start', {
      threadId: interrupted.thread.id,
      input: [{ type: 'text', text: 'interrupt-test' }],
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await client.request('turn/interrupt', {
      threadId: interrupted.thread.id,
      turnId: interruptedTurn.turn.id,
    });
    const terminal = await client.wait(
      (message) =>
        message.method === 'turn/completed' && message.params.threadId === interrupted.thread.id,
    );
    assert.equal(terminal.params.turn.status, 'interrupted');
    await new Promise((resolve) => setTimeout(resolve, 200));
    result.interruptHook = fs
      .readdirSync(eventDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(eventDir, name))))
      .find((event) => event.sessionId === interrupted.thread.id && event.event === 'Interrupt');
    assert.ok(result.interruptHook);
    result.cases.push({ label: 'interruption-observed', completed: true });
    responseMode = 'question';
    const questionThread = await client.request('thread/start', {
      cwd: workspace,
      model: 'mock-model',
    });
    await client.request('turn/start', {
      threadId: questionThread.thread.id,
      input: [{ type: 'text', text: 'blocking-question-test' }],
      collaborationMode: {
        mode: 'plan',
        settings: { model: 'mock-model', reasoning_effort: 'medium', developer_instructions: null },
      },
    });
    const question = await client.wait(
      (message) => message.method === 'item/tool/requestUserInput',
    );
    assert.equal(question.params.isBlocking, true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    result.questionPreHook = fs
      .readdirSync(eventDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(eventDir, name))))
      .find(
        (event) =>
          event.sessionId === questionThread.thread.id &&
          event.event === 'PreToolUse' &&
          event.toolName === 'request_user_input',
      );
    assert.ok(result.questionPreHook);
    client.child.stdin.write(
      JSON.stringify({ id: question.id, result: { answers: { confirm: { answers: ['Yes'] } } } }) +
        '\n',
    );
    await client.wait(
      (message) =>
        message.method === 'turn/completed' && message.params.threadId === questionThread.thread.id,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    result.questionPostHook = fs
      .readdirSync(eventDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(eventDir, name))))
      .find(
        (event) =>
          event.sessionId === questionThread.thread.id &&
          event.event === 'PostToolUse' &&
          event.toolName === 'request_user_input',
      );
    assert.ok(result.questionPostHook);
    result.cases.push({ label: 'blocking-question-pre-and-post-observed', completed: true });
    responseMode = 'normal';
    // Keep the installed-IDE phase independently identifiable.
    fs.renameSync(eventDir, eventDir + '-appserver');
    fs.mkdirSync(eventDir, { mode: 0o700 });
    result.runtimePassed = true;
  } catch (error) {
    result.error = error.message;
    result.runtimePassed = false;
  } finally {
    result.runtimeHookNotifications = client.messages.filter((message) =>
      /^hook\//.test(message.method ?? ''),
    );
    fs.writeFileSync(path.join(root, 'runtime-stderr.log'), client.errors);
    await client.close();
  }
  try {
    if (!result.runtimePassed) return;
    fs.writeFileSync(
      path.join(root, 'user/User/settings.json'),
      JSON.stringify({
        'telemetry.telemetryLevel': 'off',
        'update.mode': 'none',
        'extensions.autoUpdate': false,
        'extensions.autoCheckUpdates': false,
        'git.enabled': false,
        'workbench.startupEditor': 'none',
      }),
    );
    const log = fs.createWriteStream(path.join(root, 'ide-launch.log'));
    try {
      delete process.env.ELECTRON_RUN_AS_NODE;
      await runTests({
        vscodeExecutablePath: '/usr/bin/sandbox-exec',
        extensionDevelopmentPath: [
          path.join(project, 'research/introspection'),
          manifest.codexExtension.installedPath,
        ],
        extensionTestsPath: path.join(__dirname, 'suite.js'),
        extensionTestsEnv: env,
        stdout: log,
        stderr: log,
        launchArgs: [
          '-f',
          profile,
          '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
          workspace,
          '--user-data-dir=' + path.join(root, 'user'),
          '--extensions-dir=' + path.join(root, 'extensions'),
          '--enable-proposed-api=openai.chatgpt',
          '--disable-extensions',
          '--disable-gpu',
          '--disable-telemetry',
          '--disable-crash-reporter',
        ],
      });
    } finally {
      log.end();
    }
    if (fs.existsSync(path.join(root, 'ide-result.json')))
      result.ide = JSON.parse(fs.readFileSync(path.join(root, 'ide-result.json')));
  } catch (error) {
    result.ideError = error.message;
  } finally {
    result.modelCalls = modelCalls;
    if (!result.runtimePassed || !result.ide?.hookDelivery || !result.ide?.failureIsolation)
      process.exitCode = 1;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
    fs.writeFileSync(
      path.join(project, 'sources/analysis/hook-feasibility-result.json'),
      JSON.stringify(result, null, 2),
    );
    console.log(
      JSON.stringify(
        {
          root,
          runtimePassed: result.runtimePassed,
          error: result.error,
          cases: result.cases,
          ide: result.ide,
          modelCalls,
        },
        null,
        2,
      ),
    );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
