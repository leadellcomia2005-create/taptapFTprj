export const operationalTwoFactorRoles = ["owner", "staff", "rider"];

export function allowedTwoFactorMethods(role) {
  return role === "customer" ? ["passkey", "totp", "sms", "email"] : ["totp"];
}
