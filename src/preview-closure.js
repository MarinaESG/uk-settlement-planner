export const normaliseEmail = (email) =>
  typeof email === "string" ? email.trim().toLowerCase() : "";

export function closedPreviewEmails(value = "") {
  if (typeof value !== "string") throw Error("Invalid closed-account list.");
  const emails = new Set(value.split(",").map(normaliseEmail).filter(Boolean));
  if ([...emails].some((email) => email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)))
    throw Error("Invalid closed-account list.");
  return emails;
}

export const closureMessage = "This account is closed to the private preview. Contact support if you need help.";
