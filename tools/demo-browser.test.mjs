// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { browserExecutable } from '../scripts/demo/browser.mjs';

test('demo browser respects explicit selection and uses installed Chromium outside macOS', () => {
 assert.equal(browserExecutable({ CHROME_PATH: '/custom/chrome' }, 'linux'), '/custom/chrome');
 assert.equal(browserExecutable({}, 'darwin'), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
 assert.equal(browserExecutable({}, 'linux'), chromium.executablePath());
});
