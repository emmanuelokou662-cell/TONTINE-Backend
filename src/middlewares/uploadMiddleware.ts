import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Request } from 'express';
import { AppError } from './errorHandler';
import { ERROR_CODES, HTTP_STATUS } from '../constants/httpCodes';
import { env } from '../config/env';

// Création automatique du répertoire d'upload si inexistant
const uploadDirectory = path.resolve(process.cwd(), env.UPLOAD_DIR);
if (!fs.existsSync(uploadDirectory)) {
  fs.mkdirSync(uploadDirectory, { recursive: true });
}

// Configuration du stockage sur disque avec nommage UUID sécurisé
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDirectory);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${crypto.randomUUID()}${ext}`;
    cb(null, uniqueName);
  }
});

// Filtre strict sur les types MIME autorisés (JPG et PNG uniquement)
const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
): void => {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/jpg'];
  const allowedExtensions = ['.jpg', '.jpeg', '.png'];
  const fileExt = path.extname(file.originalname).toLowerCase();

  if (allowedMimeTypes.includes(file.mimetype) && allowedExtensions.includes(fileExt)) {
    cb(null, true);
  } else {
    cb(
      new AppError(
        'Format de fichier invalide. Seuls les formats JPG et PNG sont autorisés.',
        HTTP_STATUS.UNPROCESSABLE_ENTITY,
        ERROR_CODES.INVALID_FILE_TYPE
      )
    );
  }
};

// Instance Multer pour l'upload d'avatars et de reçus (5 Mo max)
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024 // 5 Mo
  }
});
