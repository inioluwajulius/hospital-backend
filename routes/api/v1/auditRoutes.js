const express = require('express');
const AuditLog = require('../../../models/AuditLog');
const authMiddleware = require('../../../middleware/authMiddleware');

const router = express.Router();

const isPlatformAdmin = (req) => req.user.isSuperAdmin === true || req.user.role === 'super_admin';

/**
 * Which audit entries the caller may read: the super admin sees all (optionally one
 * hospital via ?hospitalId), a hospital admin only entries recorded for their own
 * hospital (from the signed token). Everyone else: null (no access).
 */
const auditScope = (req) => {
    if (isPlatformAdmin(req)) return req.tenant?.id ? { hospitalId: req.tenant.id } : {};
    if (req.user.role === 'hospital_admin' && req.user.hospitalId) return { hospitalId: req.user.hospitalId };
    return null;
};

// Get all audit logs (Admin only)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const scope = auditScope(req);
        if (!scope) {
            return res.status(403).json({ message: 'Access denied. Admin only.' });
        }

        const { module, severity, limit = 50, skip = 0 } = req.query;
        let query = { ...scope };

        if (module) query.module = module;
        if (severity) query.severity = severity;

        const logs = await AuditLog.find(query)
            .sort({ timestamp: -1 })
            .limit(parseInt(limit))
            .skip(parseInt(skip));

        const total = await AuditLog.countDocuments(query);

        res.json({
            logs,
            total,
            page: Math.floor(skip / limit) + 1,
            pages: Math.ceil(total / limit),
        });
    } catch (error) {
        res.status(500).json({ message: 'Error retrieving audit logs', error: error.message });
    }
});

// Get audit log by ID
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const scope = auditScope(req);
        if (!scope) {
            return res.status(403).json({ message: 'Access denied. Admin only.' });
        }

        const log = await AuditLog.findOne({ _id: req.params.id, ...scope });
        if (!log) {
            return res.status(404).json({ message: 'Audit log not found' });
        }

        res.json(log);
    } catch (error) {
        res.status(500).json({ message: 'Error retrieving audit log', error: error.message });
    }
});

// Create audit log (typically called internally by other endpoints)
router.post('/', authMiddleware, async (req, res) => {
    try {
        // Identity always comes from the token, never from the body
        const userId = req.user.userId;
        const userRole = req.user.role;
        const {
            userName,
            action,
            module,
            severity = 'Info',
            ipAddress,
            details,
            resourceType,
            resourceId,
            status = 'Success',
        } = req.body;

        const auditLog = new AuditLog({
            userId,
            userName,
            userRole,
            hospitalId: req.user.hospitalId || undefined,
            action,
            module,
            severity,
            ipAddress,
            details,
            resourceType,
            resourceId,
            status,
        });

        await auditLog.save();
        res.status(201).json(auditLog);
    } catch (error) {
        res.status(500).json({ message: 'Error creating audit log', error: error.message });
    }
});

// Get audit logs by user
router.get('/user/:userId', authMiddleware, async (req, res) => {
    try {
        if (!isPlatformAdmin(req) && req.user._id.toString() !== req.params.userId) {
            return res.status(403).json({ message: 'Access denied.' });
        }

        const logs = await AuditLog.find({ userId: req.params.userId })
            .sort({ timestamp: -1 })
            .limit(50);

        res.json(logs);
    } catch (error) {
        res.status(500).json({ message: 'Error retrieving user audit logs', error: error.message });
    }
});

// Get audit logs by module
router.get('/module/:module', authMiddleware, async (req, res) => {
    try {
        if (!isPlatformAdmin(req)) {
            return res.status(403).json({ message: 'Access denied. Admin only.' });
        }

        const logs = await AuditLog.find({ module: req.params.module })
            .sort({ timestamp: -1 })
            .limit(100);

        res.json(logs);
    } catch (error) {
        res.status(500).json({ message: 'Error retrieving module audit logs', error: error.message });
    }
});

// Export audit logs (CSV format)
router.get('/export/csv', authMiddleware, async (req, res) => {
    try {
        const scope = auditScope(req);
        if (!scope) {
            return res.status(403).json({ message: 'Access denied. Admin only.' });
        }

        const logs = await AuditLog.find(scope).sort({ timestamp: -1 }).limit(5000);

        // Convert to CSV
        let csv = 'Timestamp,User,Role,Action,Module,Severity,Status\n';
        logs.forEach(log => {
            csv += `"${log.timestamp}","${log.userName}","${log.userRole}","${log.action}","${log.module}","${log.severity}","${log.status}"\n`;
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
        res.send(csv);
    } catch (error) {
        res.status(500).json({ message: 'Error exporting audit logs', error: error.message });
    }
});

module.exports = router;
