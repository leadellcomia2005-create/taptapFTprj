import { useRef, useState } from "react";
import { BrandMark } from "../../components/Branding";
import { demoAccounts } from "../../data/menu";
import { api } from "../../services/api";
import {
  completeTwoFactorSession,
  firebaseEnabled,
  friendlyAuthError,
  login,
  logout,
  refreshEmailVerification,
  registerCustomer,
  resendVerificationEmail,
  resetPassword
} from "../../services/firebase";
import { authenticateCustomerPasskey, passkeysSupported, registerCustomerPasskey } from "../../services/passkeys";

function LoginPanel({ onLoggedIn }) {
  const registrationRequested = new URLSearchParams(window.location.search).get("register") === "true";
  const registrationStepDefaults = [
    { id: "auth", label: "Account sign-in", detail: "Waiting to create your secure login.", status: "pending" },
    { id: "profile", label: "Customer profile", detail: "Waiting to save your profile.", status: "pending" },
    { id: "verification", label: "Verification email", detail: "Waiting to request your verification email.", status: "pending" },
    { id: "session", label: "Final setup", detail: "Waiting to finish your account setup.", status: "pending" }
  ];
  const [role, setRole] = useState("customer");
  const [registering, setRegistering] = useState(registrationRequested);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(registrationRequested ? "" : demoAccounts.customer.email);
  const [password, setPassword] = useState(registrationRequested ? "" : demoAccounts.customer.password);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [registrationSteps, setRegistrationSteps] = useState(registrationStepDefaults);
  const [registrationResult, setRegistrationResult] = useState(null);

  const updateRegistrationStep = (id, status, detail) => {
    setRegistrationSteps((current) => current.map((step) => (
      step.id === id ? { ...step, status, detail } : step
    )));
  };

  const toggleRegistration = () => {
    setRegistering((current) => {
      const next = !current;
      const url = new URL(window.location.href);
      if (next) url.searchParams.set("register", "true");
      else url.searchParams.delete("register");
      window.history.replaceState({}, "", url);
      return next;
    });
    setRole("customer");
    setName("");
    setEmail("");
    setPassword("");
    setError("");
    setRegistrationResult(null);
    setRegistrationSteps(registrationStepDefaults);
  };

  const selectRole = (nextRole) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("register");
    window.history.replaceState({}, "", url);
    setRole(nextRole);
    setEmail(demoAccounts[nextRole].email);
    setPassword(demoAccounts[nextRole].password);
    setRegistering(false);
    setRegistrationResult(null);
    setRegistrationSteps(registrationStepDefaults);
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    if (registering) {
      setRegistrationResult(null);
      setRegistrationSteps(registrationStepDefaults);
    }
    try {
      if (registering) {
        const result = await registerCustomer(name, email, password, updateRegistrationStep);
        setRegistrationResult(result);
        setPassword("");
      } else {
        await login(email, password, role, demoAccounts);
        onLoggedIn?.();
      }
    } catch (authError) {
      setError(friendlyAuthError(authError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-visual">
        <div className="login-restaurant-top">
          <div className="brand-lockup"><BrandMark /><div><strong>Taptap</strong><small>FOODTRIP</small></div></div>
          <span>Open daily</span>
        </div>
        <div className="login-restaurant-copy">
          <p className="eyebrow">Pinoy tapsilog house</p>
          <h1>Traditional taste.<br />Fast <em>foodtrip.</em></h1>
          <p>We sell traditional Pinoy Style Tapsilog at the lowest price with quality taste and service.</p>
          <div className="login-special-card" aria-label="TapTap favorite plate">
            <span>Best value</span>
            <strong>Tapsilog meals from PHP 99</strong>
            <small>Egg, soup, rice, and fresh kitchen service.</small>
          </div>
        </div>
      </div>
      <div className="login-form-wrap">
        <form className="login-card" onSubmit={submit}>
          <p className="eyebrow text-danger">TapTap account</p>
          <h2>{registering ? "Create customer account" : "Welcome back"}</h2>
          <p className="text-secondary small">{firebaseEnabled ? "Sign in to continue your foodtrip." : "Preview sign-in is available."}</p>
          {!registering && (
            <div className="role-tabs">
              {["customer", "owner", "staff", "rider"].map((item) => (
                <button type="button" key={item} className={role === item ? "active" : ""} onClick={() => selectRole(item)}>
                  {item}
                </button>
              ))}
            </div>
          )}
          {registering && (
            <label className="form-label">Full name
              <input className="form-control" required value={name} onChange={(event) => setName(event.target.value)} />
            </label>
          )}
          <label className="form-label">Email
            <input className="form-control" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="form-label">Password
            <input className="form-control" type="password" minLength="8" required value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {registering && (
            <div className="firebase-registration-flow" aria-live="polite">
              <div className="registration-flow-heading">
                <div><strong>Creating your account</strong><small>Setting up your secure customer profile.</small></div>
                <span>{registrationResult ? "Complete" : busy ? "Working" : "Ready"}</span>
              </div>
              {registrationSteps.map((step) => (
                <div className={`registration-step registration-${step.status}`} key={step.id}>
                  <span className="registration-step-icon" aria-hidden="true" />
                  <div><strong>{step.label}</strong><small>{step.detail}</small></div>
                </div>
              ))}
              {registrationResult && (
                <div className="registration-result">
                  <strong>Customer account created</strong>
                  <span>Your account is ready. Please check your email to verify it.</span>
                  <span>{registrationResult.verificationSent ? "Verification email requested." : "Verification email still needs to be resent."}</span>
                </div>
              )}
            </div>
          )}
          {error && <div className="alert alert-danger py-2 small">{error}</div>}
          <button className="btn btn-danger w-100" disabled={busy}>
            {busy ? "Creating your account..." : registering ? "Create account" : `Sign in as ${role}`}
          </button>
          {/* erick: dating plain links, ginawang outline buttons para clickable. */}
          <div className="d-flex justify-content-between gap-2 mt-3">
            <button type="button" className="btn btn-outline-danger btn-sm" onClick={toggleRegistration}>
              {registering ? "Back to sign in" : "Customer registration"}
            </button>
            {!registering && <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => resetPassword(email).catch((resetError) => setError(resetError.message))}>Reset password</button>}
          </div>
        </form>
      </div>
    </div>
  );
}

function OtpInput({ value, onChange, disabled }) {
  const refs = useRef([]);
  const digits = Array.from({ length: 6 }, (_, index) => value[index] || "");
  const update = (index, nextValue) => {
    const digit = nextValue.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    onChange(next.join(""));
    if (digit && index < 5) refs.current[index + 1]?.focus();
  };
  const paste = (event) => {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted.length) return;
    event.preventDefault();
    onChange(pasted);
    refs.current[Math.min(pasted.length, 6) - 1]?.focus();
  };
  return (
    <div className="otp-inputs" onPaste={paste}>
      {digits.map((digit, index) => (
        <input
          aria-label={`Digit ${index + 1}`}
          autoComplete="one-time-code"
          disabled={disabled}
          inputMode="numeric"
          key={index}
          maxLength="1"
          onChange={(event) => update(index, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !digits[index] && index > 0) refs.current[index - 1]?.focus();
          }}
          ref={(element) => { refs.current[index] = element; }}
          value={digit}
        />
      ))}
    </div>
  );
}

function EmailVerificationPanel({ user, onVerified }) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const resend = async () => {
    setBusy("resend");
    setMessage("");
    setError("");
    try {
      const result = await resendVerificationEmail();
      setMessage(result.alreadyVerified
        ? "Your email is verified. You can continue."
        : `A new verification link was sent to ${user.email}. Check Inbox and Spam.`);
    } catch (requestError) {
      setError(friendlyAuthError(requestError));
    } finally {
      setBusy("");
    }
  };

  const check = async () => {
    setBusy("check");
    setMessage("");
    setError("");
    try {
      const result = await refreshEmailVerification();
      if (!result.verified) {
        setError("Your email is not verified yet. Please open the link in your email, then check again.");
        return;
      }
      onVerified(result.status);
    } catch (requestError) {
      setError(friendlyAuthError(requestError));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="security-screen">
      <div className="security-card">
        <p className="eyebrow text-danger">First login verification</p>
        <h2>Verify your email</h2>
        <p>Before setting up account security, open the verification link sent to <strong>{user.email}</strong>.</p>
        <div className="email-verification-actions">
          <a className="btn btn-outline-danger w-100" href="https://mail.google.com/" target="_blank" rel="noreferrer">Open Gmail</a>
          <button className="btn btn-outline-secondary w-100" disabled={Boolean(busy)} onClick={resend}>
            {busy === "resend" ? "Sending..." : "Resend verification email"}
          </button>
          <button className="btn btn-danger w-100" disabled={Boolean(busy)} onClick={check}>
            {busy === "check" ? "Checking your email..." : "I verified my email, check again"}
          </button>
        </div>
        {message && <div className="alert alert-success py-2 small mt-3">{message}</div>}
        {error && <div className="alert alert-danger py-2 small mt-3">{error}</div>}
        <button type="button" className="btn btn-link text-secondary w-100" onClick={logout}>Cancel and sign out</button>
      </div>
    </div>
  );
}

function TwoFactorPanel({ user, onComplete }) {
  const status = user.twoFactor || {};
  const setup = !status.enabled;
  const customerAccount = status.role === "customer";
  const browserPasskeysReady = passkeysSupported();
  const [method, setMethod] = useState(status.method || (customerAccount && status.passkeyAvailable ? "passkey" : customerAccount && status.emailOtpAvailable ? "email" : "totp"));
  const [setupData, setSetupData] = useState(null);
  const [code, setCode] = useState("");
  const [backupMode, setBackupMode] = useState(false);
  const [backupCode, setBackupCode] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deliveryMessage, setDeliveryMessage] = useState("");

  const beginTotp = async () => {
    setBusy(true);
    setError("");
    setDeliveryMessage("");
    try {
      setSetupData(await api.beginTotpSetup());
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const sendSms = async () => {
    setBusy(true);
    setError("");
    setDeliveryMessage("");
    try {
      const response = await api.sendTwoFactorSms(setup ? "setup" : "challenge");
      setDeliveryMessage(`A six-digit code was sent to ${response.phoneMasked}.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const sendEmail = async () => {
    setBusy(true);
    setError("");
    setDeliveryMessage("");
    try {
      const response = await api.sendTwoFactorEmail(setup ? "setup" : "challenge");
      setDeliveryMessage(`A six-digit code was sent to ${response.emailMasked}. Check Inbox and Spam.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const setupPasskey = async () => {
    setBusy(true);
    setError("");
    setDeliveryMessage("");
    try {
      const response = await registerCustomerPasskey();
      if (response.backupCodes) setResult(response);
      else onComplete(await completeTwoFactorSession(response.customToken));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const verifyPasskey = async () => {
    setBusy(true);
    setError("");
    setDeliveryMessage("");
    try {
      const response = await authenticateCustomerPasskey();
      onComplete(await completeTwoFactorSession(response.customToken));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setDeliveryMessage("");
    try {
      const response = setup
        ? await api.finishTwoFactorSetup(method, code)
        : await api.verifyTwoFactor(backupMode ? { backupCode } : { code });
      if (response.backupCodes) setResult(response);
      else onComplete(await completeTwoFactorSession(response.customToken));
    } catch (requestError) {
      setCode("");
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const continueWithBackupCodes = async () => {
    setBusy(true);
    setError("");
    try {
      onComplete(await completeTwoFactorSession(result.customToken));
    } catch (requestError) {
      setError(friendlyAuthError(requestError));
    } finally {
      setBusy(false);
    }
  };

  if (status.locked) {
    return (
      <div className="security-screen"><div className="security-card">
        <p className="eyebrow text-danger">Account locked</p>
        <h2>Account security is locked</h2>
        <p>Three consecutive verification attempts failed. An owner must unlock this account from Users & Roles.</p>
        <button className="btn btn-outline-danger" onClick={() => resetPassword(user.email).then(() => window.alert("Password reset email sent. After changing the password, sign in again to unlock security.")).catch((requestError) => window.alert(requestError.message))}>Reset password to unlock</button>
        <button className="btn btn-link text-danger" onClick={logout}>Return to sign in</button>
      </div></div>
    );
  }

  if (result?.backupCodes) {
    return (
      <div className="security-screen"><div className="security-card">
        <p className="eyebrow text-danger">Recovery codes</p>
        <h2>Save these backup codes</h2>
        <p>Each code works once. They cannot be displayed again after you continue.</p>
        <div className="backup-code-grid">{result.backupCodes.map((item) => <code key={item}>{item}</code>)}</div>
        {error && <div className="alert alert-danger py-2 small">{error}</div>}
        <button className="btn btn-danger w-100" disabled={busy} onClick={continueWithBackupCodes}>
          {busy ? "Opening your dashboard..." : "I saved my codes, continue"}
        </button>
      </div></div>
    );
  }

  return (
    <div className="security-screen">
      <form className="security-card" onSubmit={verify}>
        <p className="eyebrow text-danger">{setup ? "Required security setup" : "Second verification step"}</p>
        <h2>{setup ? "Set up account security" : "Verify your sign-in"}</h2>
        <p>{setup
          ? customerAccount
            ? "Choose passkey, email, a security app, or SMS. Passkey is the fastest option on phones with fingerprint, Face ID, or screen lock."
            : "Owner, staff, and rider accounts must use a security app before opening POS tools."
          : status.method === "passkey"
            ? "Confirm with your phone fingerprint, Face ID, or screen lock to finish signing in."
            : `Enter the code from your ${status.method === "sms" ? "phone" : status.method === "email" ? "verified email" : "security app"}.`}</p>
        {setup && (
          <div className="security-methods">
            {customerAccount && (
              <>
                <button type="button" disabled={!status.passkeyAvailable || !browserPasskeysReady} className={method === "passkey" ? "active" : ""} onClick={() => { setMethod("passkey"); setSetupData(null); setCode(""); setDeliveryMessage(""); }}>
                  <strong>Passkey</strong><small>{browserPasskeysReady ? "Fingerprint, Face ID, or screen lock" : "Needs HTTPS or localhost"}</small>
                </button>
                <button type="button" disabled={!status.emailOtpAvailable} className={method === "email" ? "active" : ""} onClick={() => { setMethod("email"); setSetupData(null); setCode(""); setDeliveryMessage(""); }}>
                  <strong>Email code</strong><small>{status.emailOtpAvailable ? `Send to ${status.emailMasked}` : "Email sending is not ready"}</small>
                </button>
                <button type="button" disabled={!status.smsAvailable} className={method === "sms" ? "active" : ""} onClick={() => { setMethod("sms"); setSetupData(null); setCode(""); setDeliveryMessage(""); }}>
                  <strong>SMS code</strong><small>{status.smsAvailable ? `Send to ${status.phoneMasked}` : "Phone number required"}</small>
                </button>
              </>
            )}
            <button type="button" className={method === "totp" ? "active" : ""} onClick={() => { setMethod("totp"); setSetupData(null); setCode(""); setDeliveryMessage(""); }}>
              <strong>Security app</strong><small>Free, offline 30-second codes</small>
            </button>
          </div>
        )}
        {method === "passkey" && !backupMode && (
          <div className="passkey-panel">
            <strong>{setup ? "Create customer passkey" : "Use customer passkey"}</strong>
            <span>{browserPasskeysReady ? "Your phone will ask for fingerprint, Face ID, PIN, or screen lock." : "Passkeys need HTTPS or localhost. Use this after deployment, or test on localhost."}</span>
            <button type="button" className="btn btn-danger w-100" disabled={busy || !browserPasskeysReady} onClick={setup ? setupPasskey : verifyPasskey}>
              {busy ? "Waiting for passkey..." : setup ? "Create passkey" : "Continue with passkey"}
            </button>
          </div>
        )}
        {setup && method === "totp" && !setupData && <button type="button" className="btn btn-outline-danger w-100" disabled={busy || !status.totpAvailable} onClick={beginTotp}>Show security app setup code</button>}
        {setupData && method === "totp" && <div className="totp-setup"><img src={setupData.qrDataUrl} alt="Security app setup code" /><p>Setup key: <code>{setupData.manualKey}</code></p></div>}
        {method === "sms" && !backupMode && <button type="button" className="btn btn-outline-danger w-100 mb-3" disabled={busy || !status.smsAvailable} onClick={sendSms}>Send 6-digit SMS code</button>}
        {method === "email" && !backupMode && <button type="button" className="btn btn-outline-danger w-100 mb-3" disabled={busy || !status.emailOtpAvailable} onClick={sendEmail}>Send 6-digit email code</button>}
        {!backupMode && method !== "passkey" ? (
          <>
            <label className="form-label">6-digit verification code</label>
            <OtpInput value={code} onChange={setCode} disabled={busy} />
          </>
        ) : (
          <label className="form-label">Single-use backup code<input className="form-control" autoComplete="one-time-code" value={backupCode} onChange={(event) => setBackupCode(event.target.value.toUpperCase())} /></label>
        )}
        {deliveryMessage && <div className="alert alert-success py-2 small mt-3">{deliveryMessage}</div>}
        {error && <div className="alert alert-danger py-2 small mt-3">{error}</div>}
        {(method !== "passkey" || backupMode) && <button className="btn btn-danger w-100 mt-3" disabled={busy || (!backupMode && code.length !== 6) || (backupMode && backupCode.length < 8)}>
          {busy ? "Verifying..." : setup ? "Save security setup" : "Verify and open POS"}
        </button>}
        {!setup && <button type="button" className="btn btn-link text-danger w-100" onClick={() => setBackupMode((current) => !current)}>{backupMode ? "Use verification code" : "Use backup code"}</button>}
        <button type="button" className="btn btn-link text-secondary w-100" onClick={logout}>Cancel and sign out</button>
      </form>
    </div>
  );
}

export { EmailVerificationPanel, LoginPanel, TwoFactorPanel };
