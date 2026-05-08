/** @type {import('next').NextConfig} */
// /api/* 프록시는 ./middleware.ts 에서 런타임에 BACKEND_URL 을 읽어 처리한다.
// next.config 의 rewrites destination 은 빌드 시점에 고정되어 데스크톱 임의 포트에 대응 불가.
const nextConfig = {
  reactStrictMode: true,
  // standalone output keeps the Docker image small — only the runtime files
  // needed by `node server.js` are copied. Activated by ./Dockerfile.
  output: "standalone",
};

export default nextConfig;
