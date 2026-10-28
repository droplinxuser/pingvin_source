import { SiDiscord, SiGithub, SiGoogle, SiOpenid } from "react-icons/si";
import { FaMicrosoft } from "react-icons/fa";
import React from "react";
import api from "../services/api.service";

const getOAuthUrl = (provider: string) => {
  return `/api/oauth/auth/${provider}`;
};

const getOAuthIcon = (provider: string) => {
  return {
    google: <SiGoogle aria-hidden />,
    microsoft: <FaMicrosoft aria-hidden />,
    github: <SiGithub aria-hidden />,
    discord: <SiDiscord aria-hidden />,
    oidc: <SiOpenid aria-hidden />,
  }[provider];
};

const unlinkOAuth = (provider: string) => {
  return api.post(`/oauth/unlink/${provider}`);
};

export { getOAuthUrl, getOAuthIcon, unlinkOAuth };
