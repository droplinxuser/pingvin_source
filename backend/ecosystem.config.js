module.exports = {
  apps : [{
    name: "pingvin-backend",
    script: "npm",
    args: "run prod",
    env: {
      PORT: 8080,
      DATABASE_URL: "file:/var/www/pingvin_data/pingvin-share.db?connection_limit=1",
      DATA_DIRECTORY: "/var/www/pingvin_data"
    },
    log_file: "/var/www/pingvin_data/p_s_b.log"
  }]
};
