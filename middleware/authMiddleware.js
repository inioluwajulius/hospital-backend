const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
	// Validate JWT_SECRET is configured
	if (!process.env.JWT_SECRET) {
		console.error('❌ JWT_SECRET is not configured in environment variables');
		return res.status(500).json({ message: 'Server configuration error: JWT_SECRET missing' });
	}

	const authHeader = req.headers.authorization;

	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return res.status(401).json({ message: 'Not authorized, token missing' });
	}

	const token = authHeader.split(' ')[1];

	try {
		const decoded = jwt.verify(token, process.env.JWT_SECRET);
		req.user = {
			id: decoded.userId,
			_id: decoded.userId, // Alias for compatibility with controllers using _id
			userId: decoded.userId, // Alias for compatibility with controllers using userId
			role: decoded.role,
			isSuperAdmin: decoded.isSuperAdmin,
			hospitalId: decoded.hospitalId
		};
		next();
	} catch (error) {
		if (error.name === 'TokenExpiredError') {
			return res.status(401).json({ message: 'Token expired, please login again' });
		}
		return res.status(401).json({ message: 'Not authorized, token invalid' });
	}
};

module.exports = authMiddleware;
