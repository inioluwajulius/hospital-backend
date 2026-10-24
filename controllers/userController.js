const { listApplications, getApplication, decideApplication } = require('../utils/staffApplications');

/**
 * Staff applications (doctors/nurses awaiting approval).
 * Hospital admins are always scoped to the hospital in their signed token. The super
 * admin sees every hospital, or one hospital when it is selected with ?hospitalId.
 */
const hospitalScope = (req) => {
    if (req.user.isSuperAdmin) {
        return req.tenant?.id ? String(req.tenant.id) : null;
    }
    if (!req.user.hospitalId) {
        throw Object.assign(new Error('Your admin account is not linked to a hospital. Ask the platform administrator to assign it.'), { status: 403, code: 'NO_HOSPITAL' });
    }
    return String(req.user.hospitalId);
};

const fail = (res, error, fallback) => {
    if (error.status) {
        return res.status(error.status).json({ message: error.message, ...(error.code ? { code: error.code } : {}), ...(error.currentStatus ? { currentStatus: error.currentStatus } : {}) });
    }
    console.error(fallback, error);
    return res.status(500).json({ message: fallback });
};

// GET /users/registrations/pending?status=pending|rejected&role=doctor|nurse&search=
// Returns a plain array (the shape existing clients expect).
exports.getPendingUsers = async (req, res) => {
    try {
        const applications = await listApplications(hospitalScope(req), req.query);
        res.json(applications);
    } catch (error) {
        fail(res, error, 'Could not load pending registrations');
    }
};

// GET /users/registrations/:userId
exports.getRegistration = async (req, res) => {
    try {
        res.json({ success: true, data: await getApplication(hospitalScope(req), req.params.userId) });
    } catch (error) {
        fail(res, error, 'Could not load the application');
    }
};

// PUT /users/:userId/approve
exports.approveUser = async (req, res) => {
    try {
        const user = await decideApplication(hospitalScope(req), req.params.userId, 'approve', req.user);
        res.json({ success: true, message: `${user.name} has been approved and can now log in.`, user, data: user });
    } catch (error) {
        fail(res, error, 'Could not approve the application');
    }
};

// PUT /users/:userId/reject  { reason? }
exports.rejectUser = async (req, res) => {
    try {
        const user = await decideApplication(hospitalScope(req), req.params.userId, 'reject', req.user, { reason: req.body?.reason });
        res.json({ success: true, message: `${user.name}'s application has been rejected.`, user, data: user });
    } catch (error) {
        fail(res, error, 'Could not reject the application');
    }
};
