/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // InstaPay screenshots and event images are uploaded through server actions (default limit is 1 MB).
    serverActions: { bodySizeLimit: '50mb' },
  },
};
export default nextConfig;
