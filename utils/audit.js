const AuditLog = require('../models/AuditLog');
const User = require('../models/User');

/**
 * Record an administrative action in the audit log (best effort: a logging
 * failure never blocks the action itself). `hospitalId` scopes the entry so
 * hospital admins only ever see their own hospital's history.
 */
const recordAudit = async ({ actor, hospitalId, action, module = 'Users', details, resourceType, resourceId, severity = 'Info', ipAddress }) => {
    try {
        const actorId = actor?.userId || actor?._id || actor?.id;
        if (!actorId) return;
        const actorUser = await User.findById(actorId).select('name role');
        await AuditLog.create({
            userId: actorId,
            userName: actorUser?.name || 'Administrator',
            userRole: actorUser?.role || actor.role || 'admin',
            hospitalId: hospitalId || undefined,
            action,
            module,
            severity,
            details,
            resourceType,
            resourceId: resourceId ? String(resourceId) : undefined,
            ipAddress,
        });
    } catch (error) {
        console.error('Audit log write failed:', error.message);
    }
};

module.exports = { recordAudit };
