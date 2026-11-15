import type { WebAuthnMfaCapability } from '@smart-cloud/aws-amplify-ui';

type Config = { Auth?: { Cognito?: { userPoolId?: unknown; userPoolClientId?: unknown; identityPoolId?: unknown; userPoolEndpoint?: unknown; identityPoolEndpoint?: unknown } } };
type User = { userId: string };
type Token = { payload: Record<string, unknown> };
type Session = { identityId?: string; credentials?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string; expiration?: Date }; tokens?: { accessToken: Token; idToken?: Token } };
type Dependencies = {
  config: () => Config;
  user: () => Promise<User>;
  session: () => Promise<Session>;
  read: (region: string, pool: string, credentials: NonNullable<Session['credentials']>, signal: AbortSignal) => Promise<{ MfaConfiguration?: string; WebAuthnConfiguration?: { FactorConfiguration?: string; UserVerification?: string; RelyingPartyId?: string } }>;
  timeoutMs?: number;
};

type Binding = { pool: string; client: string; identity: string; region: string; identityRegion: string; userEndpoint?: string; identityEndpoint?: string };
function binding(config: Config): Binding | undefined {
  const c = config.Auth?.Cognito;
  if (!c) return;
  const { userPoolId: pool, userPoolClientId: client, identityPoolId: identity, userPoolEndpoint: userEndpoint, identityPoolEndpoint: identityEndpoint } = c;
  if (typeof pool !== 'string' || typeof client !== 'string' || typeof identity !== 'string') return;
  const pm = /^([a-z]{2}(?:-gov)?-[a-z]+-\d)_([A-Za-z0-9]+)$/.exec(pool);
  const im = /^([a-z]{2}(?:-gov)?-[a-z]+-\d):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.exec(identity);
  if (!pm || !im || !/^[A-Za-z0-9]+$/.test(client)) return;
  const validEndpoint = (endpoint: unknown, service: string, region: string) => endpoint === undefined || endpoint === `https://${service}.${region}.${region.startsWith('cn-') ? 'amazonaws.com.cn' : 'amazonaws.com'}`;
  if (!validEndpoint(userEndpoint, 'cognito-idp', pm[1]) || !validEndpoint(identityEndpoint, 'cognito-identity', im[1])) return;
  return { pool, client, identity, region: pm[1], identityRegion: im[1], userEndpoint: userEndpoint as string | undefined, identityEndpoint: identityEndpoint as string | undefined };
}
const same = (a: Binding, b?: Binding) => !!b && (Object.keys(a) as (keyof Binding)[]).every(k => a[k] === b[k]);
function validToken(token: Token | undefined, b: Binding, sub: string, use: 'access' | 'id'): boolean {
  const p = token?.payload;
  return !!p && p.sub === sub && p.iss === `https://cognito-idp.${b.region}.${b.region.startsWith('cn-') ? 'amazonaws.com.cn' : 'amazonaws.com'}/${b.pool}` && p.token_use === use && (use === 'access' ? p.client_id === b.client : p.aud === b.client) && typeof p.exp === 'number' && p.exp * 1000 > Date.now();
}
export function createWebAuthnMfaCapabilityReader(deps: Dependencies) {
  return async (isCurrent: () => boolean = () => true): Promise<WebAuthnMfaCapability> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, deps.timeoutMs ?? 10000); });
    const operation = async (): Promise<WebAuthnMfaCapability> => {
      const b = binding(deps.config());
      if (!b) return 'unknown';
      const current = () => !controller.signal.aborted && isCurrent() && same(b, binding(deps.config()));
      if (!current()) return 'unknown';
      const user = await deps.user();
      if (!user.userId || !current()) return 'unknown';
      const session = await deps.session();
      if (!current()) return 'unknown';
      const creds = session.credentials;
      if (!session.identityId || !session.identityId.startsWith(`${b.identityRegion}:`) || !creds?.accessKeyId || !creds.secretAccessKey || !creds.sessionToken || !(creds.expiration instanceof Date) || !Number.isFinite(creds.expiration.getTime()) || creds.expiration.getTime() <= Date.now() || !validToken(session.tokens?.accessToken, b, user.userId, 'access') || !validToken(session.tokens?.idToken, b, user.userId, 'id')) return 'unknown';
      const before = await deps.user();
      if (!current() || before.userId !== user.userId) return 'unknown';
      const result = await deps.read(b.region, b.pool, creds, controller.signal);
      if (!current()) return 'unknown';
      const after = await deps.user();
      if (!current() || after.userId !== user.userId) return 'unknown';
      const mfa = result.MfaConfiguration;
      const verification = result.WebAuthnConfiguration?.FactorConfiguration;
      if (mfa === 'OFF') return 'unsupported';
      if (mfa !== 'ON' && mfa !== 'OPTIONAL') return 'unknown';
      if (verification === 'MULTI_FACTOR_WITH_USER_VERIFICATION') return 'supported';
      if (verification === 'SINGLE_FACTOR') return 'unsupported';
      return 'unknown';
    };
    try { return await Promise.race([operation(), timeout]); } catch { return 'unknown'; }
    finally { if (timer) clearTimeout(timer); controller.abort(); }
  };
}
