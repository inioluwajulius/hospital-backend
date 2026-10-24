const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const authMiddleware = require('../../../middleware/authMiddleware');
const authorize = require('../../../middleware/roleMiddleware');
const {
    getContacts, listConversations, openConversation, getMessages, sendMessage, markRead, unreadCount,
} = require('../../../controllers/messageController');

// Patient-doctor messaging; participation is checked in every handler
router.use(authMiddleware, authorize('patient', 'doctor'));

const sendLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { success: false, message: 'You are sending messages too quickly. Please wait a moment.' },
    standardHeaders: true,
    legacyHeaders: false,
});

router.get('/contacts', getContacts);
router.get('/unread-count', unreadCount);
router.get('/conversations', listConversations);
router.post('/conversations', openConversation);
router.get('/conversations/:id/messages', getMessages);
router.post('/conversations/:id/messages', sendLimiter, sendMessage);
router.post('/conversations/:id/read', markRead);

module.exports = router;
