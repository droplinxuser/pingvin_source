import { VirusTotalDashboard } from "../types/virustotal.type";
import api from "./api.service";

const getDashboard = async (limit = 100): Promise<VirusTotalDashboard> => {
  return (
    await api.get("admin/virustotal", {
      params: { limit },
    })
  ).data;
};

export default { getDashboard };
