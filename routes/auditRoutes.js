const express = require('express');
const AuditLog = require('../models/AuditLog');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// Get all audit logs (Admin only)
router.get('/', authMiddleware, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied. Admin only.' });
        }

        const { module, severity, limit = 50, skip = 0 } = req.query;
        let query = {};

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
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied. Admin only.' });
        }

        const log = await AuditLog.findById(req.params.id);
        if (!log) {
            return res.status(404).json({ message: 'Audit log not found' });
        }

        res.json(log);
    } catch (error) {
        res.status(500).json({ message: 'Error retrieving audit log', error: error.message });
    }
});

// Create audit log (typically called internally by other endpoints)
router.post('/', async (req, res) => {
    try {
        const {
            userId,
            userName,
            userRole,
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
        if (req.user.role !== 'admin' && req.user._id.toString() !== req.params.userId) {
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
        if (req.user.role !== 'admin') {
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
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied. Admin only.' });
        }

        const logs = await AuditLog.find().sort({ timestamp: -1 });

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
