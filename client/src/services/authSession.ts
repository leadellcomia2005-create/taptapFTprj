type AuthTokenProvider = () => string | Promise<string>;

let tokenProvider: AuthTokenProvider = async () => "";

export function configureAuthTokenProvider(provider: AuthTokenProvider): void {
  tokenProvider = provider;
}

export async function getAuthToken(): Promise<string> {
  return tokenProvider();
}
