'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { StatusPresenter } = require('../src/status-presenter');

test('completion presentation uses public foreground and icon properties', () => {
  class ThemeColor {
    constructor(id) {
      this.id = id;
    }
  }
  const item = {};
  const presenter = new StatusPresenter({ ThemeColor }, item);
  presenter.update(true, 'Codex: finished');
  assert.equal(item.text, '$(check) Codex: finished');
  assert.equal(item.color.id, 'codexCompletion.finishedForeground');
  assert.deepEqual(presenter.snapshot(), {
    state: 'finished',
    foreground: 'codexCompletion.finishedForeground',
  });
  presenter.update(false, 'Codex completion: Ready');
  assert.equal(item.text, 'Codex completion: Ready');
  assert.equal(item.color, undefined);
  presenter.dispose();
});
