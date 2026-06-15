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
            if (socket.handshake.query && socket.handshake.query.token) {
                jwt.verify(socket.handshake.query.token, process.env.JWT_SECRET, (err, decoded) => {
                    if (err) return next(new Error('Authentication error'));
                    socket.user = decoded;
                    next();
                });
            } else {
                next(new Error('Authentication error'));
            }
        }).on('connection', (socket) => {
            console.log(`Socket connected: ${socket.id} (User: ${socket.user.id})`);

            // Join a private room for this specific user
            socket.join(socket.user.id);
            
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
    getIO: () => {
        if (!io) {
            throw new Error('Socket.io not initialized!');
        }
        return io;
    }
};
