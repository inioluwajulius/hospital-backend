const express = require('express');
const router = express.Router();
const hospitalAdminController = require('../../../controllers/hospitalAdminController');
const authMiddleware = require('../../../middleware/authMiddleware');
const { requireTenant, authorizeTenant } = require('../../../middleware/tenantMiddleware');

/**
 * Hospital Admin Routes
 * Routes for managing hospital-level operations
 */

// Apply tenant and auth middleware
router.use(authMiddleware);
router.use(requireTenant);
router.use(authorizeTenant);

// Hospital Profile
router.get('/profile', hospitalAdminController.getHospitalProfile);
router.put('/profile', hospitalAdminController.updateHospitalProfile);

// Staff Management
router.get('/staff', hospitalAdminController.getAllStaff);
router.post('/staff/invite', hospitalAdminController.inviteStaffMember);
router.post('/staff/:userId/resend-invitation', hospitalAdminController.resendInvitation);

// Admin Management
router.get('/admins', hospitalAdminController.getHospitalAdmins);
router.post('/admins/:userId/promote', hospitalAdminController.promoteToAdmin);
router.post('/admins/:userId/revoke', hospitalAdminController.revokeAdminAccess);

// Invitation acceptance (public route - no auth required for token-based invite)
router.post('/invitations/:token/accept', hospitalAdminController.acceptInvitation);

module.exports = router;
