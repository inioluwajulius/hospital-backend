const User = require('../models/User');

// Get all pending users (doctors waiting for approval)
exports.getPendingUsers = async (req, res) => {
    try {
        const pendingUsers = await User.find({ status: 'pending' })
            .select('-password')
            .sort({ createdAt: -1 });

        res.json(pendingUsers);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Approve user registration (admin only)
exports.approveUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const { notes } = req.body || {};

        const user = await User.findByIdAndUpdate(
            userId,
            { 
                status: 'active',
                approvedAt: new Date(),
                approvalNotes: notes || ''
            },
            { new: true }
        ).select('-password');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({ 
            message: 'User approved successfully', 
            user 
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Reject user registration (admin only)
exports.rejectUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const { reason } = req.body || {};

        if (!reason) {
            return res.status(400).json({ message: 'Rejection reason is required' });
        }

        const user = await User.findByIdAndUpdate(
            userId,
            { 
                status: 'rejected',
                rejectionReason: reason,
                rejectedAt: new Date()
            },
            { new: true }
        ).select('-password');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({ 
            message: 'User registration rejected', 
            user 
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
