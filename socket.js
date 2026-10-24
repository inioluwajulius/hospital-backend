const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const tokenHospitalId = require('./utils/tokenHospital');
const { loadConsultation, consultationRoom } = require('./utils/consultationAccess');

// Signalling messages relayed between the two participants of a call
const SIGNAL_TYPES = ['offer', 'answer', 'candidate', 'hangup', 'decline'];

let io;

module.exports = {
    init: (httpServer) => {
        io = socketIo(httpServer, {
            cors: {
                origin: '*', // We'll restrict this in production
                methods: ['GET', 'POST']
            }
        });

        io.use((socket, next) => {
            // Prefer handshake.auth (not logged in URLs); query kept for older clients
            const token = socket.handshake.auth?.token || socket.handshake.query?.token;
            if (token) {
                jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
                    if (err) return next(new Error('Authentication error'));
                    socket.user = decoded;
                    next();
                });
            } else {
                next(new Error('Authentication error'));
            }
        }).on('connection', (socket) => {
            console.log(`Socket connected: ${socket.id} (User: ${socket.user.userId})`);

            // Join a private room for this specific user (tokens carry userId)
            socket.join(String(socket.user.userId));
            
            // If they belong to a hospital, join a hospital-wide room for role-based broadcasts
            const hospitalId = tokenHospitalId(socket.user);
            if (hospitalId) {
                socket.join(`hospital_${hospitalId}`);
                socket.join(`hospital_${hospitalId}_${socket.user.role}`);
            }

            // --- Telemedicine: join a consultation room after checking the user is a participant
            socket.data.consultations = new Set();
            const consultUser = () => ({ userId: socket.user.userId, role: socket.user.role, hospitalId: tokenHospitalId(socket.user) });

            socket.on('consult:join', async ({ appointmentId } = {}, ack = () => {}) => {
                try {
                    const access = await loadConsultation(consultUser(), appointmentId);
                    if (!access) return ack({ ok: false, message: 'Consultation not found' });
                    const room = consultationRoom(appointmentId);
                    await socket.join(room);
                    socket.data.consultations.add(String(appointmentId));
                    socket.data.participant = access.participant;
                    const peers = (await io.in(room).fetchSockets()).filter((s) => s.id !== socket.id).map((s) => s.data.participant);
                    socket.to(room).emit('consult:peer-joined', { participant: access.participant });
                    ack({ ok: true, participant: access.participant, peers });
                } catch (err) {
                    console.error('consult:join error:', err.message);
                    ack({ ok: false, message: 'Could not join the consultation' });
                }
            });

            socket.on('consult:signal', ({ appointmentId, type, payload } = {}) => {
                // Only relay within rooms this socket was allowed into
                if (!socket.data.consultations.has(String(appointmentId)) || !SIGNAL_TYPES.includes(type)) return;
                socket.to(consultationRoom(appointmentId)).emit('consult:signal', { type, payload, from: socket.data.participant });
            });

            const leave = (appointmentId) => {
                if (!socket.data.consultations.has(String(appointmentId))) return;
                socket.to(consultationRoom(appointmentId)).emit('consult:peer-left', { participant: socket.data.participant });
                socket.leave(consultationRoom(appointmentId));
                socket.data.consultations.delete(String(appointmentId));
            };
            socket.on('consult:leave', ({ appointmentId } = {}) => leave(appointmentId));

            socket.on('disconnect', () => {
                [...socket.data.consultations].forEach(leave);
                console.log(`Socket disconnected: ${socket.id}`);
            });
        });

        return io;
    },
    // Returns null when Socket.IO isn't running (e.g. serverless deployments),
    // so callers still save notifications and just skip the real-time push.
    getIO: () => io || null

};
