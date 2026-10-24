const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const DirectMessage = require('../models/DirectMessage');
const Appointment = require('../models/Appointment');
const Patient = require('../models/Patient');
const User = require('../models/User');
const Notification = require('../models/Notification');
const socketService = require('../socket');

/**
 * Patient-doctor messaging.
 * A patient may message a doctor they have (or had) an appointment with in their
 * hospital, and that doctor may message them. Every operation re-checks that the
 * caller is a participant; ids in requests are never trusted on their own.
 */

const PAGE_SIZE = 30;
const fail = (res, status, message) => res.status(status).json({ success: false, message });

/** The caller's identity in messaging: role, hospital and (for patients) their Patient record */
const whoAmI = async (req) => {
    const hospitalId = req.user.hospitalId;
    if (!hospitalId) return null;
    if (req.user.role === 'doctor') return { role: 'doctor', userId: req.user.userId, hospitalId };
    if (req.user.role === 'patient') {
        const patient = await Patient.findOne({ userId: req.user.userId, hospitalId }).select('_id');
        return patient ? { role: 'patient', userId: req.user.userId, patientId: patient._id, hospitalId } : null;
    }
    return null;
};

const loadConversation = async (me, conversationId) => {
    if (!me || !mongoose.isValidObjectId(conversationId)) return null;
    const filter = { _id: conversationId, hospitalId: me.hospitalId };
    if (me.role === 'doctor') filter.doctorId = me.userId;
    else filter.patientId = me.patientId;
    return Conversation.findOne(filter);
};

const haveCareRelationship = (hospitalId, patientId, doctorId) =>
    Appointment.exists({ hospitalId, patientId, doctorId });

const patientName = (p) => p?.userId?.name || p?.name || p?.patientCardNumber || 'Patient';

const summarize = (conv, me) => ({
    _id: conv._id,
    lastMessageAt: conv.lastMessageAt,
    lastMessageText: conv.lastMessageText,
    lastSenderRole: conv.lastSenderRole,
    unread: me.role === 'doctor' ? conv.doctorUnread : conv.patientUnread,
    other: me.role === 'doctor'
        ? { id: conv.patientId?._id, name: patientName(conv.patientId), detail: conv.patientId?.patientCardNumber }
        : { id: conv.doctorId?._id, name: conv.doctorId?.name, detail: conv.doctorId?.specialization },
});

const populateConversation = (query) => query
    .populate({ path: 'patientId', select: 'userId name patientCardNumber', populate: { path: 'userId', select: 'name' } })
    .populate('doctorId', 'name specialization');

/** GET /messages/contacts  people the caller may start a conversation with */
exports.getContacts = async (req, res) => {
    try {
        const me = await whoAmI(req);
        if (!me) return fail(res, 403, 'Messaging is available to patients and doctors only');
        if (me.role === 'patient') {
            const doctorIds = await Appointment.distinct('doctorId', { hospitalId: me.hospitalId, patientId: me.patientId });
            const doctors = await User.find({ _id: { $in: doctorIds }, role: 'doctor', hospitalId: me.hospitalId }).select('name specialization');
            return res.json({ success: true, data: doctors.map((d) => ({ id: d._id, name: d.name, detail: d.specialization })) });
        }
        const patientIds = await Appointment.distinct('patientId', { hospitalId: me.hospitalId, doctorId: me.userId });
        const patients = await Patient.find({ _id: { $in: patientIds }, hospitalId: me.hospitalId }).select('userId name patientCardNumber').populate('userId', 'name');
        res.json({ success: true, data: patients.map((p) => ({ id: p._id, name: patientName(p), detail: p.patientCardNumber })) });
    } catch (error) {
        console.error('getContacts error:', error.message);
        fail(res, 500, 'Could not load contacts');
    }
};

/** GET /messages/conversations */
exports.listConversations = async (req, res) => {
    try {
        const me = await whoAmI(req);
        if (!me) return fail(res, 403, 'Messaging is available to patients and doctors only');
        const filter = { hospitalId: me.hospitalId, ...(me.role === 'doctor' ? { doctorId: me.userId } : { patientId: me.patientId }) };
        const conversations = await populateConversation(Conversation.find(filter).sort({ lastMessageAt: -1, updatedAt: -1 }).limit(100));
        res.json({ success: true, data: conversations.map((c) => summarize(c, me)) });
    } catch (error) {
        console.error('listConversations error:', error.message);
        fail(res, 500, 'Could not load conversations');
    }
};

/** POST /messages/conversations  { doctorId } (patient) or { patientId } (doctor): find or create */
exports.openConversation = async (req, res) => {
    try {
        const me = await whoAmI(req);
        if (!me) return fail(res, 403, 'Messaging is available to patients and doctors only');
        const otherId = me.role === 'patient' ? req.body?.doctorId : req.body?.patientId;
        if (!mongoose.isValidObjectId(otherId)) return fail(res, 400, me.role === 'patient' ? 'Choose a doctor' : 'Choose a patient');

        const pair = me.role === 'patient'
            ? { patientId: me.patientId, doctorId: otherId }
            : { patientId: otherId, doctorId: me.userId };
        if (!(await haveCareRelationship(me.hospitalId, pair.patientId, pair.doctorId))) {
            return fail(res, 403, me.role === 'patient'
                ? 'You can message doctors you have an appointment with'
                : 'You can message patients who have an appointment with you');
        }

        let conversation;
        try {
            conversation = await Conversation.findOneAndUpdate(
                { hospitalId: me.hospitalId, ...pair },
                { $setOnInsert: { hospitalId: me.hospitalId, ...pair } },
                { new: true, upsert: true }
            );
        } catch (err) {
            // Two requests created it at the same time: use the one that won
            if (err.code !== 11000) throw err;
            conversation = await Conversation.findOne({ hospitalId: me.hospitalId, ...pair });
        }
        const populated = await populateConversation(Conversation.findById(conversation._id));
        res.json({ success: true, data: summarize(populated, me) });
    } catch (error) {
        console.error('openConversation error:', error.message);
        fail(res, 500, 'Could not open the conversation');
    }
};

/** GET /messages/conversations/:id/messages?before=ISO|after=ISO */
exports.getMessages = async (req, res) => {
    try {
        const me = await whoAmI(req);
        const conversation = await loadConversation(me, req.params.id);
        if (!conversation) return fail(res, 404, 'Conversation not found');

        const query = { conversationId: conversation._id };
        const after = new Date(req.query.after);
        const before = new Date(req.query.before);
        if (typeof req.query.after === 'string' && !Number.isNaN(after.getTime())) {
            query.createdAt = { $gt: after };
            const messages = await DirectMessage.find(query).sort({ createdAt: 1 }).limit(200).lean();
            return res.json({ success: true, data: messages, hasMore: false });
        }
        if (typeof req.query.before === 'string' && !Number.isNaN(before.getTime())) query.createdAt = { $lt: before };

        // Newest page first, returned oldest -> newest
        const page = await DirectMessage.find(query).sort({ createdAt: -1 }).limit(PAGE_SIZE + 1).lean();
        const hasMore = page.length > PAGE_SIZE;
        res.json({ success: true, data: page.slice(0, PAGE_SIZE).reverse(), hasMore });
    } catch (error) {
        console.error('getMessages error:', error.message);
        fail(res, 500, 'Could not load messages');
    }
};

/** POST /messages/conversations/:id/messages  { text, clientId } */
exports.sendMessage = async (req, res) => {
    try {
        const me = await whoAmI(req);
        const conversation = await loadConversation(me, req.params.id);
        if (!conversation) return fail(res, 404, 'Conversation not found');

        const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
        if (!text) return fail(res, 400, 'Message cannot be empty');
        if (text.length > 2000) return fail(res, 400, 'Message is too long (2000 characters max)');
        const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId.slice(0, 64) : undefined;

        let message;
        try {
            message = await DirectMessage.create({
                conversationId: conversation._id,
                hospitalId: conversation.hospitalId,
                senderId: me.userId,
                senderRole: me.role,
                text,
                clientId,
            });
        } catch (err) {
            if (err.code === 11000 && clientId) {
                const existing = await DirectMessage.findOne({ conversationId: conversation._id, clientId }).lean();
                return res.json({ success: true, data: existing });
            }
            throw err;
        }

        const unreadField = me.role === 'patient' ? 'doctorUnread' : 'patientUnread';
        const updated = await Conversation.findByIdAndUpdate(conversation._id, {
            $set: { lastMessageAt: message.createdAt, lastMessageText: text.slice(0, 140), lastSenderRole: me.role },
            $inc: { [unreadField]: 1 },
        }, { new: true });

        // Real-time delivery to both participants' devices
        const recipientUserId = me.role === 'patient'
            ? String(conversation.doctorId)
            : String((await Patient.findById(conversation.patientId).select('userId'))?.userId || '');
        const io = socketService.getIO();
        const event = { conversationId: String(conversation._id), message };
        if (io) {
            io.to(String(me.userId)).emit('message:new', event);
            if (recipientUserId) io.to(recipientUserId).emit('message:new', event);
        }

        // Notify on the first unread message only, so a conversation doesn't flood notifications
        if (recipientUserId && updated[unreadField] === 1) {
            const sender = await User.findById(me.userId).select('name');
            try {
                const notif = await Notification.create({
                    recipient: recipientUserId,
                    hospitalId: conversation.hospitalId,
                    type: 'GENERAL',
                    message: `New message from ${me.role === 'doctor' ? `Dr. ${String(sender?.name || '').replace(/^Dr\.?\s*/i, '')}` : sender?.name || 'your patient'}`,
                    link: '/messages',
                });
                io?.to(recipientUserId).emit('new_notification', notif);
            } catch (err) {
                console.error('Message notification error:', err.message);
            }
        }

        res.status(201).json({ success: true, data: message });
    } catch (error) {
        console.error('sendMessage error:', error.message);
        fail(res, 500, 'Could not send the message');
    }
};

/** POST /messages/conversations/:id/read  mark the other side's messages as read */
exports.markRead = async (req, res) => {
    try {
        const me = await whoAmI(req);
        const conversation = await loadConversation(me, req.params.id);
        if (!conversation) return fail(res, 404, 'Conversation not found');
        const otherRole = me.role === 'patient' ? 'doctor' : 'patient';
        await DirectMessage.updateMany({ conversationId: conversation._id, senderRole: otherRole, readAt: null }, { $set: { readAt: new Date() } });
        await Conversation.updateOne({ _id: conversation._id }, { $set: { [me.role === 'patient' ? 'patientUnread' : 'doctorUnread']: 0 } });
        // Let the sender see read receipts
        const otherUserId = me.role === 'patient' ? String(conversation.doctorId) : String((await Patient.findById(conversation.patientId).select('userId'))?.userId || '');
        if (otherUserId) socketService.getIO()?.to(otherUserId).emit('message:read', { conversationId: String(conversation._id), readerRole: me.role });
        res.json({ success: true });
    } catch (error) {
        console.error('markRead error:', error.message);
        fail(res, 500, 'Could not update read status');
    }
};

/** GET /messages/unread-count */
exports.unreadCount = async (req, res) => {
    try {
        const me = await whoAmI(req);
        if (!me) return res.json({ success: true, data: { unread: 0 } });
        const field = me.role === 'doctor' ? 'doctorUnread' : 'patientUnread';
        const match = { hospitalId: new mongoose.Types.ObjectId(String(me.hospitalId)), ...(me.role === 'doctor' ? { doctorId: new mongoose.Types.ObjectId(String(me.userId)) } : { patientId: me.patientId }) };
        const [row] = await Conversation.aggregate([{ $match: match }, { $group: { _id: null, unread: { $sum: `$${field}` } } }]);
        res.json({ success: true, data: { unread: row?.unread || 0 } });
    } catch (error) {
        console.error('unreadCount error:', error.message);
        fail(res, 500, 'Could not load unread count');
    }
};
