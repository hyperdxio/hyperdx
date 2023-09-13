export const API_SERVER_URL =
  process.env.NEXT_PUBLIC_API_SERVER_URL || 'http://localhost:8000'; // NEXT_PUBLIC_API_SERVER_URL can be empty string

export const HDX_API_KEY = process.env.NEXT_PUBLIC_HDX_API_KEY as string;
export const HDX_SERVICE_NAME =
  process.env.NEXT_PUBLIC_HDX_SERVICE_NAME ?? 'hdx-oss-dev-app';
export const HDX_COLLECTOR_URL = process.env
  .NEXT_PUBLIC_HDX_COLLECTOR_URL as string;

export const IS_OSS = process.env.NEXT_PUBLIC_IS_OSS ?? 'true' === 'true';
