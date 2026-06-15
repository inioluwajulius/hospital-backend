const express = require('express');
const router = express.Router();
const notificationController = require('../../../controllers/notificationController');
// Require middleware at runtime to bypass any potential initialization order issues on Render
router.use((req, res, next) => {
    const authMiddleware = require('../../../middleware/authMiddleware');
    if (typeof authMiddleware !== 'function') {
        console.error('authMiddleware is not a function at runtime! Type:', typeof authMiddleware);
        return res.status(500).json({ error: 'Internal server error with auth middleware' });
    }
    return authMiddleware(req, res, next);
});

router.get('/', notificationController.getNotifications);
router.patch('/read-all', notificationController.markAllAsRead);
router.patch('/:id/read', notificationController.markAsRead);

module.exports = router;
