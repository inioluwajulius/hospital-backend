const express = require('express');
const router = express.Router();
const hospitalAdminController = require('../../../controllers/hospitalAdminController');
const authMiddleware = require('../../../middleware/authMiddleware');
const authorize = require('../../../middleware/roleMiddleware');
const { requireTenant, authorizeTenant } = require('../../../middleware/tenantMiddleware');

/**
 * Hospital Admin Routes
 * Routes for managing hospital-level operations
 */

// Invitation acceptance (public route - the invitee has no account yet, the token is the credential)
router.post('/invitations/:token/accept', hospitalAdminController.acceptInvitation);

// Everything below requires a hospital admin of this hospital
router.use(authMiddleware);
router.use(authorize('hospital_admin'));
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

module.exports = router;
