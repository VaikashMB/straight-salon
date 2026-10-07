import type { Request, RequestHandler } from 'express';
import multer, { MulterError, memoryStorage } from 'multer';
import { InvalidFileError } from '../storage/image.js';

// multipart/form-data with exactly one file field, held in memory (API-027). Multer errors
// become INVALID_FILE problems: 413 when the file is too large, 400 otherwise (04 §4).

export function singleFileUpload(field: string, maxBytes: number): RequestHandler {
  const handler = multer({
    storage: memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 0, parts: 1 },
  }).single(field);

  return (req, res, next) => {
    if (!req.is('multipart/form-data')) {
      next(new InvalidFileError(`Send multipart/form-data with one "${field}" file.`));
      return;
    }
    handler(req, res, (err: unknown) => {
      if (err instanceof MulterError) {
        next(
          err.code === 'LIMIT_FILE_SIZE'
            ? new InvalidFileError(`The file must be ${maxBytes / 1024 / 1024} MB or smaller.`, 413)
            : new InvalidFileError(`Send exactly one "${field}" file and no other fields.`),
        );
        return;
      }
      if (err) {
        next(new InvalidFileError('The upload could not be read.'));
        return;
      }
      next();
    });
  };
}

export function uploadedFile(req: Request, field: string): Express.Multer.File {
  if (!req.file) throw new InvalidFileError(`Send one "${field}" file.`);
  return req.file;
}
