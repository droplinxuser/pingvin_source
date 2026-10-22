import { getCookie } from "cookies-next";
import {
  CreateUser,
  CurrentUser,
  UpdateCurrentUser,
  UpdateUser,
} from "../types/user.type";
import api from "./api.service";
import authService from "./auth.service";

const list = async (
  page = 1,
  pageSize = 20,
  sortBy?: string,
  sortDirection?: string,
) => {
  return (
    await api.get("/users", {
      params: { page, pageSize, sortBy, sortDirection },
    })
  ).data;
};

const create = async (user: CreateUser) => {
  return (await api.post("/users", user)).data;
};

const update = async (id: string, user: UpdateUser) => {
  return (await api.patch(`/users/${id}`, user)).data;
};

const remove = async (id: string) => {
  await api.delete(`/users/${id}`);
};

const updateCurrentUser = async (user: UpdateCurrentUser) => {
  return (await api.patch("/users/me", user)).data;
};

const removeCurrentUser = async () => {
  await api.delete("/users/me");
};

const getCurrentUser = async (): Promise<CurrentUser | null> => {
  // Without an access token there is no user to load. This also prevents a
  // cached anonymous page from asking the API for a user on every render.
  if (!getCookie("access_token")) return null;

  try {
    await authService.refreshAccessToken();
    return (await api.get("users/me")).data;
  } catch {
    return null;
  }
};

export default {
  list,
  create,
  update,
  remove,
  getCurrentUser,
  updateCurrentUser,
  removeCurrentUser,
};
