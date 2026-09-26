module.exports = {
  apps: [{
    name: "kimono-bi-standalone",
    script: "./node_modules/.bin/remix-serve",
    args: "./build/server/index.js",
    cwd: "/root/business-intelligence-kimono-nu-seo",
    instances: 4,
    exec_mode: "cluster",
    node_args: "--max-old-space-size=900",
    env: {
      NODE_ENV: "production",
      PORT: 3100,
      DATABASE_URL: process.env.DATABASE_URL,
    },
    error_file: "/root/logs/kimono-bi-standalone/error.log",
    out_file: "/root/logs/kimono-bi-standalone/out.log",
    max_memory_restart: "1G",
  }],
};
