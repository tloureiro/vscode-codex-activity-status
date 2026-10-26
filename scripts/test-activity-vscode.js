'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { runTests } = require('@vscode/test-electron');
const { Client } = require('../research/hooks/rpc');
const { ProjectHooks } = require('../src/project-hooks');

async function main() {
  const project = path.resolve(__dirname, '..');
  const references = JSON.parse(fs.readFileSync(path.join(project, 'sources/manifest.json')));
  const root = fs.mkdtempSync('/private/tmp/codex-activity-vscode-');
  const workspace = path.join(root, 'project');
  const home = path.join(root, 'codex-home');
  for (const directory of [
    workspace,
    home,
    path.join(root, 'user/User'),
    path.join(root, 'extensions'),
  ])
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(workspace, 'example.txt'), 'Disposable product test.\n');
  let mode = 'hold';
  let requests = 0;
  let held = [];
  let calledApproval = false;
  function reply(res, payload) {
    requests++;
    const id = 'test-' + requests;
    let item = {
      type: 'message',
      role: 'assistant',
      id: 'message-' + requests,
      content: [{ type: 'output_text', text: 'OK' }],
    };
    if (
      mode === 'approval' &&
      !calledApproval &&
      JSON.stringify(payload.tools || []).includes('exec_command')
    ) {
      calledApproval = true;
      item = {
        type: 'function_call',
        call_id: 'approval-test',
        name: 'exec_command',
        arguments: JSON.stringify({
          cmd: '/bin/echo ACTIVITY_TEST',
          sandbox_permissions: 'require_escalated',
          justification: 'Synthetic activity approval test',
        }),
      };
    }
    if (mode === 'failure') {
      res
        .writeHead(500, { 'content-type': 'application/json' })
        .end(
          JSON.stringify({ error: { message: 'Synthetic model failure', type: 'server_error' } }),
        );
      return;
    }
    const values = [
      { type: 'response.created', response: { id } },
      { type: 'response.output_item.done', item },
      {
        type: 'response.completed',
        response: { id, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } },
      },
    ];
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(
      values.map((value) => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`).join(''),
    );
  }
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/control/')) {
      mode = req.url.slice('/control/'.length);
      if (mode === 'normal') {
        const waiting = held;
        held = [];
        for (const item of waiting) reply(item.res, item.payload);
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      return;
    }
    if (!req.url.endsWith('/responses')) {
      res.writeHead(404).end();
      return;
    }
    let raw = '';
    req.on('data', (data) => {
      raw += data;
    });
    req.on('end', () => {
      const payload = JSON.parse(raw);
      if (mode === 'hold') held.push({ res, payload });
      else reply(res, payload);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const fixtureUrl = 'http://127.0.0.1:' + server.address().port;
  fs.writeFileSync(
    path.join(home, 'config.toml'),
    `model = "mock-model"\nmodel_provider = "fixture"\napproval_policy = "on-request"\nsandbox_mode = "read-only"\ncli_auth_credentials_store = "file"\n[analytics]\nenabled = false\n[features]\nplugins = false\n[model_providers.fixture]\nname = "Local product fixture"\nbase_url = "${fixtureUrl}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\nrequest_max_retries = 0\nstream_max_retries = 0\n[projects.${JSON.stringify(workspace)}]\ntrust_level = "trusted"\n`,
  );
  const installer = new ProjectHooks(workspace, project);
  // Deterministic stand-ins for global sounds: exercise the real Stop and
  // PermissionRequest dispatch without playing audio during automated tests.
  fs.appendFileSync(
    path.join(home, 'config.toml'),
    ['Stop', 'PermissionRequest']
      .map(
        (event) =>
          `\n[[hooks.${event}]]\n[[hooks.${event}.hooks]]\ntype = "command"\ncommand = "/usr/bin/touch ${root}/global-${event}"\ntimeout = 3\n`,
      )
      .join(''),
  );
  const manifest = installer.install(installer.plan(process.execPath));
  const profile = path.join(root, 'isolation.sb');
  fs.writeFileSync(
    profile,
    `(version 1)\n(allow default)\n(deny file-write* (subpath ${JSON.stringify(os.homedir())}))\n(allow file-write* (subpath ${JSON.stringify(root)}))\n(deny file-write* (subpath "/Applications"))\n(deny file-read* (subpath ${JSON.stringify(path.join(os.homedir(), '.codex'))}))\n(deny network-outbound)\n(allow network-outbound (remote ip "localhost:*"))\n`,
  );
  const env = {
    ...process.env,
    CODEX_HOME: home,
    CODEX_ACTIVITY_TEST_ROOT: root,
    CODEX_ACTIVITY_TEST_URL: fixtureUrl,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const key of Object.keys(env))
    if (
      /^(OPENAI|ANTHROPIC|AZURE_OPENAI|CHATGPT)_/.test(key) ||
      (key.startsWith('CODEX_') &&
        !['CODEX_HOME', 'CODEX_ACTIVITY_TEST_ROOT', 'CODEX_ACTIVITY_TEST_URL'].includes(key))
    )
      env[key] = '';
  let client;
  console.log('Disposable product test: ' + root);
  try {
    client = new Client(
      path.join(references.codexExtension.installedPath, 'bin/macos-aarch64/codex'),
      workspace,
      env,
      profile,
    );
    await client.initialize();
    const listing = await client.request('hooks/list', { cwds: [workspace] });
    const configured = JSON.parse(fs.readFileSync(installer.hooksFile));
    const labels = Object.values(configured.hooks).flatMap((groups) =>
      groups.flatMap((group) => group.hooks.map((hook) => hook.statusMessage)),
    );
    assert.equal(listing.data[0].hooks.length, 9);
    assert.deepEqual(
      listing.data[0].hooks
        .filter((hook) => hook.statusMessage?.startsWith('Codex Activity'))
        .map((hook) => hook.statusMessage)
        .sort(),
      labels.sort(),
      'Codex must expose all seven descriptive labels to its hook review UI',
    );
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
    await client.close();
    client = null;
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
    delete process.env.ELECTRON_RUN_AS_NODE;
    const log = fs.createWriteStream(path.join(root, 'launch.log'));
    try {
      await runTests({
        vscodeExecutablePath: '/usr/bin/sandbox-exec',
        extensionDevelopmentPath: [project, references.codexExtension.installedPath],
        extensionTestsPath: path.join(project, 'test/activity-vscode-smoke.js'),
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
    console.log(fs.readFileSync(path.join(root, 'result.json'), 'utf8'));
  } finally {
    await client?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (fs.existsSync(manifest.root))
      fs.cpSync(manifest.root, path.join(root, 'observed-events'), { recursive: true });
    fs.rmSync(manifest.root, { recursive: true, force: true });
    console.log('Artifacts retained: ' + root);
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
