import { api } from "./api";

const base64urlToBuffer = (value = "") => {
  const base64 = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
};

const bufferToBase64url = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)))
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/g, "");

export const passkeysSupported = () => Boolean(
  window.isSecureContext &&
  window.PublicKeyCredential &&
  navigator.credentials?.create &&
  navigator.credentials?.get
);

const encodeCredential = (credential) => ({
  id: credential.id,
  rawId: bufferToBase64url(credential.rawId),
  type: credential.type,
  response: {
    clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
    attestationObject: credential.response.attestationObject ? bufferToBase64url(credential.response.attestationObject) : undefined,
    authenticatorData: credential.response.authenticatorData ? bufferToBase64url(credential.response.authenticatorData) : undefined,
    signature: credential.response.signature ? bufferToBase64url(credential.response.signature) : undefined,
    userHandle: credential.response.userHandle ? bufferToBase64url(credential.response.userHandle) : undefined
  }
});

const prepareCreationOptions = (options) => ({
  ...options,
  challenge: base64urlToBuffer(options.challenge),
  user: { ...options.user, id: base64urlToBuffer(options.user.id) },
  excludeCredentials: (options.excludeCredentials || []).map((credential) => ({
    ...credential,
    id: base64urlToBuffer(credential.id)
  }))
});

const prepareRequestOptions = (options) => ({
  ...options,
  challenge: base64urlToBuffer(options.challenge),
  allowCredentials: (options.allowCredentials || []).map((credential) => ({
    ...credential,
    id: base64urlToBuffer(credential.id)
  }))
});

export async function registerCustomerPasskey() {
  if (!passkeysSupported()) throw new Error("Passkeys need HTTPS or localhost and a device with screen lock, fingerprint, or Face ID.");
  const options = await api.beginPasskeyRegistration();
  const credential = await navigator.credentials.create({ publicKey: prepareCreationOptions(options.publicKey) });
  if (!credential) throw new Error("Passkey setup was cancelled.");
  return api.verifyPasskeyRegistration(encodeCredential(credential));
}

export async function authenticateCustomerPasskey() {
  if (!passkeysSupported()) throw new Error("Passkeys need HTTPS or localhost and a device with screen lock, fingerprint, or Face ID.");
  const options = await api.beginPasskeyAuthentication();
  const credential = await navigator.credentials.get({ publicKey: prepareRequestOptions(options.publicKey) });
  if (!credential) throw new Error("Passkey sign-in was cancelled.");
  return api.verifyPasskeyAuthentication(encodeCredential(credential));
}
