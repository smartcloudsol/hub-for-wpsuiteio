export { Amplify, type ResourcesConfig } from "aws-amplify";
export { del, get, head, patch, post, put } from "aws-amplify/api";
export { Hub, I18n } from "aws-amplify/utils";
export { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
export {
  confirmSignIn,
  fetchAuthSession,
  fetchUserAttributes,
  fetchMFAPreference,
  getCurrentUser,
  forgetDevice,
  rememberDevice,
  signOut,
  signUp,
  updateMFAPreference,
  type AuthSession,
  type FetchAuthSessionOptions,
  type FetchUserAttributesOutput,
  type FetchMFAPreferenceOutput,
  type SignUpInput,
  type SignUpOutput,
} from "aws-amplify/auth";
