import { Amplify } from 'aws-amplify';
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { CognitoIdentityProviderClient, GetUserPoolMfaConfigCommand } from '@aws-sdk/client-cognito-identity-provider';
import { createWebAuthnMfaCapabilityReader } from './capability';

export const getWebAuthnMfaCapability = createWebAuthnMfaCapabilityReader({
  config: () => Amplify.getConfig(),
  user: getCurrentUser,
  session: fetchAuthSession,
  read: async (region, pool, credentials, signal) => {
    const client = new CognitoIdentityProviderClient({ region, credentials, maxAttempts: 1 });
    try { return await client.send(new GetUserPoolMfaConfigCommand({ UserPoolId: pool }), { abortSignal: signal }); }
    finally { client.destroy(); }
  },
});
