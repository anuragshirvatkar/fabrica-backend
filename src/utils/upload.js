import multer from 'multer';

const storage = multer.memoryStorage();

export const uploadImages = multer({
  storage,
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 5,
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype?.startsWith('image/')) {
      cb(new Error('Only image files are allowed'));
      return;
    }
    cb(null, true);
  },
});

export const uploadAudio = multer({
  storage,
  limits: {
    fileSize: 6 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const type = file.mimetype || '';
    if (
      type.startsWith('audio/') ||
      type === 'video/webm' ||
      type === 'application/octet-stream'
    ) {
      cb(null, true);
      return;
    }
    cb(new Error('Only audio files are allowed'));
  },
});
