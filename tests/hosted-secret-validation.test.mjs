import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBoxSecrets, buildBoxSecretsEnv } from '../source/shared/box-secrets.ts';

test('hosted access can be saved and redacted while runtime environment names remain protected', () => {
  const secrets = { SAND_HOSTED_GATEWAY_URL: 'https://gateway.example', SAND_HOSTED_GATEWAY_TOKEN: 'a'.repeat(43) };
  assert.equal(validateBoxSecrets(secrets), null);
  assert.equal(buildBoxSecretsEnv(secrets).CLOUD_AGENT_INJECTED_SECRET_NAMES, 'SAND_HOSTED_GATEWAY_TOKEN,SAND_HOSTED_GATEWAY_URL');
  for (const key of ['SAND_DATA_ROOT', 'SAND_HOSTED_GATEWAY_TOKEN_EXTRA', 'SAND_HOSTED_GATEWAY_URL_EXTRA', 'LD_PRELOAD', 'PATH', '__CURSOR_TEST']) {
    assert.ok(validateBoxSecrets({ ...secrets, [key]: 'override' }), key);
  }
  assert.ok(validateBoxSecrets({ ...secrets, SAND_HOSTED_GATEWAY_TOKEN: 'a'.repeat(32769) }));
});
