import {
  completeTwoFactorSession,
  friendlyAuthError,
  login,
  logout as firebaseLogout,
  observeAuth,
  refreshEmailVerification,
  registerCustomer,
  resendVerificationEmail,
  resetPassword
} from "../firebase.js";
import { detachCurrentPushTokenForSignOut } from "../pushNotifications";

export {
  completeTwoFactorSession,
  friendlyAuthError,
  login,
  observeAuth,
  refreshEmailVerification,
  registerCustomer,
  resendVerificationEmail,
  resetPassword
};

export async function logout(): Promise<void> {
  await detachCurrentPushTokenForSignOut();
  await firebaseLogout();
}
