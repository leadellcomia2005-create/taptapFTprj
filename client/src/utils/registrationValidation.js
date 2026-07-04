const weakPasswords = new Set([
  "password",
  "password123",
  "password123!",
  "admin123",
  "admin123!",
  "qwerty123",
  "qwerty123!",
  "customer123",
  "customer123!",
  "taptap123",
  "taptap123!"
]);

export function normalizeFullName(value = "") {
  return String(value).trim().replace(/\s+/g, " ");
}

export function passwordChecklist(password = "") {
  const value = String(password);
  return [
    { id: "length", label: "At least 12 characters", valid: value.length >= 12 },
    { id: "uppercase", label: "Uppercase letter", valid: /[A-Z]/.test(value) },
    { id: "lowercase", label: "Lowercase letter", valid: /[a-z]/.test(value) },
    { id: "number", label: "Number", valid: /\d/.test(value) },
    { id: "symbol", label: "Symbol", valid: /[^A-Za-z0-9]/.test(value) },
    { id: "common", label: "Not a common password", valid: !weakPasswords.has(value.toLowerCase()) }
  ];
}

export function validateCustomerRegistrationForm(values = {}) {
  const errors = {};
  const name = normalizeFullName(values.name);
  const email = String(values.email || "").trim().toLowerCase();
  const password = String(values.password || "");
  const confirmPassword = String(values.confirmPassword || "");
  const turnstileToken = String(values.turnstileToken || "").trim();

  if (name.length < 2 || name.length > 80 || !/^[A-Za-z\u00d1\u00f1 .'-]+$/.test(name)) {
    errors.name = "Use a real full name. Letters, spaces, period, hyphen, apostrophe, and n with tilde are allowed.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Enter a valid email address.";
  }
  if (!passwordChecklist(password).every((item) => item.valid)) {
    errors.password = "Use a stronger password.";
  }
  if (password !== confirmPassword) {
    errors.confirmPassword = "Passwords do not match.";
  }
  if (values.termsAccepted !== true) {
    errors.termsAccepted = "Accept the Terms before creating an account.";
  }
  if (values.privacyAccepted !== true) {
    errors.privacyAccepted = "Accept the Privacy Notice before creating an account.";
  }
  if (String(values.botField || "").trim()) {
    errors.form = "We could not create this account. Please check your details and try again.";
  }
  if (values.turnstileRequired === true && !turnstileToken) {
    errors.turnstileToken = "Complete the security check before creating an account.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    values: {
      name,
      email,
      password,
      confirmPassword,
      turnstileToken,
      termsAccepted: values.termsAccepted === true,
      privacyAccepted: values.privacyAccepted === true,
      botField: String(values.botField || "")
    }
  };
}
