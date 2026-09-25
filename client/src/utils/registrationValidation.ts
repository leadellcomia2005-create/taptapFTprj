type RegistrationField =
  | "name"
  | "email"
  | "password"
  | "confirmPassword"
  | "termsAccepted"
  | "privacyAccepted"
  | "turnstileToken"
  | "form";

export interface CustomerRegistrationInput {
  name?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  termsAccepted?: boolean;
  privacyAccepted?: boolean;
  botField?: string;
  turnstileRequired?: boolean;
  turnstileToken?: string;
}

export interface PasswordChecklistItem {
  id: "length" | "uppercase" | "lowercase" | "number" | "symbol" | "common";
  label: string;
  valid: boolean;
}

export interface NormalizedCustomerRegistrationValues {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  turnstileToken: string;
  termsAccepted: boolean;
  privacyAccepted: boolean;
  botField: string;
}

export interface CustomerRegistrationValidationResult {
  valid: boolean;
  errors: Partial<Record<RegistrationField, string>>;
  values: NormalizedCustomerRegistrationValues;
}

const weakPasswords = new Set<string>([
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

export function normalizeFullName(value = ""): string {
  return String(value).trim().replace(/\s+/g, " ");
}

export function passwordChecklist(password = ""): PasswordChecklistItem[] {
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

export function isRegistrationEmailSyntaxValid(value = ""): boolean {
  const email = String(value).trim().toLowerCase();
  if (email.length < 6 || email.length > 254 || email.includes("..")) return false;
  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@")) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.startsWith(".") || local.endsWith(".") || local.length > 64 || domain.length > 253) return false;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
  const labels = domain.split(".");
  return labels.length >= 2
    && labels.at(-1)!.length >= 2
    && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

export function validateCustomerRegistrationForm(values: CustomerRegistrationInput = {}): CustomerRegistrationValidationResult {
  const errors: Partial<Record<RegistrationField, string>> = {};
  const name = normalizeFullName(values.name);
  const email = String(values.email || "").trim().toLowerCase();
  const password = String(values.password || "");
  const confirmPassword = String(values.confirmPassword || "");
  const turnstileToken = String(values.turnstileToken || "").trim();

  if (name.length < 2 || name.length > 80 || !/^[A-Za-z\u00d1\u00f1 .'-]+$/.test(name)) {
    errors.name = "Use a real full name. Letters, spaces, period, hyphen, apostrophe, and n with tilde are allowed.";
  }
  if (!isRegistrationEmailSyntaxValid(email)) {
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
