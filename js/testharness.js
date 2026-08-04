// Minimal in-browser test harness. No build step, no Node -- open tests.html
// directly (served over http, not file://) to run the whole suite.

const _tests = [];

export function test(name, fn) {
  _tests.push({ name, fn });
}

export async function runAll(reportEl) {
  let pass = 0, fail = 0;
  const lines = [];
  for (const { name, fn } of _tests) {
    try {
      await fn();
      pass++;
      lines.push({ ok: true, name });
    } catch (e) {
      fail++;
      lines.push({ ok: false, name, error: e && e.message ? e.message : String(e) });
    }
  }
  render(reportEl, lines, pass, fail);
  return { pass, fail };
}

function render(reportEl, lines, pass, fail) {
  if (!reportEl) return;
  reportEl.innerHTML = '';
  const summary = document.createElement('div');
  summary.className = 'test-summary ' + (fail === 0 ? 'all-pass' : 'has-fail');
  summary.textContent = `${pass} passed, ${fail} failed (${pass + fail} total)`;
  reportEl.appendChild(summary);
  const ul = document.createElement('ul');
  for (const line of lines) {
    const li = document.createElement('li');
    li.className = line.ok ? 'pass' : 'fail';
    li.textContent = (line.ok ? '✓ ' : '✗ ') + line.name + (line.ok ? '' : ' -- ' + line.error);
    ul.appendChild(li);
  }
  reportEl.appendChild(ul);
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

export function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg ? msg + ': ' : '') + `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertClose(actual, expected, tol, msg) {
  if (Math.abs(actual - expected) > tol) {
    throw new Error((msg ? msg + ': ' : '') + `expected ~${expected} (tol ${tol}), got ${actual}`);
  }
}
