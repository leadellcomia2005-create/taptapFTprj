export const operationalTwoFactorRoles = ["owner", "staff", "rider"];

export function allowedTwoFactorMethods(role) {
  if (role === "customer") return ["sms", "email"];
  if (operationalTwoFactorRoles.includes(role)) return ["totp", "email"];
  return ["totp"];
}
