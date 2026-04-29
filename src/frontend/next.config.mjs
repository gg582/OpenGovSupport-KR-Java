/** @type {import('next').NextConfig} */
const backend = process.env.BACKEND_URL || "http://localhost:8080";

const nextConfig = {
  reactStrictMode: true,
  // standalone output keeps the Docker image small — only the runtime files
  // needed by `node server.js` are copied. Activated by ./Dockerfile.
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
