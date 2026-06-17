const express = require('express');
const router = express.Router();
const superAdminController = require('../../../controllers/superAdminController');
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
router.get('/hospitals/:hospitalId/stats', superAdminController.getHospitalStats);

module.exports = router;
