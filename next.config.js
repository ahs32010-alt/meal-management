/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [],
  },
  webpack: (config, { dev }) => {
    if (dev) {
      // Disable filesystem cache — prevents stale chunk errors after code changes
      config.cache = false;
    }
    return config;
  },
};

module.exports = nextConfig;
