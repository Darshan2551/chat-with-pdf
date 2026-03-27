import "server-only";

import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const resolveStorageRoot = () => path.join(process.cwd(), "storage");

type StorageProvider = "local" | "s3";

let s3Client: S3Client | null = null;

const getStorageProvider = (): StorageProvider =>
  process.env.STORAGE_PROVIDER === "s3" ? "s3" : "local";

const getS3Config = () => {
  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;

  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "S3 storage is enabled, but S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY are not fully configured.",
    );
  }

  return {
    bucket,
    region,
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    accessKeyId,
    secretAccessKey,
  };
};

const getS3Client = () => {
  if (!s3Client) {
    const config = getS3Config();

    s3Client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  return s3Client;
};

export const createStoragePath = (
  userId: string,
  documentId: string,
  fileName: string,
) => `${userId}/${documentId}/${fileName}`;

export const writeDocumentToStorage = async (params: {
  userId: string;
  documentId: string;
  fileName: string;
  buffer: Buffer;
  mimeType?: string;
}) => {
  const storagePath = createStoragePath(
    params.userId,
    params.documentId,
    params.fileName,
  );

  if (getStorageProvider() === "s3") {
    const config = getS3Config();

    await getS3Client().send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: storagePath,
        Body: params.buffer,
        ContentType: params.mimeType || "application/octet-stream",
      }),
    );

    return storagePath;
  }

  const absolutePath = path.join(resolveStorageRoot(), storagePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, params.buffer);

  return storagePath;
};

export const deleteStoredDocument = async (storagePath: string) => {
  if (getStorageProvider() === "s3") {
    const config = getS3Config();

    await getS3Client().send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: storagePath,
      }),
    );

    return;
  }

  const absolutePath = path.join(resolveStorageRoot(), storagePath);
  await rm(absolutePath, { force: true });
};
