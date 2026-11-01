/** @type {import('next').NextConfig} */
// API_INTERNAL_URL is read at build time (the Docker image bakes in
// http://scraple-api:5677); locally it falls back to the server on :5677.
const apiUrl = process.env.API_INTERNAL_URL || 'http://localhost:5677';

const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
