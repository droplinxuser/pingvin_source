import api from "./api.service";

export type ContactConfig = {
  enabled: boolean;
  siteKey: string;
};

export type ContactMessage = {
  name: string;
  email: string;
  subject: string;
  message: string;
  turnstileToken: string;
};

const getConfig = async (): Promise<ContactConfig> => {
  return (await api.get("contact/config")).data;
};

const send = async (message: ContactMessage): Promise<void> => {
  await api.post("contact", message);
};

export default { getConfig, send };
