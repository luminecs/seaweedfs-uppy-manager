// src/s3Client.js
import { S3Client } from "@aws-sdk/client-s3";

const s3Config = {
  endpoint: import.meta.env.VITE_S3_ENDPOINT,
  region: import.meta.env.VITE_S3_REGION,
  credentials: {
    accessKeyId: import.meta.env.VITE_S3_ACCESS_KEY_ID,
    secretAccessKey: import.meta.env.VITE_S3_SECRET_ACCESS_KEY,
  },
  // 对于非 AWS S3 的实现（如 MinIO, SeaweedFS），通常需要这个
  forcePathStyle: true,
};

export const s3Client = new S3Client(s3Config);

// 同时导出配置，方便 Uppy 使用
export const s3ConfigForUppy = s3Config;
