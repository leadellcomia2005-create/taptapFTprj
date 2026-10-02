async function postFirebaseAuth(endpoint, webApiKey, payload, fetchImpl) {
  const response = await fetchImpl(
    `https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${encodeURIComponent(webApiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );
  if (!response.ok) {
    const error = new Error("Firebase verification email delivery failed.");
    error.code = "firebase-verification-email-failed";
    throw error;
  }
  return response.json();
}

export async function sendFirebaseVerificationEmail({ auth, uid, webApiKey, continueUrl, fetchImpl = fetch }) {
  if (!auth || !uid || !webApiKey || !continueUrl) {
    const error = new Error("Firebase verification email is not configured.");
    error.code = "firebase-verification-email-unavailable";
    throw error;
  }

  const customToken = await auth.createCustomToken(uid);
  const session = await postFirebaseAuth(
    "accounts:signInWithCustomToken",
    webApiKey,
    { token: customToken, returnSecureToken: true },
    fetchImpl
  );
  if (!session.idToken) {
    const error = new Error("Firebase verification session could not be created.");
    error.code = "firebase-verification-session-failed";
    throw error;
  }

  await postFirebaseAuth(
    "accounts:sendOobCode",
    webApiKey,
    { requestType: "VERIFY_EMAIL", idToken: session.idToken, continueUrl },
    fetchImpl
  );
}
