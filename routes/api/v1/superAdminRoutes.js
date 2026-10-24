const express = require('express');
const router = express.Router();
const superAdminController = require('../../../controllers/superAdminController');
const { superAdmin: accounts } = require('../../../controllers/accountController');
const authMiddleware = require('../../../middleware/authMiddleware');

/**
 * SuperAdmin Routes
 * All routes require super admin authentication
 */

// Middleware to check super admin status
const requireSuperAdmin = (req, res, next) => {
    if (!req.user || !req.user.isSuperAdmin) {
        return res.status(403).json({ error: 'SuperAdmin access required' });
    }
    next();
};

// Apply authentication to all routes
router.use(authMiddleware);
router.use(requireSuperAdmin);

// Global Platform Stats
router.get('/stats', superAdminController.getPlatformStats);

// Hospital Management
router.get('/hospitals', superAdminController.getAllHospitals);
router.post('/hospitals', superAdminController.createHospital);
router.get('/hospitals/:hospitalId', superAdminController.getHospital);
router.put('/hospitals/:hospitalId', superAdminController.updateHospital);
router.patch('/hospitals/:hospitalId/status', superAdminController.updateHospitalStatus);
router.patch('/hospitals/:hospitalId/features', superAdminController.updateHospitalFeatures);
router.get('/hospitals/:hospitalId/stats', accounts.stats);

// Users of a hospital (accounts only; no passwords are ever returned)
router.get('/hospitals/:hospitalId/users', accounts.list);
router.get('/hospitals/:hospitalId/users/:userId', accounts.get);
router.patch('/hospitals/:hospitalId/users/:userId', accounts.update);
router.post('/hospitals/:hospitalId/users/:userId/reset-password', accounts.resetPassword);
router.post('/hospitals/:hospitalId/users/:userId/resend-verification', accounts.resendVerification);

module.exports = router;
