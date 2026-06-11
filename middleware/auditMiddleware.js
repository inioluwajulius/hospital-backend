const fs = require('fs');
const path = require('path');

// Audit log file location
const AUDIT_LOG_FILE = path.join(__dirname, '../logs/audit.log');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Audit Middleware - Logs all CRUD operations for compliance
 * Records: WHO, WHAT, WHEN, WHERE, WHY
 * HIPAA & GDPR compliant
 */
const auditMiddleware = (req, res, next) => {
  // Capture original send/json functions
  const originalJson = res.json;
  const originalSend = res.send;

  // Store request start time
  req.auditStartTime = Date.now();

  // Intercept res.json to capture response
  res.json = function (data) {
    logAudit(req, res, data);
    return originalJson.call(this, data);
  };

  // Intercept res.send for other responses
  res.send = function (data) {
    if (req.method !== 'GET') {
      logAudit(req, res, data);
    }
    return originalSend.call(this, data);
  };

  next();
};

/**
 * Log audit trail entry
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {*} responseData - Response data
 */
function logAudit(req, res, responseData) {
  // Skip logging for GET requests (read-only, less sensitive)
  // Uncomment to log all requests including GETs
  // if (req.method === 'GET') return;

  const auditEntry = {
    timestamp: new Date().toISOString(),
    requestId: req.id || generateRequestId(),
    
    // WHO
    userId: req.user?.id || 'UNKNOWN',
    userRole: req.user?.role || 'UNKNOWN',
    username: req.user?.username || 'UNKNOWN',
    
    // WHAT
    method: req.method,
    endpoint: req.originalUrl,
    resourceId: req.params.id || 'N/A',
    resourceType: getResourceType(req.originalUrl),
    
    // WHERE
    ipAddress: req.ip || req.connection.remoteAddress,
    userAgent: req.get('user-agent') || 'UNKNOWN',
    
    // WHEN
    duration: `${Date.now() - req.auditStartTime}ms`,
    
    // RESULT
    statusCode: res.statusCode,
    success: res.statusCode >= 200 && res.statusCode < 300,
    
    // REQUEST BODY (sensitive - hash for compliance)
    requestBodyHash: hashData(JSON.stringify(req.body)),
    
    // RESPONSE (partial - exclude sensitive info)
    responseSummary: summarizeResponse(responseData),
    
    // COMPLIANCE
    dataClassification: getDataClassification(req.originalUrl),
    complianceFlag: shouldFlagForCompliance(req, res)
  };

  // Append to audit log
  appendToAuditLog(auditEntry);

  // If sensitive operation failed or unauthorized, also log separately
  if (auditEntry.complianceFlag) {
    logSecurityEvent(auditEntry);
  }
}

/**
 * Append entry to persistent audit log
 */
function appendToAuditLog(entry) {
  try {
    const logLine = JSON.stringify(entry) + '\n';
    fs.appendFileSync(AUDIT_LOG_FILE, logLine, 'utf8');
  } catch (error) {
    console.error('Failed to write audit log:', error.message);
  }
}

/**
 * Log security-sensitive events separately
 */
function logSecurityEvent(entry) {
  if (!entry.success || entry.statusCode === 403 || entry.statusCode === 401) {
    const securityLog = path.join(__dirname, '../logs/security.log');
    const logLine = JSON.stringify({
      ...entry,
      type: 'SECURITY_EVENT'
    }) + '\n';
    fs.appendFileSync(securityLog, logLine, 'utf8');
  }
}

/**
 * Determine resource type from URL
 */
function getResourceType(url) {
  const resourceMatch = url.match(/\/(patients|doctors|appointments|prescriptions|lab|radiology|billing)/);
  return resourceMatch ? resourceMatch[1].toUpperCase() : 'UNKNOWN';
}

/**
 * Get data classification level
 */
function getDataClassification(url) {
  if (url.includes('billing')) return 'FINANCIAL';
  if (url.includes('prescription')) return 'MEDICAL';
  if (url.includes('lab') || url.includes('radiology')) return 'MEDICAL';
  if (url.includes('patient') || url.includes('appointment')) return 'PII';
  return 'GENERAL';
}

/**
 * Determine if entry should be flagged for compliance review
 */
function shouldFlagForCompliance(req, res) {
  // Flag if: DELETE operation, unauthorized attempt, medical record change, billing change
  return (
    req.method === 'DELETE' ||
    res.statusCode === 401 ||
    res.statusCode === 403 ||
    ['lab', 'radiology', 'prescription', 'billing'].some(resource => req.originalUrl.includes(resource)) && req.method !== 'GET'
  );
}

/**
 * Hash sensitive data for compliance (don't store plain passwords/sensitive data)
 */
function hashData(data) {
  const crypto = require('crypto');
  const safeData = typeof data === 'string' ? data : JSON.stringify(data ?? {});
  return crypto.createHash('sha256').update(safeData).digest('hex').substring(0, 16);
}

/**
 * Summarize response (exclude sensitive fields)
 */
function summarizeResponse(data) {
  if (!data || typeof data !== 'object') return 'NO_RESPONSE';
  
  const sensitiveFields = ['password', 'token', 'secret', 'creditCard', 'ssn'];
  const summary = { ...data };
  
  sensitiveFields.forEach(field => {
    if (field in summary) {
      summary[field] = '***REDACTED***';
    }
  });
  
  return JSON.stringify(summary).substring(0, 200); // First 200 chars
}

/**
 * Generate unique request ID for tracing
 */
function generateRequestId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Export audit log reader (for admin dashboard)
 */
const getAuditLogs = (filter = {}) => {
  try {
    if (!fs.existsSync(AUDIT_LOG_FILE)) return [];
    
    const logs = fs
      .readFileSync(AUDIT_LOG_FILE, 'utf8')
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line))
      .reverse() // Most recent first
      .slice(0, 1000); // Last 1000 entries
    
    // Apply filters if provided
    if (filter.userId) {
      return logs.filter(log => log.userId === filter.userId);
    }
    if (filter.resourceType) {
      return logs.filter(log => log.resourceType === filter.resourceType);
    }
    if (filter.startDate) {
      return logs.filter(log => new Date(log.timestamp) >= new Date(filter.startDate));
    }
    
    return logs;
  } catch (error) {
    console.error('Failed to read audit logs:', error.message);
    return [];
  }
};

module.exports = auditMiddleware;
module.exports.getAuditLogs = getAuditLogs;
