export const generateShareId = (length: number = 16) => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const randomArray = new Uint8Array(length >= 3 ? length : 3);
  crypto.getRandomValues(randomArray);
  randomArray.forEach((number) => {
    result += chars[number % chars.length];
  });
  return result;
};

/**
 * The API request referrer is the share page itself, so read the document
 * referrer instead and ignore navigation inside this app.
 */
export const getExternalReferrer = () => {
  if (typeof document === "undefined" || !document.referrer) return undefined;

  try {
    const referrer = new URL(document.referrer);
    const ownHost = window.location.hostname.replace(/^www\./, "");
    const referrerHost = referrer.hostname.replace(/^www\./, "");
    return referrerHost === ownHost ? undefined : referrer.href;
  } catch {
    return undefined;
  }
};
