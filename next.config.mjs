/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true
  },

  // Adăugați această secțiune de mai jos
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.watchOptions = {
        poll: 1000, // Verifică fișierele o dată pe secundă
        aggregateTimeout: 300,
      };
    }
    return config;
  },
};

export default nextConfig;
