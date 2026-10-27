import { deleteCookie, getCookie } from "cookies-next";
import { jwtDecode } from "jwt-decode";
import { withBuildVersion } from "../utils/version.util";
import api from "./api.service";

const signIn = async (emailOrUsername: string, password: string) => {
  const emailOrUsernameBody = emailOrUsername.includes("@")
    ? { email: emailOrUsername }
    : { username: emailOrUsername };

  const response = await api.post("auth/signIn", {
    ...emailOrUsernameBody,
    password,
  });

  return response;
};

const signInTotp = (totp: string, loginToken: string) => {
  return api.post("auth/signIn/totp", {
    totp,
    loginToken,
  });
};

const signUp = async (
  displayName: string | undefined,
  email: string,
  username: string,
  password: string,
) => {
  const response = await api.post("auth/signUp", {
    displayName,
    email,
    username,
    password,
  });

  return response;
};

const signOut = async () => {
  const response = await api.post("/auth/signOut");

  // URL.canParse is too new for some Safari/older Chromium versions.
  try {
    window.location.href = new URL(response.data.redirectURI).toString();
  } catch {
    window.location.reload();
  }
};

const refreshAccessToken = async () => {
  try {
    const accessToken = getCookie("access_token") as string;

    // If the access token expires in less than 2 minutes refresh it
    if (
      accessToken &&
      (jwtDecode<{ exp?: number }>(accessToken).exp ?? 0) * 1000 <
        Date.now() + 2 * 60 * 1000
    ) {
      await api.post("/auth/token");
    }
  } catch (e) {
    // Stop retrying with a refresh token the server has already rejected,
    // without logging routine network failures to the browser console.
    if ((e as { response?: { status?: number } })?.response?.status === 401)
      deleteCookie("access_token");
  }
};

const requestResetPassword = async (email: string) => {
  await api.post(`/auth/resetPassword/${email}`);
};

const resetPassword = async (token: string, password: string) => {
  await api.post("/auth/resetPassword", { token, password });
};

const verifyAccount = async (token: string) => {
  await api.post(`/auth/verify`, { token });
};

const resendVerification = async (email: string) => {
  await api.post("/auth/verify/resend", { email });
};

const updatePassword = async (oldPassword: string, password: string) => {
  await api.patch("/auth/password", { oldPassword, password });
};

const enableTOTP = async (password: string) => {
  const { data } = await api.post("/auth/totp/enable", { password });

  return {
    totpAuthUrl: data.totpAuthUrl,
    totpSecret: data.totpSecret,
    qrCode: data.qrCode,
  };
};

const verifyTOTP = async (totpCode: string, password: string) => {
  await api.post("/auth/totp/verify", {
    code: totpCode,
    password,
  });
};

const disableTOTP = async (totpCode: string, password: string) => {
  await api.post("/auth/totp/disable", {
    code: totpCode,
    password,
  });
};

const getAvailableOAuth = async () => {
  return api.get(withBuildVersion("/oauth/available"));
};

const getOAuthStatus = () => {
  return api.get("/oauth/status");
};

export default {
  signIn,
  signInTotp,
  signUp,
  signOut,
  refreshAccessToken,
  updatePassword,
  requestResetPassword,
  resetPassword,
  verifyAccount,
  resendVerification,
  enableTOTP,
  verifyTOTP,
  disableTOTP,
  getAvailableOAuth,
  getOAuthStatus,
};
