'use strict';
// Test-only inspection of the disposable profile's actual rendered status bar.
// Production monitoring uses no debugger connection or DOM access.
async function connectRenderer(title, port = process.env.ACTIVITY_CDP_PORT) {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = pages.find((page) => page.type === 'page' && page.title.includes(title));
    if (!target) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!target) throw new Error('Disposable renderer not found: ' + title);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data),
      request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Renderer request timed out: ' + method));
      }, 2000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (response.exceptionDetails)
      throw new Error('Renderer inspection failed: ' + JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  return {
    evaluate,
    async statusItem() {
      return evaluate(`(() => {
        const item = [...document.querySelectorAll('.statusbar-item')]
          .find(e => e.getAttribute('aria-label') === 'Codex Window Activity' || e.textContent.trim().startsWith('Codex:'));
        if (!item) return null;
        const label = item.querySelector('a') || item;
        return { background: getComputedStyle(item).backgroundColor, foreground: getComputedStyle(label).color,
          width: item.getBoundingClientRect().width, text: item.textContent.trim(), focused: document.hasFocus() };
      })()`);
    },
    async statusBar() {
      const response = await send('Runtime.evaluate', {
        expression: `(() => {
        const bar = document.querySelector('.monaco-workbench .part.statusbar');
        if (!bar) return null;
        return { background: getComputedStyle(bar).backgroundColor, focused: document.hasFocus() };
      })()`,
        returnByValue: true,
      });
      if (response.exceptionDetails) throw new Error('Could not inspect rendered status bar');
      return response.result.value;
    },
    async appearance() {
      return evaluate(`(() => {
        const status = document.querySelector('.monaco-workbench .part.statusbar');
        const title = document.querySelector('.monaco-workbench .part.titlebar');
        const css = element => element ? getComputedStyle(element).backgroundColor : null;
        return { status: css(status), title: css(title), focused: document.hasFocus() };
      })()`);
    },
    async screenshot() {
      return (await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }))
        .data;
    },
    close() {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('Renderer closed'));
      }
      pending.clear();
      socket.close();
    },
  };
}
module.exports = { connectRenderer };
