# Three fixed status-item backgrounds

Investigated October 19, 2026, on VS Code 1.142.0, local macOS.

The three-color padded status item is the default presenter in version 0.2.0.
Production integration retains the experimental private capability with runtime
checks and plain-label fallback. The original feasibility results below are
historical; current production checks are described in [validation](VALIDATION.md).

## Result

Three genuine padded item backgrounds work without project settings writes,
application patches, or renderer injection. The experiment retained the original
blue `#245A91`, amber `#A66B16`, and purple `#625B78`, with readable fixed text
colors. It used the longer preview's 122 trailing spaces.

The mechanism depends on a private extension-host implementation field. It is
not supported by the public VS Code API and may stop working after an update.

## Mechanism

The public `StatusBarItem.backgroundColor` setter accepts only the warning and
error theme identifiers. The installed extension host implements that check
using `item.constructor.ALLOWED_BACKGROUND_COLORS`, a mutable map from background
identifiers to foreground `ThemeColor` values.

The experiment contributed its own background and foreground color identifiers,
with identical defaults for light, dark, high-contrast dark, and high-contrast
light themes. It then added only those new identifiers to the private map before
assigning the item background through the normal property setter. It preserved
the built-in warning/error entries and removed its own entries on disposal.

Conceptually, after contributing both color identifiers:

```js
const allowed = item.constructor.ALLOWED_BACKGROUND_COLORS;
if (!(allowed instanceof Map)) return false;
allowed.set(
  'codexActivity.processingBackground',
  new vscode.ThemeColor('codexActivity.processingForeground'),
);
item.backgroundColor = new vscode.ThemeColor('codexActivity.processingBackground');
```

The private-map access is the unsupported part. Contributing named colors and
setting status-item properties are public mechanisms. Color defaults do not
change with the theme; explicit user or theme overrides of these particular
identifiers could still override them.

References: [extension-host allowlist and setter](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/common/extHostStatusBar.ts),
[main-thread color forwarding](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/browser/statusBarExtensionPoint.ts),
[renderer color application](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/statusbar/statusbarItem.ts),
and [contributed colors](https://code.visualstudio.com/api/references/contribution-points#contributes.colors).

## Verified behavior

[Sanitized evidence](evidence/status-item-backgrounds.json) records:

- The documented setter rejected the custom identifier before the private map
  was extended.
- All three background and foreground pairs rendered exactly as specified in
  Dark Modern, Light Modern, Default High Contrast, and Default High Contrast
  Light: 12 rendered comparisons.
- Two simultaneous windows on the same synthetic project, using separate
  disposable profiles, retained independent amber and purple backgrounds through
  native focus changes: six additional rendered comparisons.
- Clearing one window's background left the other window unchanged.
- Removing the private entries made the setter reject them again and left a
  normal status item. Re-registering restored the colored presentation.
- The synthetic project never acquired a `.vscode` directory or workspace color
  settings. Theme changes used only the disposable user profiles.

The debugger connection inspected computed styles and captured screenshots; it
did not implement the indicator. The prototype uses no Codex connection, actual
task state, or production acknowledgement handling. Mission Control desktop
capture was unavailable; live windows were left available for visual inspection.

## Production integration

Keep this explicitly experimental. Check the private field and expected built-in
entries before using it; register only extension-owned identifiers and restore
only entries still owned by this extension. If the private capability disappears,
retain the activity label and expose the limitation in diagnostics. Do not fall
back to project settings writes.

Version 0.2.0 routes the existing activity/acknowledgement state into this
presenter, removes the saved-workspace/shared-settings restrictions, and restores
outstanding full-bar journals without applying new settings overlays. Unit and
real-host checks cover the presenter, lifecycle, themes, and independent windows.
