/**
 * The dashboard escapes what it renders, and the status API does not hand out
 * SSH connection parameters.
 *
 * SCOPE: THIS FILE DELIBERATELY DOES NOT TOUCH THE BIND ADDRESS
 * ---------------------------------------------------------------------------
 * Issue #72 names three things that compose: both servers bind 0.0.0.0 while
 * the startup message says `localhost`, the routes are unauthenticated, and the
 * SSH check leaks its connection parameters through the error path. The first
 * is an access-control change that can break a working setup, and #72 records
 * it as needing the maintainer's decision between "loopback only" and
 * "authenticated and reachable". That decision is not made here and no test
 * below asserts anything about it.
 *
 * What IS closed here is the half #72 calls safe either way: stop putting
 * connection parameters into text that is served over HTTP, and escape every
 * value the page interpolates. Those two hold whichever way the bind question
 * is decided, and they shrink what an already-reachable endpoint discloses.
 *
 * WHY THE ESCAPING BUG WAS AN OVERSIGHT AND NOT A DECISION
 * ---------------------------------------------------------------------------
 * In one function, the `detail` cell escaped `<` and the model row ten lines
 * below escaped nothing. `m.id` comes from the configured local LLM endpoint's
 * `/models` response, so it is not this process's own data: that was a stored
 * cross-site scripting path from that endpoint into an unauthenticated page.
 *
 * THE CLASS, WHICH IS THE PART WORTH REMEMBERING
 * ---------------------------------------------------------------------------
 * An error message written for an operator reading a terminal becomes an API
 * response body the moment the same value is surfaced over HTTP. Verbose
 * diagnostics and an open endpoint are each defensible alone. The redaction
 * therefore lives at the boundary where the string crosses, not in ssh.ts,
 * whose messages are good messages for the person they were written for.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { escapeHtml } from '../../src/dashboard.js';
import { redactConnectionParams } from '../../src/tools/system-status.js';
import type { Config } from '../../src/config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const DASHBOARD = join(REPO_ROOT, 'src', 'dashboard.ts');

/** Stand-in configuration. None of these are real values. */
const CFG = {
  sshHost: 'example-host.invalid',
  sshPort: 2222,
  sshUser: 'example-user',
  sshKeyPath: '/home/example-user/.ssh/example_key',
} as unknown as Config;

describe('escapeHtml neutralises markup wherever it is interpolated', () => {
  it('escapes the five characters that matter, including quotes', () => {
    assert.equal(
      escapeHtml(`<script>alert(1)</script>`),
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    assert.equal(escapeHtml(`" onmouseover="x`), '&quot; onmouseover=&quot;x');
    assert.equal(escapeHtml(`it's`), 'it&#39;s');
  });

  it('replaces & first, so entities are not double-escaped into nonsense', () => {
    // If `<` were replaced before `&`, this would come out as `&amp;lt;`.
    assert.equal(escapeHtml('a & b < c'), 'a &amp; b &lt; c');
    assert.equal(escapeHtml('&lt;'), '&amp;lt;');
  });

  it('renders null and undefined as empty, not as the words', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
  });
});

describe('every interpolation in the dashboard goes through the helper', () => {
  const source = readFileSync(DASHBOARD, 'utf8');

  // Guards the scan below: if renderHtml is renamed, an unguarded regex would
  // find nothing and report success.
  it('the scan can actually fire', () => {
    assert.ok(
      /function renderHtml\s*\(/.test(source),
      'renderHtml not found in src/dashboard.ts; the assertions below match on ' +
      'its body and would pass by finding nothing. Update the matcher.',
    );
    assert.ok(source.includes('escapeHtml'), 'escapeHtml helper is missing');
  });

  it('the model row escapes the id, which is the value from outside', () => {
    assert.ok(
      /<td>\$\{escapeHtml\(m\.id\)\}<\/td>/.test(source),
      'src/dashboard.ts must escape m.id. It comes from the configured local ' +
      'LLM endpoint /models response and is rendered on an unauthenticated page.',
    );
    assert.ok(
      !/<td>\$\{m\.id\}<\/td>/.test(source),
      'an unescaped ${m.id} interpolation is back in src/dashboard.ts',
    );
  });

  it('no raw service field is interpolated any more', () => {
    for (const raw of ['${s.service}', '${s.status}', '${m.owned_by', '${s.detail}']) {
      assert.ok(
        !source.includes(raw),
        `src/dashboard.ts interpolates ${raw} without escaping it. Every value ` +
        'in this page must go through escapeHtml, including the ones that ' +
        'look like they can only hold known strings.',
      );
    }
  });

  it('the old single-character escape is gone', () => {
    assert.ok(
      !/\.replace\(\/<\/g, '&lt;'\)\.substring/.test(source),
      "the `.replace(/</g, '&lt;')` shortcut is back; it misses & and quotes",
    );
  });
});

describe('the status API does not disclose SSH connection parameters', () => {
  it('redacts the composite that the exit-255 path emits', () => {
    const msg =
      `SSH failed (exit 255) connecting to ${CFG.sshUser}@${CFG.sshHost}:${CFG.sshPort}: ` +
      `Permission denied | Tip: verify SSH_HOST (${CFG.sshHost}), SSH_USER ` +
      `(${CFG.sshUser}), SSH_KEY_PATH (${CFG.sshKeyPath}) in your .env.`;

    const out = redactConnectionParams(msg, CFG);

    for (const secret of [CFG.sshHost, CFG.sshUser, CFG.sshKeyPath]) {
      assert.ok(
        !out.includes(String(secret)),
        `redacted output still contains a connection parameter. Field: ` +
        `${String(secret).slice(0, 4)}... (value not reproduced here)`,
      );
    }
  });

  it('redacts the timeout path, which names the key path', () => {
    const msg =
      `SSH timed out after 10000ms (host: ${CFG.sshHost}:${CFG.sshPort}, ` +
      `user: ${CFG.sshUser}, key: ${CFG.sshKeyPath})`;

    const out = redactConnectionParams(msg, CFG);

    assert.ok(!out.includes(String(CFG.sshHost)), 'host survived redaction');
    assert.ok(!out.includes(String(CFG.sshUser)), 'user survived redaction');
    assert.ok(!out.includes(String(CFG.sshKeyPath)), 'key path survived redaction');
  });

  it('replaces the longest composite first, so no half-redacted target remains', () => {
    const msg = `connecting to ${CFG.sshUser}@${CFG.sshHost}:${CFG.sshPort}: nope`;
    const out = redactConnectionParams(msg, CFG);
    assert.ok(
      !/@|\[host redacted\]:\d+/.test(out.replace('[ssh target redacted]', '')),
      'a partially redacted user@host:port composite is left in the message: ' + out,
    );
  });

  it('keeps the part of the message that is actually useful', () => {
    const msg = `SSH failed (exit 255) connecting to ${CFG.sshUser}@${CFG.sshHost}:${CFG.sshPort}: Permission denied`;
    const out = redactConnectionParams(msg, CFG);
    assert.ok(out.includes('exit 255'), 'the exit code must survive');
    assert.ok(out.includes('Permission denied'), 'the reason must survive');
  });

  it('leaves a message with nothing sensitive in it untouched', () => {
    const msg = 'HTTP 503';
    assert.equal(redactConnectionParams(msg, CFG), msg);
  });

  it('does not blank the message when config fields are empty', () => {
    // An unconfigured install has empty strings here. A naive replace of '' would
    // splice the token between every character.
    const empty = { sshHost: '', sshPort: undefined, sshUser: '', sshKeyPath: '' } as unknown as Config;
    const msg = 'openclaw CLI not found';
    assert.equal(redactConnectionParams(msg, empty), msg);
  });
});
