'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { StatusAppearance } = require('../src/status-appearance');
const manifest = require('../package.json');
function fixture() {
  class ThemeColor {
    constructor(id) {
      this.id = id;
    }
  }
  class Item {
    static ALLOWED_BACKGROUND_COLORS = new Map([
      ['statusBarItem.errorBackground', new ThemeColor('statusBarItem.errorForeground')],
      ['statusBarItem.warningBackground', new ThemeColor('statusBarItem.warningForeground')],
    ]);
    set backgroundColor(value) {
      this.background = value && Item.ALLOWED_BACKGROUND_COLORS?.has(value.id) ? value : undefined;
    }
    get backgroundColor() {
      return this.background;
    }
  }
  const item = new Item();
  return {
    item,
    map: Item.ALLOWED_BACKGROUND_COLORS,
    presenter: new StatusAppearance({ ThemeColor }, item),
  };
}
test('all three fixed palettes exist for every theme and render padded active labels', () => {
  const f = fixture();
  for (const [state, bg, fg] of [
    ['processing', '#245A91', '#FFFFFF'],
    ['approval', '#A66B16', '#000000'],
    ['finished', '#625B78', '#FFFFFF'],
  ]) {
    f.presenter.update(state, 'Codex: ' + state);
    assert.equal(f.item.backgroundColor.id, `codexActivity.${state}Background`);
    assert.equal(f.item.text, 'Codex: ' + state + ' '.repeat(122));
    assert.equal(f.map.get(f.item.backgroundColor.id).id, `codexActivity.${state}Foreground`);
    for (const [part, color] of [
      ['Background', bg],
      ['Foreground', fg],
    ]) {
      const contribution = manifest.contributes.colors.find(
        (c) => c.id === `codexActivity.${state}${part}`,
      );
      assert.deepEqual(Object.values(contribution.defaults), [color, color, color, color]);
    }
  }
  for (const state of ['idle', 'unknown']) {
    f.presenter.update(state, 'Codex: idle');
    assert.equal(f.item.backgroundColor, undefined);
    assert.equal(f.item.text, 'Codex: idle');
  }
  f.presenter.update('processing', 'Codex: Off', false);
  assert.equal(f.item.backgroundColor, undefined);
  f.presenter.dispose();
  assert.equal(f.map.size, 2);
});
test('missing or changed private capability keeps ordinary activity labels', () => {
  for (const alter of [
    (f) => {
      f.item.constructor.ALLOWED_BACKGROUND_COLORS = undefined;
    },
    (f) => f.map.set('statusBarItem.warningBackground', { id: 'different' }),
  ]) {
    const f = fixture();
    f.presenter.update('finished', 'Codex: finished');
    alter(f);
    f.presenter.update('processing', 'Codex: processing');
    assert.equal(f.item.backgroundColor, undefined);
    assert.equal(f.item.text, 'Codex: processing');
    assert.equal(f.presenter.snapshot().supported, false);
    assert.ok(f.presenter.snapshot().limitation);
    f.presenter.dispose();
  }
});
test('foreign entries are never overwritten and cleanup removes only owned values', () => {
  const f = fixture();
  f.presenter.update('approval', 'Codex: Needs input');
  const replacement = { id: 'foreign' };
  f.map.set('codexActivity.approvalBackground', replacement);
  f.presenter.update('finished', 'Codex: finished');
  assert.equal(f.presenter.snapshot().supported, false);
  assert.equal(f.item.backgroundColor, undefined);
  f.presenter.dispose();
  assert.equal(f.map.get('codexActivity.approvalBackground'), replacement);
  assert.equal(f.map.size, 3);
});
test('a replaced capability map can be registered again without leaking old entries', () => {
  const f = fixture();
  f.presenter.update('processing', 'Codex: processing');
  const replacement = new Map([...f.map].filter(([key]) => !key.startsWith('codexActivity.')));
  f.item.constructor.ALLOWED_BACKGROUND_COLORS = replacement;
  f.presenter.update('finished', 'Codex: finished');
  assert.equal(f.map.size, 2);
  assert.equal(f.presenter.snapshot().supported, true);
  f.presenter.dispose();
  assert.equal(replacement.size, 2);
});
