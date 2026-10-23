const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');

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
            if (socket.user.hospitalId) {
                socket.join(`hospital_${socket.user.hospitalId}`);
                socket.join(`hospital_${socket.user.hospitalId}_${socket.user.role}`);
            }

            socket.on('disconnect', () => {
                console.log(`Socket disconnected: ${socket.id}`);
            });
        });

        return io;
    },
    // Returns null when Socket.IO isn't running (e.g. serverless deployments),
    // so callers still save notifications and just skip the real-time push.
    getIO: () => io || null

};
