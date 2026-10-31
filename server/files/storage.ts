import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { ApiError } from '../api/errors.js';

const configuredDir = process.env.FILES_DIR || './data/files';
export const filesDir = resolve(configuredDir);

const configuredMax = Number(process.env.FILES_MAX_BYTES || '');
export const maxFileBytes = Number.isFinite(configuredMax) && configuredMax > 0
  ? configuredMax
  : 25 * 1024 * 1024;

export const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    mkdirSync(filesDir, { recursive: true });
    callback(null, filesDir);
  },
  filename: (_req, _file, callback) => callback(null, randomUUID()),
});

const upload = multer({
  storage,
  limits: { fileSize: maxFileBytes, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (allowedMimeTypes.has(file.mimetype)) callback(null, true);
    else callback(new ApiError(400, 'Only images and PDF files can be uploaded'));
  },
}).single('file');

export function withUploadFile(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    upload(req, res, (error: unknown) => {
      if (!error) return next();
      if (error instanceof ApiError) return next(error);
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          return next(new ApiError(413, `File is too large (max ${Math.round(maxFileBytes / (1024 * 1024))} MB)`));
        }
        if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
          return next(new ApiError(400, 'Only one file can be uploaded at a time'));
        }
        return next(new ApiError(400, error.message));
      }
      return next(error);
    });
  };
}

export function classify(mimeType: string): 'image' | 'pdf' | 'other' {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('image/')) return 'image';
  return 'other';
}

export function storedFilePath(storedName: string): string {
  return join(filesDir, storedName);
}
