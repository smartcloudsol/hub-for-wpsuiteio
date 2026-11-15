import assert from 'node:assert/strict';
import { build } from 'esbuild';
const output = await build({ entryPoints: ['src/capability.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { createWebAuthnMfaCapabilityReader } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].contents).toString('base64')}`);
const pool = 'eu-central-1_Abc123', client = 'abc123', identity = 'eu-central-1:12345678-1234-1234-1234-123456789abc';
const exp = Math.floor(Date.now() / 1000) + 600;
const claims = { sub: 'user', iss: `https://cognito-idp.eu-central-1.amazonaws.com/${pool}`, exp };
const config = () => ({ Auth: { Cognito: { userPoolId: pool, userPoolClientId: client, identityPoolId: identity } } });
const session = () => ({ identityId: identity, credentials: { accessKeyId: 'key', secretAccessKey: 'secret', sessionToken: 'session', expiration: new Date(Date.now() + 600000) }, tokens: { accessToken: { payload: { ...claims, token_use: 'access', client_id: client } }, idToken: { payload: { ...claims, token_use: 'id', aud: client } } } });
const positive = { MfaConfiguration: 'OPTIONAL', WebAuthnConfiguration: { FactorConfiguration: 'MULTI_FACTOR_WITH_USER_VERIFICATION', UserVerification: 'preferred', RelyingPartyId: 'example.test' } };
function setup() { const state = { config: config(), user: 'user', calls: 0, result: positive, guard: true }; const deps = { config: () => state.config, user: async () => ({ userId: state.user }), session: async () => session(), read: async () => { state.calls++; return state.result; }, timeoutMs: 10 }; return { state, deps, run: () => createWebAuthnMfaCapabilityReader(deps)(() => state.guard) }; }
{
 const t = setup(); assert.equal(await t.run(), 'supported');
 t.state.result = { MfaConfiguration: 'ON', WebAuthnConfiguration: { FactorConfiguration: 'SINGLE_FACTOR', UserVerification: 'preferred' } }; assert.equal(await t.run(), 'unsupported');
 t.state.result = { MfaConfiguration: 'OFF' }; assert.equal(await t.run(), 'unsupported');
 t.state.result = { MfaConfiguration: 'OPTIONAL', WebAuthnConfiguration: { FactorConfiguration: 'FUTURE', UserVerification: 'preferred' } }; assert.equal(await t.run(), 'unknown');
 t.state.result = { MfaConfiguration: 'OPTIONAL', WebAuthnConfiguration: { UserVerification: 'MULTI_FACTOR_WITH_USER_VERIFICATION' } }; assert.equal(await t.run(), 'unknown');
 t.deps.read = async () => { throw Error('denied'); }; assert.equal(await t.run(), 'unknown');
 t.deps.read = async () => new Promise(() => {}); assert.equal(await t.run(), 'unknown');
}
{
 const t = setup(); t.state.config.Auth.Cognito.userPoolEndpoint = 'https://evil.example'; assert.equal(await t.run(), 'unknown'); assert.equal(t.state.calls, 0);
 t.state.config = config(); t.state.config.Auth.Cognito.identityPoolEndpoint = 'https://evil.example'; assert.equal(await t.run(), 'unknown'); assert.equal(t.state.calls, 0);
}
{
 const t = setup(); t.deps.session = async () => { const s = session(); s.credentials.expiration = new Date(0); return s; }; assert.equal(await t.run(), 'unknown');
 t.deps.session = async () => ({ tokens: session().tokens }); assert.equal(await t.run(), 'unknown'); assert.equal(t.state.calls, 0);
}
{
 const t = setup(); t.deps.session = async () => { t.state.guard = false; return session(); }; assert.equal(await t.run(), 'unknown'); assert.equal(t.state.calls, 0);
 t.state.guard = true; t.deps.session = async () => { t.state.user = 'other'; return session(); }; assert.equal(await t.run(), 'unknown'); assert.equal(t.state.calls, 0);
}
{
 const t = setup(); t.deps.read = async () => { t.state.user = 'other'; return positive; }; assert.equal(await t.run(), 'unknown');
 t.state.user = 'user'; t.deps.read = async () => { t.state.config.Auth.Cognito.userPoolClientId = 'changed'; return positive; }; assert.equal(await t.run(), 'unknown');
}
{
 const t = setup(); t.deps.session = async () => { t.state.config = JSON.parse(JSON.stringify({ Auth: { Cognito: { identityPoolId: identity, userPoolClientId: client, userPoolId: pool } } })); return session(); }; assert.equal(await t.run(), 'supported');
}
console.log('Capability tests passed');

{ const t = setup(); t.deps.user = async () => new Promise(() => {}); assert.equal(await t.run(), 'unknown'); assert.equal(t.state.calls, 0); }
{ const t = setup(); t.deps.session = async () => new Promise(() => {}); assert.equal(await t.run(), 'unknown'); assert.equal(t.state.calls, 0); }
{
 const t = setup();
 const cnPool = 'cn-north-1_Abc123', cnIdentity = 'cn-north-1:12345678-1234-1234-1234-123456789abc';
 t.state.config = { Auth: { Cognito: { userPoolId: cnPool, userPoolClientId: client, identityPoolId: cnIdentity, userPoolEndpoint: 'https://cognito-idp.cn-north-1.amazonaws.com.cn', identityPoolEndpoint: 'https://cognito-identity.cn-north-1.amazonaws.com.cn' } } };
 t.deps.session = async () => { const s = session(); s.identityId = cnIdentity; for (const token of Object.values(s.tokens)) token.payload.iss = `https://cognito-idp.cn-north-1.amazonaws.com.cn/${cnPool}`; return s; };
 assert.equal(await t.run(), 'supported');
 t.state.config.Auth.Cognito.identityPoolEndpoint = 'https://cognito-identity.cn-north-1.amazonaws.com'; assert.equal(await t.run(), 'unknown');
}
