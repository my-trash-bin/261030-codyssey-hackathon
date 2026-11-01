import assert from 'node:assert/strict';
import test from 'node:test';
import { configureWorkflow } from '../scripts/bootstrap/workflow.mts';

test('workflow links default to loopback with selected ports', () => {
 const env: NodeJS.ProcessEnv = { PORT: '8090', CLIENT_PORT: '5190' };
 configureWorkflow(env, {});
 assert.equal(env.SAFEHANDOFF_WORKFLOW_ENABLED, '1');
 assert.equal(env.SAFEHANDOFF_WORKFLOW_BROWSER_ORIGIN, 'http://127.0.0.1:5190');
 assert.equal(env.SAFEHANDOFF_WORKFLOW_SERVER_ORIGIN, 'http://127.0.0.1:8090');
});

test('wildcard binding chooses a reachable tailnet origin and preserves explicit configuration', () => {
 const env: NodeJS.ProcessEnv = { HOST: '0.0.0.0' };
 configureWorkflow(env, { lan: [{ family: 'IPv4', internal: false, address: '10.0.0.2' }],
  vpn: [{ family: 'IPv4', internal: false, address: '100.66.142.2' }] });
 assert.equal(env.SAFEHANDOFF_WORKFLOW_BROWSER_ORIGIN, 'http://100.66.142.2:5173');
 env.SAFEHANDOFF_WORKFLOW_BROWSER_ORIGIN = 'http://10.0.0.2:5190';
 configureWorkflow(env, {});
 assert.equal(env.SAFEHANDOFF_WORKFLOW_BROWSER_ORIGIN, 'http://10.0.0.2:5190');
 const disabled: NodeJS.ProcessEnv = { SAFEHANDOFF_WORKFLOW_ENABLED: '0' }; configureWorkflow(disabled, {});
 assert.equal(disabled.SAFEHANDOFF_WORKFLOW_BROWSER_ORIGIN, undefined);
});
