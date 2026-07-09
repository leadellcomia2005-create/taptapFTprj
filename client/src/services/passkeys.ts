import { api } from "./api";

type PublicKeyCredentialDescriptorJson = Omit<PublicKeyCredentialDescriptor, "id"> & {
  id: string;
};

type PublicKeyCredentialCreationOptionsJson = Omit<PublicKeyCredentialCreationOptions, "challenge" | "excludeCredentials" | "user"> & {
  challenge: string;
  user: Omit<PublicKeyCredentialUserEntity, "id"> & { id: string };
  excludeCredentials?: PublicKeyCredentialDescriptorJson[];
};

type PublicKeyCredentialRequestOptionsJson = Omit<PublicKeyCredentialRequestOptions, "allowCredentials" | "challenge"> & {
  challenge: string;
  allowCredentials?: PublicKeyCredentialDescriptorJson[];
};

type PasskeyOptionsResponse<TPublicKey> = {
  publicKey: TPublicKey;
};

type EncodedCredential = {
  id: string;
  rawId: string;
  type: string;
  response: {
    clientDataJSON: string;
    attestationObject?: string;
    authenticatorData?: string;
    signature?: string;
    userHandle?: string;
  };
};

const base64urlToBuffer = (value = ""): ArrayBuffer => {
  const base64 = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
};

const bufferToBase64url = (buffer: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(buffer)))
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/g, "");

export const passkeysSupported = (): boolean => Boolean(
  window.isSecureContext &&
  window.PublicKeyCredential &&
  navigator.credentials
);

const encodeCredential = (credential: PublicKeyCredential): EncodedCredential => {
  const response = credential.response;
  const attestationResponse = response instanceof AuthenticatorAttestationResponse ? response : null;
  const assertionResponse = response instanceof AuthenticatorAssertionResponse ? response : null;
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      attestationObject: attestationResponse ? bufferToBase64url(attestationResponse.attestationObject) : undefined,
      authenticatorData: assertionResponse ? bufferToBase64url(assertionResponse.authenticatorData) : undefined,
      signature: assertionResponse ? bufferToBase64url(assertionResponse.signature) : undefined,
      userHandle: assertionResponse?.userHandle ? bufferToBase64url(assertionResponse.userHandle) : undefined
    }
  };
};

const prepareCreationOptions = (options: PublicKeyCredentialCreationOptionsJson): PublicKeyCredentialCreationOptions => ({
  ...options,
  challenge: base64urlToBuffer(options.challenge),
  user: { ...options.user, id: base64urlToBuffer(options.user.id) },
  excludeCredentials: (options.excludeCredentials || []).map((credential) => ({
    ...credential,
    id: base64urlToBuffer(credential.id)
  }))
});

const prepareRequestOptions = (options: PublicKeyCredentialRequestOptionsJson): PublicKeyCredentialRequestOptions => ({
  ...options,
  challenge: base64urlToBuffer(options.challenge),
  allowCredentials: (options.allowCredentials || []).map((credential) => ({
    ...credential,
    id: base64urlToBuffer(credential.id)
  }))
});

export async function registerCustomerPasskey(): Promise<unknown> {
  if (!passkeysSupported()) throw new Error("Passkeys need HTTPS or localhost and a device with screen lock, fingerprint, or Face ID.");
  const options = await api.beginPasskeyRegistration() as PasskeyOptionsResponse<PublicKeyCredentialCreationOptionsJson>;
  const credential = await navigator.credentials.create({ publicKey: prepareCreationOptions(options.publicKey) });
  if (!credential) throw new Error("Passkey setup was cancelled.");
  return api.verifyPasskeyRegistration(encodeCredential(credential as PublicKeyCredential));
}

export async function authenticateCustomerPasskey(): Promise<unknown> {
  if (!passkeysSupported()) throw new Error("Passkeys need HTTPS or localhost and a device with screen lock, fingerprint, or Face ID.");
  const options = await api.beginPasskeyAuthentication() as PasskeyOptionsResponse<PublicKeyCredentialRequestOptionsJson>;
  const credential = await navigator.credentials.get({ publicKey: prepareRequestOptions(options.publicKey) });
  if (!credential) throw new Error("Passkey sign-in was cancelled.");
  return api.verifyPasskeyAuthentication(encodeCredential(credential as PublicKeyCredential));
}
