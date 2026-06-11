let tokenProvider = async () => "";

export function configureAuthTokenProvider(provider) {
  tokenProvider = provider;
}

export async function getAuthToken() {
  return tokenProvider();
}
