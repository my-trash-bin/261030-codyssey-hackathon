import { chromium } from 'playwright';

// Keep explicit operator selection; otherwise use the browser installed by mise setup-presentation.
export function browserExecutable(environment = process.env, platform = process.platform) {
 return environment.CHROME_PATH || (platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : chromium.executablePath());
}
