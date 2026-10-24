'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { StatusPresenter } = require('../src/status-presenter');

test('activity beacon uses only its own text and foreground with accessible labels and state-specific actions', () => {
  const item = {};
  Object.defineProperty(item, 'backgroundColor', {
    set() {
      throw new Error('Background must never change');
    },
  });
  const presenter = new StatusPresenter(item);
  const model = {
    enabled: true,
    project: '/project',
    projectName: 'Project',
    health: { code: 'installed' },
    summary: { connected: true, unread: 0, state: 'working' },
  };
  for (const [state, color] of [
    ['working', '#2864e8'],
    ['attention', '#edb537'],
    ['finished', '#8453d6'],
    ['failed', '#a13e4b'],
  ]) {
    model.summary.state = state;
    model.summary.unread = state === 'finished' || state === 'failed' ? 1 : 0;
    presenter.update(model);
    assert.equal(item.text.startsWith('█'.repeat(24) + ' Codex:'), true);
    assert.equal(item.color, color);
    assert.equal(
      item.command,
      model.summary.unread ? 'codexActivity.acknowledge' : 'chatgpt.openSidebar',
    );
    assert.doesNotMatch(item.accessibilityInformation.label, /█/);
    assert.notEqual(item.command, 'codexActivity.show');
  }
  model.enabled = false;
  presenter.update(model);
  assert.equal(item.color, undefined);
  assert.doesNotMatch(item.text, /█/);
  model.enabled = true;
  model.health.code = 'repair';
  presenter.update(model);
  assert.doesNotMatch(item.text, /█/);
  assert.equal(item.command, 'codexActivity.installProjectHooks');
  presenter.dispose();
});

test('beacon width is bounded and idle or stale signals remain compact', () => {
  const item = {};
  const presenter = new StatusPresenter(item);
  const model = {
    enabled: true,
    project: '/project',
    health: { code: 'installed' },
    summary: { connected: true, unread: 0, state: 'working' },
  };
  presenter.update(model, 1000);
  assert.equal(item.text.match(/^█+/)[0].length, 48);
  presenter.update(model, 2);
  assert.equal(item.text.match(/^█+/)[0].length, 8);
  for (const state of ['idle', 'unknown', 'checking', 'interrupted']) {
    model.summary.state = state;
    presenter.update(model);
    assert.doesNotMatch(item.text, /█/);
    assert.equal(item.color, undefined);
  }
});
