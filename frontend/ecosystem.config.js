module.exports = {
  apps: [{
    name: "pingvin-frontend",
    script: "npm",
    args: "run start",
    env: {
      API_URL: "http://localhost:8080",
      PORT: 3030
    },
    log_file: "/var/www/pingvin_data/p_s_f.log",
    instances: 0,
    exec_mode: "cluster"
  }]
};
