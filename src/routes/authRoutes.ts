import { Router } from 'express';
import {
  register,
  login,
  verifyOtp,
  resendOtp,
  refreshToken,
  getMe,
  updateProfile,
  updatePin
} from '../controllers/authController';
import { authenticate } from '../middlewares/authMiddleware';
import { pinAuthLimiter, otpVerificationLimiter } from '../middlewares/rateLimiter';
import { upload } from '../middlewares/uploadMiddleware';

const router = Router();

// Inscription avec photo de profil obligatoire (RF-01, RF-02)
router.post('/register', upload.single('photo'), register);

// Connexion avec limitation anti-brute-force (RF-02)
router.post('/login', pinAuthLimiter, login);

// Vérification OTP Email (RF-03)
router.post('/verify-otp', otpVerificationLimiter, verifyOtp);

// Renvoi de code OTP Email (RF-03)
router.post('/resend-otp', resendOtp);

// Renouvellement du jeton de session JWT
router.post('/refresh', refreshToken);

// Profil de l'utilisateur connecté (RF-22)
router.get('/me', authenticate, getMe);

// Mise à jour du profil (RF-22, RF-29)
router.put('/profile', authenticate, upload.single('photo'), updateProfile);

// Modification du code PIN (RF-28)
router.put('/change-pin', authenticate, updatePin);

export default router;
