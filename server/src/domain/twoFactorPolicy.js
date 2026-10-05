export const operationalTwoFactorRoles = ["owner", "staff", "rider"];

export function allowedTwoFactorMethods(role) {
  if (role === "customer") return ["passkey", "totp", "sms", "email"];
  if (operationalTwoFactorRoles.includes(role)) return ["totp", "email"];
  return ["totp"];
}
