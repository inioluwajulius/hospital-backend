const Notification = require('../models/Notification');

/**
 * Get user's notifications
 * @route GET /api/v1/notifications
 */
exports.getNotifications = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit, 10) || 20;
        const page = parseInt(req.query.page, 10) || 1;
        const skip = (page - 1) * limit;

        const notifications = await Notification.find({ recipient: req.user._id })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const unreadCount = await Notification.countDocuments({
            recipient: req.user._id,
            read: false,
        });

        res.json({
            success: true,
            data: notifications,
            meta: {
                unreadCount,
                page,
                limit,
            },
        });
    } catch (error) {
        console.error('getNotifications error:', error);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
};

/**
 * Mark a single notification as read
 * @route PATCH /api/v1/notifications/:id/read
 */
exports.markAsRead = async (req, res) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, recipient: req.user._id },
            { read: true },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        res.json({ success: true, data: notification });
    } catch (error) {
        console.error('markAsRead error:', error);
        res.status(500).json({ error: 'Failed to mark notification as read' });
    }
};

/**
 * Mark all notifications as read
 * @route PATCH /api/v1/notifications/read-all
 */
exports.markAllAsRead = async (req, res) => {
    try {
        await Notification.updateMany(
            { recipient: req.user._id, read: false },
            { read: true }
        );

        res.json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
        console.error('markAllAsRead error:', error);
        res.status(500).json({ error: 'Failed to mark all notifications as read' });
    }
};
