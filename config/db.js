const dns = require('dns');
const mongoose = require('mongoose');

// Work around local DNS servers that refuse SRV lookups used by mongodb+srv URIs.
dns.setServers(['8.8.8.8', '1.1.1.1']);

/**
 * Connect to MongoDB Atlas with retry logic and enhanced error messaging
 * HIPAA/GDPR compliant: Logs connection issues without exposing sensitive credentials
 */
const connectDB = async () => {
    const preflightIssue = validateMongoEnvironment();
    if (preflightIssue) {
        console.warn('\n⚠️  MongoDB preflight check warning');
        console.warn(`   ${preflightIssue}`);
        console.log('   Server will start without database connection for development.\n');
        return false;
    }

    const MAX_RETRIES = 3;
    const RETRY_DELAY = 5000; // 5 seconds
    let attempt = 0;

    const attemptConnection = async () => {
        attempt++;
        try {
            await mongoose.connect(process.env.MONGO_URI, {
                serverSelectionTimeoutMS: 10000,
                socketTimeoutMS: 10000,
                connectTimeoutMS: 10000
            });
            
            console.log('\n✅ MongoDB Atlas connected successfully');
            console.log(`   Connected to: ${getClusterName()}`);
            return true;
        } catch (error) {
            console.error(`\n❌ MongoDB connection attempt ${attempt}/${MAX_RETRIES} failed`);
            
            // Provide specific troubleshooting hints based on error type
            const hint = getAtlasTroubleshootingHint(error);
            console.error(`\n${hint}`);
            
            if (attempt < MAX_RETRIES) {
                const waitSeconds = RETRY_DELAY / 1000;
                console.log(`\n⏳ Retrying in ${waitSeconds} seconds...\n`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                return attemptConnection();
            } else {
                console.warn('\n⚠️  MongoDB connection failed after all retries.');
                console.log('   Server will start without database connection for development.\n');
                return false;
            }
        }
    };

    return attemptConnection();
};

/**
 * Extract Atlas cluster name from URI for logging
 */
function getClusterName() {
    const uri = process.env.MONGO_URI || '';
    const match = uri.match(/@([^.]+)\./);
    return match ? match[1] : 'Unknown';
}

function validateMongoEnvironment() {
    const uri = process.env.MONGO_URI;

    if (!uri) {
        return 'MONGO_URI is missing in environment. Add it to .env before starting the server.';
    }

    if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
        return 'MONGO_URI must start with mongodb:// or mongodb+srv://';
    }

    if (!uri.includes('@') || !uri.includes('.mongodb.net')) {
        return 'MONGO_URI looks malformed. Use the MongoDB Atlas driver connection string from Atlas -> Connect -> Drivers.';
    }

    return null;
}

/**
 * Provide Atlas-specific troubleshooting hints based on error type
 */
function getAtlasTroubleshootingHint(error) {
    const errorMsg = error.message || '';
    
    if (errorMsg.includes('ENOTFOUND') || errorMsg.includes('getaddrinfo')) {
        return `
⚠️  DNS Resolution Error - Cannot reach MongoDB Atlas
   
   Cause: Network or DNS issue preventing connection to cluster
   
   Fixes to try:
   1. Check your internet connection
   2. Verify the cluster hostname in MONGO_URI is correct
   3. Ensure your firewall/antivirus isn't blocking MongoDB connections
   4. Try: ipconfig /flushdns  (flush DNS cache)
   5. Check Atlas cluster status at: https://cloud.mongodb.com
        `;
    }
    
    if (errorMsg.includes('authentication failed') || errorMsg.includes('auth failed')) {
        return `
⚠️  Authentication Error - Invalid MongoDB credentials
   
   Cause: User/password mismatch or character encoding issue
   
   Fixes to try:
   1. Verify username and password in MONGO_URI are correct
   2. If password contains special chars: encode them or change to alphanumeric
   3. Ensure user exists in correct database in Atlas
   4. Reset DB user password in Atlas and update MONGO_URI
   5. In Atlas Network Access, verify IP whitelist includes: 105.113.98.86
        `;
    }
    
    if (errorMsg.includes('connect ECONNREFUSED') || errorMsg.includes('ECONNREFUSED')) {
        return `
⚠️  Connection Refused - Cannot connect to MongoDB Atlas
   
   Cause: Most likely: IP address not whitelisted in Atlas
   
   Fixes to try:
   1. Go to: https://cloud.mongodb.com -> Network Access
   2. Add your current IP: 105.113.98.86
   3. Or add 0.0.0.0/0 for development (NOT production)
   4. Wait 1-2 minutes for whitelist to take effect
   5. Verify cluster is running in Atlas UI
   6. Check firewall isn't blocking port 27017
        `;
    }
    
    if (errorMsg.includes('unable to find') || errorMsg.includes('unknown') || errorMsg.includes('getaddrinfo NOTFOUND')) {
        return `
⚠️  Cluster Not Found - Invalid or inaccessible hostname
   
   Cause: Hostname in MONGO_URI doesn't exist or is malformed
   
   Fixes to try:
   1. Verify MONGO_URI format: mongodb+srv://user:pass@cluster-name.xxx.mongodb.net/?appName=...
   2. Get correct URI from Atlas -> Connect -> Drivers
   3. Ensure cluster name matches exactly (case-sensitive)
   4. Check cluster hasn't been deleted in Atlas
   5. Verify environment variable MONGO_URI is loaded correctly
        `;
    }
    
    if (errorMsg.includes('Timeout') || errorMsg.includes('timeout')) {
        return `
⚠️  Connection Timeout - Response took too long
   
   Cause: Network latency, IP whitelist, or Atlas overload
   
   Fixes to try:
   1. In Atlas Network Access, whitelist your IP: 105.113.98.86
   2. Check your internet connectivity (ping 8.8.8.8)
   3. Try from a different network to isolate network issue
   4. Check Atlas cluster status (may be scaling/recovering)
   5. Increase timeout if on slow network (already set to 10s)
        `;
    }
    
    // Generic fallback
    return `
⚠️  MongoDB Connection Error
   
   Error: ${errorMsg}
   
   Common Atlas issues:
   1. IP not whitelisted: https://cloud.mongodb.com -> Network Access
   2. Invalid credentials: Check username/password in MONGO_URI
   3. Cluster offline/deleted: Verify in Atlas UI
   4. Network blocked: Check firewall/antivirus settings
   
   Debug steps:
   • Verify MONGO_URI is correct and environment variable is loaded
   • Test from: https://cloud.mongodb.com -> Connect -> Test Connection
   • Check Atlas cluster status dashboard
   • Review Atlas activity log for errors
        `;
}

module.exports = connectDB;