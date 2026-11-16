// 1. IMPORT DOTENV AND LOAD IMMEDIATELY
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// 2. NOW import your other dependencies
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');

// 🚀 WATCHDOG: This proves your server is running the NEW code
console.log("🔥 SERVER RESTARTED: I am reading the latest code!"); 
console.log("Check API Key Status:", process.env.CLOUDINARY_API_KEY ? "✅ LOADED" : "❌ FAILED");

// 3. NOW import and configure Cloudinary
const cloudinary = require('cloudinary').v2;

cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
    api_key: process.env.CLOUDINARY_API_KEY, 
    api_secret: process.env.CLOUDINARY_API_SECRET 
});

// 4. THE UNIVERSAL IMAGE UPLOADER HELPER
async function uploadToCloudinary(base64Image, folderName) {
    if (!base64Image || base64Image.startsWith('http')) return base64Image; 
    
    try {
        const result = await cloudinary.uploader.upload(base64Image, {
            folder: `vertex_schools/${folderName}`,
            resource_type: "image",
            quality: "auto",
            fetch_format: "auto"
        });
        return result.secure_url;
    } catch (error) {
        console.error("[CLOUDINARY ERROR]:", error);
        return null;
    }
}

// --- NETWORK STABILITY & DNS FIX ---
const dns = require('dns');
const http = require('http');
const https = require('https');

dns.setDefaultResultOrder('ipv4first');

// Force global keep-alive to prevent "UV_HANDLE_CLOSING" crashes on Windows
http.globalAgent = new http.Agent({ keepAlive: true });
https.globalAgent = new https.Agent({ keepAlive: true });
// -------------------------------

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();

// =====================================================================
// GLOBAL MIDDLEWARE (Resumes normal parsing for the rest of your app)
// =====================================================================
// 1. Proxy settings first
app.set('trust proxy', 1); 

// 2. Global Middleware
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());
app.use(helmet({ contentSecurityPolicy: false })); 
app.use(cors());

// 3. Process error handling (This is fine here)
process.on('unhandledRejection', (reason, promise) => { 
    console.error('⚠️ Unhandled Rejection warning:', reason); 
});

// =====================================================================
// 🚀 3. THE SAAS SUBDOMAIN INTERCEPTOR (MIDDLEWARE)
// =====================================================================
app.use(async (req, res, next) => {
    try {
        // Step 1: Immediately identify what domain the user is visiting
        let host = req.headers.host || '';
        let subdomain = host.split('.')[0].toLowerCase();

        // ==========================================
        // EXCLUSIVE MASTER ROUTING (God Mode)
        // ==========================================
        if (subdomain === 'master') {
            // Serve the master dashboard cleanly on master.vertexnextgen.com.ng
            if (req.path === '/' || req.path === '/master') {
                return res.sendFile(path.join(__dirname, '..', 'public', 'master.html')); // 🚀 RESTORED
            }
            // Allow static files (CSS/JS) and Master APIs to load
            if (req.path.startsWith('/api/v1/master') || req.path.includes('.')) {
                return next();
            }
            // If they type a random path on the master domain, send them back to the dashboard
            return res.redirect('/');
        }

        // ==========================================
        // STRICT SECURITY WALL FOR SCHOOLS
        // ==========================================
        // If a school subdomain tries to access the master dashboard, block them immediately!
        if (req.path === '/master' || req.path.startsWith('/api/v1/master')) {
            return res.status(403).send(`
                <h2 style="font-family: sans-serif; text-align: center; margin-top: 50px; color: #d9534f;">
                    ⛔ 403 Forbidden
                </h2>
                <p style="text-align: center; font-family: sans-serif;">
                    Access to the Master Command Center is restricted.
                </p>
            `);
        }

        // Allow static files (images, CSS) to pass through for school portals
        if (req.path.includes('.')) {
            return next();
        }

        // ==========================================
        // NORMAL SCHOOL ROUTING (WITH SAAS RAM CACHE)
        // ==========================================
        // If bare localhost is accessed during development, ask for a subdomain
        if (subdomain === 'localhost' || subdomain === '127') {
             return res.status(400).send(`
                <div style="font-family:sans-serif; text-align:center; padding:50px;">
                    <h2 style="color: #3182ce;">Vertex SaaS Platform</h2>
                    <p>Please access your specific school URL.<br><b>Example: http://foundation.localhost:3000</b></p>
                </div>
             `);
        }

        // 🚀 THE SAAS SPEED FIX: RAM Cache for Subdomains
        // Instead of querying the Master DB 6 times per second on page load, we check memory first!
        if (!global.tenantCache) global.tenantCache = new Map();
        
        let tenant = global.tenantCache.get(subdomain);
        
        if (!tenant) {
            // Only hit the database if it is not in memory
            tenant = await Tenant.findOne({ subdomain: subdomain });
            if (tenant) {
                global.tenantCache.set(subdomain, tenant);
                // Automatically clear the cache every 10 minutes so plan upgrades sync properly
                setTimeout(() => global.tenantCache.delete(subdomain), 10 * 60 * 1000);
            }
        }

        if (!tenant) {
            return res.status(404).send(`School portal '${subdomain}' not found. Please check the URL.`);
        }

        if (tenant.status === 'Suspended') {
            return res.status(403).send("This school portal has been suspended due to an inactive subscription.");
        }

        // 🚀 THE SAAS INJECTION: Attach the specific database connection to this request!
        req.tenantDb = getTenantDB(tenant.dbName);
        req.tenantInfo = tenant;

        next();
    } catch (error) {
        console.error("Subdomain Routing Error:", error);
        res.status(500).send("Internal Server Error during routing.");
    }
});

// 🚀 DYNAMIC MANIFEST ROUTE
app.get('/manifest.json', async (req, res) => {
    console.log("🔥 Manifest Route Hit!"); // <-- ADD THIS LINE
    try {
        let host = req.headers.host || '';
        let subdomain = host.split('.')[0].toLowerCase();
        if (subdomain === 'localhost' || subdomain === '127') subdomain = 'foundation'; 
        const tenant = await Tenant.findOne({ subdomain: subdomain });
        if (!tenant) return res.status(404).json({ error: "Tenant not found" });
        const tenantDb = getTenantDB(tenant.dbName);
        const Settings = tenantDb.model('Settings', settingsSchema);
        const settings = await Settings.findOne() || {};
        const manifest = {
            "name": settings.schoolName || "School Portal",
            "short_name": settings.schoolShortName || "Portal",
            "start_url": "/",
            "display": "standalone",
            "background_color": "#ffffff",
            "theme_color": settings.themeColor || "#3182ce",
            "icons": [{ "src": settings.schoolLogo || "/icon-192.png", "sizes": "192x192", "type": "image/png" }]
        };
        res.setHeader('Content-Type', 'application/json');
        res.json(manifest);
    } catch (e) { res.status(500).json({ error: "Failed to generate manifest" }); }
});

app.use(express.static(path.join(__dirname, '..', 'public'))); // 🚀 RESTORED

// =====================================================================
// 🚀 PAYSTACK WEBHOOK (MUST GO BEFORE express.json)
// We use express.raw() so the security signature doesn't break
// =====================================================================
app.post('/api/v1/webhook/paystack', express.raw({type: 'application/json'}), async (req, res) => {
    try {
        // 🚀 THE FIX: Pull the secret key dynamically from the database
        const settings = await mongoose.model('Settings').findOne();
        const secret = settings?.paystackSecretKey; // Removed the .env fallback!
        
        if (!secret) return res.status(400).send('Webhook secret not configured.');

        const hash = crypto.createHmac('sha512', secret).update(req.body).digest('hex');

        if (hash === req.headers['x-paystack-signature']) {
            // ... [keep the rest of your webhook logic the exact same] ...            const event = JSON.parse(req.body.toString());

            if (event.event === 'charge.success') {
                const reference = event.data.reference;
                
                // 🚀 IDEMPOTENCY LOCK: Atomic Update. 
                // Ensures status is exactly 'Pending Fee'. If Paystack fires twice in the same millisecond, 
                // the second webhook will find nothing and drop peacefully.
                const applicant = await mongoose.model('Application').findOneAndUpdate(
                    { paymentReference: reference, status: 'Pending Fee' },
                    { $set: { status: 'Applied' } },
                    { new: true }
                );
                
                if (applicant) {
                    console.log(`[WEBHOOK] ✅ Payment Verified & Applied. Ref: ${reference} | Student: ${applicant.studentName}`);
                } else {
                    console.log(`[WEBHOOK] 🛡️ Dropped Duplicate/Processed Webhook. Ref: ${reference}`);
                }
            }
        }
        // ALWAYS return 200 OK immediately
        res.status(200).send('Webhook received successfully');
    } catch (error) {
        console.error("[WEBHOOK ERROR]:", error);
        res.status(500).send('Internal Server Error');
    }
});

// =====================================================================
// 👑 1. MASTER PLATFORM CONNECTION
// =====================================================================
const masterDb = mongoose.createConnection(process.env.MASTER_MONGO_URI, {
    serverSelectionTimeoutMS: 10000, socketTimeoutMS: 45000,
    maxPoolSize: 10, minPoolSize: 2, family: 4 
});

masterDb.on('connected', () => console.log('👑 Connected to Master Platform Database!'));
masterDb.on('error', (err) => console.error('❌ Master DB Error:', err));

const tenantSchema = new mongoose.Schema({
    schoolName: { type: String, required: true },
    adminEmail: { type: String, required: true }, 
    subdomain: { type: String, required: true, unique: true }, 
    dbName: { type: String, required: true }, 
    planTier: { type: String, enum: ['Basic', 'Standard', 'Premium'], default: 'Basic' },
    status: { type: String, enum: ['Active', 'Suspended'], default: 'Active' },
    // 🚀 NEW: Paystack SaaS Billing Tracking
    paystackCustomerId: { type: String, default: null },
    paystackSubscriptionId: { type: String, default: null },
    nextBillingDate: { type: Date, default: null },
    activeStudentCount: { type: Number, default: 0 } // 🚀 ADD THIS
});
const Tenant = masterDb.model('Tenant', tenantSchema);

// 🚀 MASTER BILLING SETTINGS
const billingSettingsSchema = new mongoose.Schema({
    rates: {
        Basic: { type: Number, default: 500 },
        Standard: { type: Number, default: 600 },
        Premium: { type: Number, default: 700 }
    },
    lastUpdated: { type: Date, default: Date.now }
});
const BillingSettings = masterDb.model('BillingSettings', billingSettingsSchema);

// 🚀 MASTER INVOICE LEDGER
const masterInvoiceSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
    schoolName: String,
    amount: Number,
    studentCount: Number,
    rateUsed: Number,
    status: { type: String, enum: ['Unpaid', 'Paid'], default: 'Unpaid' },
    createdAt: { type: Date, default: Date.now },
    paidAt: { type: Date, default: null }
});
const MasterInvoice = masterDb.model('MasterInvoice', masterInvoiceSchema);

// =====================================================================
// 🏫 2. THE DYNAMIC SCHOOL CONNECTION POOL
// =====================================================================
const clusterConnection = mongoose.createConnection(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 10000, socketTimeoutMS: 45000,
    maxPoolSize: 50, family: 4 
});

clusterConnection.on('connected', () => console.log('🏫 Connected to Atlas Cluster (Waiting for subdomains...)'));

function getTenantDB(dbName) {
    if (!dbName) throw new Error("CRITICAL: Attempted to get a tenant DB without a dbName.");
    // Force Mongoose to use the cached connection rather than creating a new handle every time
    return clusterConnection.useDb(dbName, { useCache: true });
}

// ==========================================
// 1. DATABASE SCHEMAS
// ==========================================

const userSchema = new mongoose.Schema({
    email: { type: String, required: true }, 
    password: { type: String, required: true }, 
    fullName: { type: String, required: true },
    systemId: { type: String, default: null }, 
    role: { type: String, enum: ['Super Admin', 'Admin', 'Assistant Admin', 'Bursar', 'Assistant Bursar', 'Principal', 'Teacher', 'Staff', 'Student', 'Applicant', 'Parent'], default: 'Applicant' },
    jobTitle: { type: String, default: "Staff" },
    dateOfBirth: { type: String, default: "" }, 
    gender: { type: String, default: "" }, 
    religion: { type: String, default: "" }, 
    classAssigned: { type: String, default: null },
    subjectsAssigned: { type: String, default: null }, 
    teacherType: { type: String, default: null }, 
    formClass: { type: String, default: null },
    signature: { type: String, default: "" }, 
    photo: { type: String, default: "" },
    loginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },
    lockCount: { type: Number, default: 0 }, 
    walletBalance: { type: Number, default: 0 },
    accountStatus: { type: String, enum: ['Active', 'Archived'], default: 'Active' }, 
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
    otpRequests: { type: Number, default: 0 },
    lastOtpDate: { type: Date }, // 👈 COMMA ADDED HERE!
    linkedStudentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

const applicationSchema = new mongoose.Schema({
    studentName: { type: String, required: true },
    parentName: { type: String, default: "Parent/Sponsor" }, // 🚀 NEW: Captures Sponsor's Name
    parentEmail: { type: String, required: true },
    parentPhone: { type: String, required: true },
    targetClass: { type: String, required: true },
    studentType: { type: String, enum: ['Day', 'Boarding'], default: 'Day' },
    dateOfBirth: { type: String, default: "" }, 
    gender: { type: String, default: "" }, 
    religion: { type: String, default: "" }, 
    passportPhoto: { type: String }, 
    systemId: { type: String, default: null }, 
    status: { type: String, enum: ['Pending Fee', 'Applied', 'Completed', 'Exam Scheduled', 'Exam Graded', 'Admitted', 'Rejected', 'Archived', 'Graduated'], default: 'Pending Fee' },
    // 🛡️ SECURITY MODULE: Delegated Pickup
    pickupDelegate: { type: String, default: null },
    pickupOtp: { type: String, default: null },
    pickupOtpExpiry: { type: Date, default: null },
    lastPickupDate: { type: Date, default: null }, // Tracks daily limit
    pickupHistory: [{ 
        dateGenerated: { type: Date, default: Date.now },
        delegateName: String,
        otp: String,
        status: { type: String, enum: ['Pending', 'Verified'], default: 'Pending' },
        dateVerified: Date,
        verifiedBy: String
    }],
    examDate: { type: String, default: null }, 
    entranceScore: { type: Number, default: null }, 
    linkedStudentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null } 
}, { timestamps: true });
const Application = mongoose.model('Application', applicationSchema);

const inventorySchema = new mongoose.Schema({
    itemName: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, default: 0 }
});
const InventoryItem = mongoose.model('InventoryItem', inventorySchema);

// ==========================================
// CBT & EXAM SCHEMAS
// ==========================================
const questionSchema = new mongoose.Schema({
    questionText: { type: String, required: true },
    options: [{ type: String, required: true }],
    correctAnswer: { type: String, required: true },
    subjectCategory: { type: String }, // Used to group entrance exams
    serveCount: { type: Number }       // Used to limit entrance exams
});

// ------------------------------------------
// CBT QUESTION BANK (THE CENTRAL VAULT)
// ------------------------------------------
const questionBankSchema = new mongoose.Schema({
    subject: { type: String, required: true },
    targetClass: { type: String, required: true },
    questionText: { type: String, required: true },
    options: [{ type: String, required: true }],
    correctAnswer: { type: String, required: true },
    addedBy: { type: String, default: "Admin" }, 
    vaultType: { type: String, enum: ['Regular', 'Entrance'], default: 'Regular' } // NEW: Keeps entrance questions separate!
}, { timestamps: true });
const QuestionBank = mongoose.model('QuestionBank', questionBankSchema);

const examSchema = new mongoose.Schema({
    title: { type: String, required: true },
    targetClass: { type: String, required: true },
    subject: { type: String, required: true },
    examType: { type: String, enum: ['Official', 'Mock', 'Homework', 'Entrance'], default: 'Official' }, 
    durationMinutes: { type: Number, required: true },
    instructions: { type: String, default: "" }, 
    questions: [questionSchema],
    status: { type: String, enum: ['Draft', 'Published', 'Archived'], default: 'Draft' }, 
    session: { type: String },
    term: { type: String },
    // 🚀 NEW: Lock the dates permanently into the database
    validityDays: { type: Number, default: 14 },
    serveCount: { type: Number },
    startTime: { type: Date },
    endTime: { type: Date }
}, { timestamps: true });
const Exam = mongoose.model('Exam', examSchema);

const examAttemptSchema = new mongoose.Schema({
    studentId: { type: String, required: true },
    studentName: { type: String, required: true },
    examId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
    examTitle: { type: String },
    score: { type: Number, required: true },
    totalQuestions: { type: Number, required: true },
    percentage: { type: Number, required: true }
}, { timestamps: true });
const ExamAttempt = mongoose.model('ExamAttempt', examAttemptSchema);

// ------------------------------------------
// CBT HYBRID AUTO-SAVE ENGINE
// ------------------------------------------
const examProgressSchema = new mongoose.Schema({
    studentId: { type: String, required: true },
    examId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
    absoluteStartTime: { type: Number, required: true },
    answers: { type: Object, default: {} },
    isSubmitted: { type: Boolean, default: false } // <--- ADD THIS
}, { timestamps: true });
const ExamProgress = mongoose.model('ExamProgress', examProgressSchema);

// ------------------------------------------
// CBT BATCH SESSIONS & ASSIGNMENTS
// ------------------------------------------
const examSessionSchema = new mongoose.Schema({
    examId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
    name: { type: String, required: true }, 
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    venue: { type: String, default: "Main ICT Lab" }, // 📍 NEW: Exam Venue
    maxStudents: { type: Number, default: 40 },
    pin: { type: String }, // NEW: The 5-digit whiteboard PIN
    status: { type: String, enum: ['Active', 'Archived'], default: 'Active' }
}, { timestamps: true });
const ExamSession = mongoose.model('ExamSession', examSessionSchema);

const examAssignmentSchema = new mongoose.Schema({
    examId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamSession', required: true },
    studentId: { type: String, required: true }, // The student's linkedStudentId
    studentName: { type: String, required: true }
}, { timestamps: true });
const ExamAssignment = mongoose.model('ExamAssignment', examAssignmentSchema);

const lessonNoteSchema = new mongoose.Schema({
    teacherName: { type: String, required: true },
    targetClass: { type: String, required: true },
    subject: { type: String, required: true },
    week: { type: String, required: true },
    topic: { type: String, required: true },
    contentLink: { type: String, required: true }, 
    status: { type: String, enum: ['Pending', 'Approved', 'Query'], default: 'Pending' },
    adminFeedback: { type: String, default: '' }
}, { timestamps: true });
const LessonNote = mongoose.model('LessonNote', lessonNoteSchema);

const eLearningSchema = new mongoose.Schema({
    targetClass: { type: String, required: true },
    subject: { type: String, required: true },
    title: { type: String, required: true },
    link: { type: String, required: true }, 
    instructions: { type: String },
    postedBy: { type: String }, 
    createdAt: { type: Date, default: Date.now }
});
const ELearning = mongoose.model('ELearning', eLearningSchema);

const resultSchema = new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    session: { type: String, required: true }, 
    term: { type: String, required: true },    
    records: [{
        subject: { type: String, required: true },
        ca1: { type: Number, default: null },
        ca2: { type: Number, default: null },
        exam: { type: Number, default: null },
        score: { type: Number, default: 0 }
    }],
    attendance: { type: Number, default: 0 },
    maxAttendance: { type: Number, default: 0 },
    remarks: { type: String, default: "" },
    principalRemarks: { type: String, default: "" },
    formTeacherSignature: { type: String, default: "" }, 
    formTeacherName: { type: String, default: "" }, 
    skills: {
        attentiveness: { type: Number, default: 5 },
        honesty: { type: Number, default: 5 },
        neatness: { type: Number, default: 5 },
        politeness: { type: Number, default: 5 },
        punctuality: { type: Number, default: 5 },
        obedience: { type: Number, default: 5 },
        reliability: { type: Number, default: 5 },
        tools: { type: Number, default: 5 },
        drawing: { type: Number, default: 5 },
        handwriting: { type: Number, default: 5 },
        speaking: { type: Number, default: 5 },
        sports: { type: Number, default: 5 }
    },
    publishStage: { type: String, enum: ['Draft', 'CA1', 'CA2', 'Full'], default: 'Draft' } 
}, { timestamps: true });
const Result = mongoose.model('Result', resultSchema);

const staffAttendanceSchema = new mongoose.Schema({
    teacherName: { type: String, required: true },
    date: { type: String, required: true },
    timeIn: { type: String, required: true },
    timeOut: { type: String, default: null },
    locationVerified: { type: Boolean, default: true },
    photoIn: { type: String },  // 🚀 NEW: Captures morning selfie
    photoOut: { type: String }  // 🚀 NEW: Captures afternoon selfie
}, { timestamps: true });
const StaffAttendance = mongoose.model('StaffAttendance', staffAttendanceSchema);

// ==========================================
// ✉️ INTERNAL MESSAGING SCHEMA (THE MATRIX)
// ==========================================
const messageSchema = new mongoose.Schema({
    senderId: { type: String, required: true },
    senderName: { type: String, required: true },
    senderRole: { type: String, required: true },
    targetId: { type: String, required: true }, // 'Admin', 'Broadcast_Parents', or specific User ID
    targetName: { type: String, required: true },
    targetRole: { type: String, required: true },
    subject: { type: String, required: true },
    message: { type: String, required: true },
    isReadByTarget: { type: Boolean, default: false },
    isReadBySender: { type: Boolean, default: true },
    replies: [{
        senderId: String,
        senderName: String,
        senderRole: String,
        message: String,
        timestamp: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

// 🚀 HIGH-PERFORMANCE INDEX: Prevents system slowdown during peak hours
messageSchema.index({ targetId: 1, senderId: 1 });
messageSchema.index({ updatedAt: -1 });

// 🚀 HIGH-PERFORMANCE INDEX: Makes fetching instant even with 100,000 messages
messageSchema.index({ targetRole: 1, targetId: 1, senderId: 1 });
messageSchema.index({ createdAt: -1 });

// ==========================================
// 🤖 VERTEX SYSTEM BOT (Automated Messenger)
// ==========================================
const sendSystemMessage = async (tenantDb, targetId, targetName, targetRole, subject, message) => {
    try {
        const TenantMessage = tenantDb.model('Message', messageSchema);
        const TenantSettings = tenantDb.model('Settings', settingsSchema); // 🚀 Let the bot read the settings
        
        // Fetch the specific school's name
        const settings = await TenantSettings.findOne() || {};
        const dynamicSchoolName = settings.schoolName || 'System Notification';

        const sysMsg = new TenantMessage({
            senderId: 'SYSTEM_BOT',
            senderName: dynamicSchoolName, // 🚀 Use the School's actual name!
            senderRole: 'Automated Notification',
            targetId: targetId,
            targetName: targetName,
            targetRole: targetRole,
            subject: subject,
            message: message,
            isReadByTarget: false,
            isReadBySender: true,
            replies: [] 
        });

        await sysMsg.save();
        return true;
    } catch (error) {
        console.error("System Bot Failed to send message:", error);
        return false;
    }
};

const scheduleSchema = new mongoose.Schema({
    className: { type: String, required: true },
    title: { type: String, required: true }, 
    type: { type: String, enum: ['Test', 'Exam'], required: true },
    details: { type: String, required: true } 
}, { timestamps: true });
const Schedule = mongoose.model('Schedule', scheduleSchema);

// Remove any other attendanceSchema or mongoose.model('Attendance') lines first!
const attendanceSchema = new mongoose.Schema({
    studentId: { type: String, required: true },
    className: { type: String, required: true },
    date: { type: String, required: true }, // Format: YYYY-MM-DD
    status: { type: String, enum: ['Present', 'Absent', 'Pending'], default: 'Pending' }, // Morning
    afternoonStatus: { type: String, enum: ['Present', 'Absent', 'Pending'], default: 'Pending' } // Afternoon
}, { timestamps: true });

const Attendance = mongoose.models.Attendance || mongoose.model('Attendance', attendanceSchema);

// TIMETABLE ENGINE SCHEMA
// ==========================================
const timetableSchema = new mongoose.Schema({
    className: { type: String, required: true },
    session: { type: String, required: true },
    term: { type: String, required: true },
    schedule: [{
        day: { type: String, enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], required: true },
        periods: [{
            startTime: { type: String, required: true }, // e.g., "08:00"
            endTime: { type: String, required: true },   // e.g., "08:40"
            subject: { type: String, required: true },
            teacherName: { type: String, required: true },
            type: { type: String, enum: ['Class', 'Break'], default: 'Class' }
        }]
    }]
}, { timestamps: true });

// We use a compound index to ensure a class only has ONE timetable per term
timetableSchema.index({ className: 1, session: 1, term: 1 }, { unique: true });

const Timetable = mongoose.model('Timetable', timetableSchema);

const invoiceItemSchema = new mongoose.Schema({
    itemName: { type: String, required: true },
    amount: { type: Number, required: true },
    isMandatory: { type: Boolean, default: true }
});

const invoiceSchema = new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },  
    invoiceType: { type: String, enum: ['Core', 'Ancillary'], default: 'Core' }, // 🚀 NEW: Core vs Optional Service
    amount: { type: Number, required: true }, 
    amountPaid: { type: Number, default: 0 },
    balance: { type: Number },
    session: { type: String, required: true },
    term: { type: String, required: true },
    status: { type: String, enum: ['Unpaid', 'Partial', 'Paid'], default: 'Unpaid' },
    breakdown: [invoiceItemSchema],
    paymentDate: { type: Date },
    isBulk: { type: Boolean, default: false } // 🚀 NEW: Prevents individual deletion of bulk batches!
}, { timestamps: true });

invoiceSchema.pre('save', function() {
    if (this.isNew && this.balance == null) {
        this.balance = this.amount;
    }
});
const Invoice = mongoose.model('Invoice', invoiceSchema);

const transactionSchema = new mongoose.Schema({
    name: { type: String, required: true },
    amount: { type: Number, required: true },
    type: { type: String, default: 'Income' },
    description: { type: String, required: true },
    session: { type: String, required: true },
    term: { type: String, required: true },
    date: { type: Date, default: Date.now },
    studentId: { type: String, default: null } // 🚀 NEW: Links receipt to the exact student!
}, { timestamps: true });
const Transaction = mongoose.model('Transaction', transactionSchema);

// 🚀 PLATFORM OWNER VAULT (Strictly protected, School cannot edit)
const subscriptionSchema = new mongoose.Schema({
    planTier: { type: String, enum: ['Basic', 'Standard', 'Premium'], default: 'Premium' },
    accountStatus: { type: String, enum: ['Active', 'Suspended'], default: 'Active' },
    expiryDate: { type: Date, default: null },
    enabledFeatures: {
        // Core Modules
        cbt: { type: Boolean, default: true },             
        cbtBank: { type: Boolean, default: true },       
        schoolStore: { type: Boolean, default: true },   
        financialAudit: { type: Boolean, default: true },
        gpsAttendance: { type: Boolean, default: true }, 
        auditLogs: { type: Boolean, default: true },     
        idGeneration: { type: Boolean, default: true },  
        timetable: { type: Boolean, default: true },     
        debtorSms: { type: Boolean, default: true },     
        broadsheets: { type: Boolean, default: true },   
        elearning: { type: Boolean, default: true },     
        staffAttendance: { type: Boolean, default: true},
        lessonNotes: { type: Boolean, default: true }, 
        autoEmails: { type: Boolean, default: true },
        gateSecurity: { type: Boolean, default: true }, // 🚀 NEW: Security Lock
        fullMessaging: { type: Boolean, default: true }, // 🚀 NEW: Messaging Lock
        // 👪 PARENT PORTAL FLAGS
        parentMultiStudent: { type: Boolean, default: true }, // Always TRUE so they can pay fees
        parentHistory: { type: Boolean, default: true },
        parentDownloads: { type: Boolean, default: true },
        parentLedger: { type: Boolean, default: true },
        parentCbtScores: { type: Boolean, default: true }
    }
});

const Subscription = mongoose.model('Subscription', subscriptionSchema);

// 🏫 SCHOOL OWNER SETTINGS (Editable by Principal/Admin)
const settingsSchema = new mongoose.Schema({
    themeColor: { type: String, default: "#3182ce" }, 
    isAdmissionOpen: { type: Boolean, default: true },
    admissionInstructions: { type: String, default: "1. All forms must be properly filled.\n2. A recent passport photograph is required.\n3. Bring your printed slip to the exam center." },
    entranceExamDate: { type: String, default: "To Be Communicated" },
    entranceExamVenue: { type: String, default: "Main School Campus" },
    blockedAdmissionClasses: { type: String, default: "JSS 3, SSS 3" }, // Classes that do not accept new intakes
    minInstallmentPercent: { type: Number, default: 60 },
    applicationFee: { type: Number, default: 5000 }, // Keep this as the fallback default
    // 🚀 NEW: Dynamic fee structure based on target class
    classApplicationFees: { type: Object, default: {} }, // 🚀 Changed from Map to Object to prevent JSON serialization crash!
    nextTermBegins: { type: String, default: "" },
    activeSession: { type: String, default: "2025/2026" },
    activeTerm: { type: String, default: "First" },
    principalName: { type: String, default: "School Principal" },
    principalSignature: { type: String, default: "" },
    bursarSignature: { type: String, default: "" }, // 🚀 NEW: Official Bursar Signature 
    schoolLatitude: { type: Number, default: 6.5244 },
    schoolLongitude: { type: Number, default: 3.3792 },
    clockInRadius: { type: Number, default: 50 },
    schoolPrefix: { type: String, default: "SCH" }, // Changed from VIS
    jssCounter: { type: Number, default: 1 },
    sssCounter: { type: Number, default: 1 },
    bscCounter: { type: Number, default: 1 }, // 🚀 NEW: Basic Classes
    pryCounter: { type: Number, default: 1 }, // 🚀 NEW: Primary Classes
    nurCounter: { type: Number, default: 1 }, // 🚀 NEW: Nursery/Creche
    genCounter: { type: Number, default: 1 }, // 🚀 NEW: General/Fallback
    teacherCounter: { type: Number, default: 1 },
    staffCounter: { type: Number, default: 1 },
    schoolName: { type: String, default: "My School Name" }, // Changed from Vertex
    schoolNotice: { type: String, default: "" },
    schoolShortName: { type: String, default: "SCHOOL" }, // Changed from VERTEX INT'L
    schoolAddress: { type: String, default: "123 Education Avenue" }, // Changed from Vertex Campus
    schoolLogo: { type: String, default: "https://via.placeholder.com/150?text=School+Logo" },
    schoolBackground: { type: String, default: "https://via.placeholder.com/1920x1080?text=School+Background" },
    paystackPublicKey: { type: String, default: "" }, // 🚀 NEW
    paystackSecretKey: { type: String, default: "" }, // 🚀 NEW
    schoolBackground: { type: String, default: "" }, 
    gradingFormat: { type: String, enum: ['40-60', '30-70'], default: '40-60' },
    defaultStudentPassword: { type: String, default: "Student123!" },
    defaultStaffPassword: { type: String, default: "Staff123!" },
    defaultParentPassword: { type: String, default: "Parent123!" },
    defaultPeriodDuration: { type: Number, default: 40 }, // 🚀 NEW: Timetable default length
    smtpHost: { type: String, default: "smtp.gmail.com" },
    smtpPort: { type: Number, default: 465 },
    smtpUser: { type: String, default: "" },
    smtpPass: { type: String, default: "" }, 
    smtpSender: { type: String, default: "School Notifications" },
    absentEmailSubject: { type: String, default: "Attendance Alert: {studentName}" },
    absentEmailBody: { type: String, default: "Dear Parent, this is to inform you that {studentName} was marked ABSENT from {className} today, {date}." }
});
const Settings = mongoose.model('Settings', settingsSchema);

const structureSchema = new mongoose.Schema({
    levels: { type: [String], default: ["JSS 1", "JSS 2", "JSS 3", "SSS 1", "SSS 2", "SSS 3"] },
    arms: { type: [String], default: ["A", "B", "C", "Gold", "Silver"] },
    streams: { type: [String], default: ["Science", "Arts", "Commercial", "General"] },
    subjects: { type: [String], default: ["English Language", "Mathematics", "Basic Science", "Biology", "Physics", "Chemistry", "Civic Education", "Economics", "Geography"] },
    classrooms: [{
        level: String,
        arm: String,
        stream: String,
        displayName: String,
        subjects: [String] 
    }]
});
const Structure = mongoose.model('Structure', structureSchema);

// --- THE BLACK BOX (ACTION LOGGER) SCHEMA ---
const auditLogSchema = new mongoose.Schema({
    userName: { type: String, required: true },
    userRole: { type: String, required: true },
    actionType: { type: String, required: true }, // e.g., 'FINANCE', 'ACADEMIC', 'SECURITY'
    details: { type: String, required: true },
    date: { type: Date, default: Date.now }
});
const AuditLog = mongoose.model('AuditLog', auditLogSchema);

// --- GLOBAL LOGGING HELPER FUNCTION ---
// You can call this anywhere in your backend to silently record an action!
// --- GLOBAL LOGGING HELPER FUNCTION ---
async function logSystemAction(req, actionType, details) {
    if (!req.user || !req.tenantDb) return; 
    try { 
        // 🚀 SAAS FIX: Save logs to the specific school's database
        const TenantAuditLog = req.tenantDb.model('AuditLog', auditLogSchema);
        await TenantAuditLog.create({ 
            userName: req.user.name, 
            userRole: req.user.role, 
            actionType, 
            details 
        }); 
    } catch(e) { console.error("Audit Logger Failed:", e); }
}

// ==========================================
// 2. SECURITY & SMART ID ENGINE 
// ==========================================
const verifyToken = (req, res, next) => {
    const token = req.cookies.portalToken;
    if (!token) return res.status(401).json({ error: "Access Denied. No secure cookie found." });
    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.user = verified; 
        next(); 
    } catch (err) {
        res.clearCookie('portalToken');
        res.status(403).json({ error: "Invalid or expired session." });
    }
};

const optionalVerifyToken = (req, res, next) => {
    const token = req.cookies.portalToken;
    if (token) {
        try {
            const verified = jwt.verify(token, process.env.JWT_SECRET);
            req.user = verified;
            next();
        } catch (err) {
            return res.status(403).json({ error: "Invalid session." });
        }
    } else {
        // If no token, proceed as Kiosk (null user)
        req.user = null;
        next();
    }
};

// --- MIDDLEWARE: ADMIN ACCESS ---
const verifyAdmin = (req, res, next) => {
    verifyToken(req, res, () => {
        if (!req.user || !req.user.role) {
            return res.status(401).json({ error: "Unauthorized access." });
        }

        // 🚀 FIX: Add Assistant Roles so they don't get 403 Forbidden errors when processing data
        const allowedRoles = ['Super Admin', 'Principal', 'Admin', 'Bursar', 'Assistant Admin', 'Assistant Bursar'];

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: "Access Denied: Insufficient Privileges." });
        }
        next();
    });
};

// --- MIDDLEWARE: TEACHER & ADMIN ACCESS ---
const verifyTeacherOrAdmin = (req, res, next) => {
    verifyToken(req, res, () => {
        if (!req.user || !req.user.role) {
            return res.status(401).json({ error: "Unauthorized access." });
        }
        
        // Anyone who is a Teacher or higher can pass this check
        const staffRoles = ['Teacher', 'Admin', 'Principal', 'Super Admin'];
        
        if (!staffRoles.includes(req.user.role)) {
            return res.status(403).json({ error: "Access Denied. Staff privileges required." });
        }
        next();
    });
};

// =====================================================================
// 🚀 THE SAAS ENFORCER: Blocks routes based on the school's Subscription
// =====================================================================
const requireFeature = (featureName) => {
    return async (req, res, next) => {
        try {
            // 🚀 SAAS FIX: Bind to the specific school database, NOT the global void!
            const TenantSubscription = req.tenantDb.model('Subscription', subscriptionSchema);
            
            // Check the protected Subscription vault
            let sub = await TenantSubscription.findOne();
            
            // If no subscription exists, default to Premium so nothing breaks during migration
            if (!sub) {
                sub = new TenantSubscription();
                await sub.save();
            }

            // Check if their account is suspended!
            if (sub.accountStatus === 'Suspended') {
                return res.status(403).json({ error: "SaaS Violation: This school account has been suspended. Please contact platform administration." });
            }

            // The Plan Engine Logic (Matches your exact commercial tiers)
            const plan = sub.planTier;
            let isAllowed = true;

            // 1. PREMIUM: Gets everything. No checks needed.
            if (plan === 'Premium') {
                isAllowed = true;
            } 
            // 2. STANDARD: Gets everything EXCEPT the Premium-only features
            else if (plan === 'Standard') {
                const premiumOnly = ['cbt', 'schoolStore', 'financialAudit', 'gpsAttendance', 'auditLogs'];
                if (premiumOnly.includes(featureName)) isAllowed = false;
            } 
            // 3. BASIC: Only gets Core. Everything else blocked.
            else if (plan === 'Basic') {
                const basicExcluded = ['cbt', 'schoolStore', 'financialAudit', 'gpsAttendance', 'auditLogs', 'timetable', 'debtorSms', 'gateSecurity']; // 🚀 Added gateSecurity here!
                if (basicExcluded.includes(featureName)) isAllowed = false;
            }

            if (!isAllowed) {
                return res.status(403).json({ 
                    error: `Plan Restriction: The '${featureName}' feature is not available on your current '${plan}' plan. Please upgrade your subscription to access this module.` 
                });
            }

            next(); // They passed the check, let them hit the route!
        } catch (error) {
            console.error("SaaS Enforcer Error:", error);
            res.status(500).json({ error: "Internal Server Error verifying subscription." });
        }
    };
};

// 🚀 SAAS FIX: Added req to grab the tenant DB
async function generateSystemId(req, type, targetClass = '') {
    const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
    
    let settings = await TenantSettings.findOne();
    if (!settings) { settings = new TenantSettings(); await settings.save(); }
    
    const prefix = settings.schoolPrefix || "SCH";
    const year = new Date().getFullYear().toString().slice(-2); 
    
    if (type === 'Student') {
        let group = 'GEN';
        let counterField = 'genCounter';
        const tClass = targetClass.toUpperCase();
        
        // 🚀 SMART TIER DETECTION
        if (tClass.includes('JSS') || tClass.includes('JUNIOR')) { group = 'JSS'; counterField = 'jssCounter'; }
        else if (tClass.includes('SSS') || tClass.includes('SENIOR')) { group = 'SSS'; counterField = 'sssCounter'; }
        else if (tClass.includes('BSC') || tClass.includes('BASIC')) { group = 'BSC'; counterField = 'bscCounter'; }
        else if (tClass.includes('PRI') || tClass.includes('PRIMARY')) { group = 'PRY'; counterField = 'pryCounter'; }
        else if (tClass.includes('NUR') || tClass.includes('NURSERY') || tClass.includes('CRECHE')) { group = 'NUR'; counterField = 'nurCounter'; }
        else {
            // Fallback: If they use a weird custom name like "Opal Class", it grabs the first 3 letters ("OPA")
            group = tClass.substring(0, 3).replace(/[^A-Z]/g, '') || 'GEN';
        }
        
        const updatedSettings = await TenantSettings.findOneAndUpdate({}, { $inc: { [counterField]: 1 } }, { returnDocument: 'after', upsert: true });
        
        // 🚀 THE FIX: Removed the '- 1' so the IDs correctly start at 0001!
        const num = updatedSettings[counterField].toString().padStart(4, '0'); 
        
        return `${prefix}/${group}/${year}/${num}`;
    } else {
        const isStaff = type === 'Staff' || type === 'Admin';
        const roleCode = isStaff ? 'ADM' : 'TCH';
        const counterField = isStaff ? 'staffCounter' : 'teacherCounter';
        
        const updatedSettings = await TenantSettings.findOneAndUpdate({}, { $inc: { [counterField]: 1 } }, { returnDocument: 'after', upsert: true });
        const num = (updatedSettings[counterField] - 1).toString().padStart(3, '0'); 
        return `${prefix}/${roleCode}/${num}`;
    }
}

// ==========================================
// 🚀 MASTER CBT ENGINE (SAAS TENANT READY)
// ==========================================

// 1. ADMIN/TEACHER: Create a New Exam
app.post('/api/v1/cbt/exams', verifyTeacherOrAdmin, async (req, res) => {
    try {
        const TenantExam = req.tenantDb.model('Exam', examSchema);
        const TenantMessage = req.tenantDb.model('Message', messageSchema); 
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
        
        // 🚀 THE FIX: Destructure session and term from req.body!
        const { title, subject, targetClass, durationMinutes, instructions, questions, examType, validityDays, serveCount, session, term } = req.body;
        
        if (!title || !subject || !targetClass || !questions || questions.length === 0) {
            return res.status(400).json({ error: "Missing required exam fields or questions." });
        }

        let initialStatus = 'Draft';
        if (examType === 'Mock' || examType === 'Homework') initialStatus = 'Published';
        if (req.user.role === 'Admin') initialStatus = 'Published';

        const now = Date.now();
        const daysToLive = validityDays || 14;
        const validityMs = daysToLive * 24 * 60 * 60 * 1000;

        const newExam = new TenantExam({
            title, subject, targetClass, durationMinutes, instructions, questions, examType,
            serveCount: serveCount || questions.length, 
            validityDays: daysToLive,
            startTime: new Date(now), 
            endTime: new Date(now + validityMs), 
            status: initialStatus,
            session: session || "2025/2026", // 🚀 THE FIX: Save Session to DB!
            term: term || "First",           // 🚀 THE FIX: Save Term to DB!
            createdBy: req.user.id
        });

        await newExam.save();

        if (newExam.examType === 'Mock' || newExam.examType === 'Homework') {
            const settings = await TenantSettings.findOne() || {};
            const dynamicSchoolName = settings.schoolName || 'Automated System';

            const cbtMsg = new TenantMessage({
                senderId: 'SYSTEM_BOT',
                senderName: dynamicSchoolName, 
                senderRole: 'System Bot',
                targetId: 'ALL',
                targetName: newExam.targetClass,
                targetRole: `Broadcast - ${newExam.targetClass}`,
                subject: `New Assessment: ${newExam.subject} (${newExam.examType})`,
                message: `A new ${newExam.durationMinutes}-minute ${newExam.examType} for ${newExam.subject} has been published by your teacher. It is available to take immediately and will expire in ${daysToLive} days. Please navigate to the Online Exam Center to complete it.`,
                isGlobal: false
            });
            await cbtMsg.save();
        }

        res.status(201).json({ success: true, message: "Exam created successfully!", exam: newExam });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to create exam" });
    }
});

// 1.5 ADMIN ONLY: Auto-Generate Entrance Exam from Vault (MULTI-SUBJECT)
app.post('/api/v1/cbt/exams/generate-entrance', verifyAdmin, requireFeature('cbt'), async (req, res) => {
    try {
        const { title, targetClass, durationMinutes, instructions, subjectDistribution } = req.body;
        const TenantQuestionBank = req.tenantDb.model('QuestionBank', questionBankSchema);
        const TenantExam = req.tenantDb.model('Exam', examSchema);
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);

        let combinedQuestions = [];
        let totalQuestions = 0;

        for (let dist of subjectDistribution) {
            const pullCount = Number(dist.pullCount) || Number(dist.count);
            const serveCount = Number(dist.serveCount) || pullCount;
            if (pullCount <= 0) continue;
            
            const vaultQuestions = await TenantQuestionBank.aggregate([
                { $match: { targetClass, subject: dist.subject, vaultType: 'Entrance' } },
                { $sample: { size: pullCount } }
            ]);

            if (vaultQuestions.length < pullCount) {
                return res.status(400).json({ error: `Not enough Entrance questions for ${dist.subject}! Found ${vaultQuestions.length}, requested ${pullCount}.` });
            }

            vaultQuestions.forEach(q => {
                combinedQuestions.push({
                    questionText: `[${dist.subject}] ${q.questionText}`, 
                    options: q.options,
                    correctAnswer: q.correctAnswer,
                    subjectCategory: dist.subject,
                    serveCount: serveCount
                });
            });
            totalQuestions += serveCount; 
        }

        if (combinedQuestions.length === 0) return res.status(400).json({ error: "No subjects specified." });

        const settings = await TenantSettings.findOne() || {};
        const newExam = new TenantExam({ 
            title, targetClass, 
            subject: 'General Entrance Paper', 
            examType: 'Entrance', 
            durationMinutes, 
            instructions: instructions || "No special instructions.", 
            questions: combinedQuestions, 
            status: 'Draft', 
            session: settings.activeSession || "2025/2026",
            term: settings.activeTerm || "First"
        });
        
        await newExam.save();
        res.json({ success: true, message: "Entrance Exam generated successfully! It is now in your Drafts." });
    } catch (error) { res.status(500).json({ error: "Failed to generate exam" }); }
});

// 2. ADMIN/TEACHER: Get all Exams (Vault)
app.get('/api/v1/cbt/exams/admin', verifyTeacherOrAdmin, async (req, res) => {
    try {
        const TenantExam = req.tenantDb.model('Exam', examSchema);
        const exams = await TenantExam.find().sort({ createdAt: -1 }).lean();
        res.json(exams);
    } catch (error) { res.status(500).json({ error: "Failed to fetch exams" }); }
});

// 3. STUDENT: Fetch a specific Exam (HIDES CORRECT ANSWERS!)
app.get('/api/v1/cbt/exams/:id/take', verifyToken, async (req, res) => {
    try {
        const TenantExam = req.tenantDb.model('Exam', examSchema);
        const exam = await TenantExam.findById(req.params.id);
        if (!exam || exam.status !== 'Published') return res.status(404).json({ error: "Exam not available." });
        
        const secureExam = {
            _id: exam._id,
            title: exam.title,
            subject: exam.subject,
            durationMinutes: exam.durationMinutes,
            instructions: exam.instructions || "No special instructions provided.",
            questions: exam.questions.map(q => ({
                _id: q._id,
                questionText: q.questionText,
                options: q.options
            }))
        };
        res.json(secureExam);
    } catch (error) { res.status(500).json({ error: "Failed to load exam" }); }
});

// 4. STUDENT: Auto-Grade the Exam Submission
app.post('/api/v1/cbt/exams/:id/submit', async (req, res) => {
    try {
        const TenantExam = req.tenantDb.model('Exam', examSchema);
        const TenantExamAttempt = req.tenantDb.model('ExamAttempt', examAttemptSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        // Added model for the progress update
        const TenantExamProgress = req.tenantDb.model('ExamProgress', examProgressSchema);

        const { studentId, studentName, answers } = req.body; 
        
        const existingAttempt = await TenantExamAttempt.findOne({ studentId, examId: req.params.id });
        if (existingAttempt) return res.status(400).json({ error: "You have already completed this exam." });

        const exam = await TenantExam.findById(req.params.id);
        if (!exam) return res.status(404).json({ error: "Exam not found." });

        let score = 0;
        const totalQuestions = exam.questions.length;

        exam.questions.forEach(q => {
            const studentAnswer = answers[q._id.toString()];
            if (studentAnswer && studentAnswer === q.correctAnswer) score++;
        });

        const percentage = Math.round((score / totalQuestions) * 100);

        const newAttempt = new TenantExamAttempt({ 
            studentId, 
            studentName, 
            examId: exam._id, 
            examTitle: exam.title, 
            score, 
            totalQuestions, 
            percentage 
        });
        await newAttempt.save();

        // 🚀 PROGRESS LOCK: Mark as submitted
        await TenantExamProgress.findOneAndUpdate(
            { studentId, examId: exam._id },
            { isSubmitted: true }
        );

        if (exam.examType === 'Entrance') {
            const appRecord = await TenantApplication.findOne({ linkedStudentId: studentId });
            if (appRecord) {
                appRecord.entranceScore = percentage;
                appRecord.status = 'Exam Graded';
                await appRecord.save();
            }
        }

        res.json({ success: true, message: "Exam submitted successfully!", results: { score, totalQuestions, percentage } });
    } catch (error) { 
        console.error("Submission Error:", error);
        res.status(500).json({ error: "Failed to grade exam" }); 
    }
});

// 4.5 TEACHER (FORM MASTER): View CBT Performance for their entire class
app.get('/api/v1/teacher/form-class-cbt/:className', verifyToken, async (req, res) => {
    try {
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantExam = req.tenantDb.model('Exam', examSchema);
        const TenantExamAttempt = req.tenantDb.model('ExamAttempt', examAttemptSchema);

        const className = req.params.className;
        const { session, term } = req.query;
        
        const students = await TenantApplication.find({ targetClass: className, status: 'Admitted' });
        const studentIds = students.map(s => s.linkedStudentId ? s.linkedStudentId.toString() : null).filter(id => id);
        
        let examQuery = {};
        
        // 🚀 THE FIX: Match the session, OR include exams that were saved missing a session!
        if (session && session !== 'All') {
            examQuery.session = { $in: [session, null, ""] };
        }
        
        // 🚀 THE FIX: Match the term, OR include exams that were saved missing a term!
        if (term && term !== 'All' && term !== 'All Terms') {
            const cleanTerm = term.replace(/ term/i, '').trim();
            examQuery.term = { $in: [new RegExp('^' + cleanTerm, 'i'), null, ""] };
        }
        
        const matchingExams = await TenantExam.find(examQuery).select('_id');
        const matchingExamIds = matchingExams.map(e => e._id);

        const attempts = await TenantExamAttempt.find({ 
            studentId: { $in: studentIds }, 
            examId: { $in: matchingExamIds } 
        }).populate('examId', 'subject examType session term').sort({ createdAt: -1 }).lean(); 
        
        const enrichedAttempts = attempts.map(att => {
            const student = students.find(s => s.linkedStudentId && s.linkedStudentId.toString() === att.studentId);
            return {
                ...att, 
                targetClass: className,
                studentName: student ? student.studentName : att.studentName,
                subject: att.examId ? att.examId.subject : 'Unknown',
                examType: att.examId ? att.examId.examType : 'Official',
                examTitle: att.examTitle || (att.examId ? att.examId.title : 'Unknown Exam')
            };
        });

        res.json(enrichedAttempts);
    } catch(e) { 
        console.error("Form Class CBT Error:", e);
        res.status(500).json({ error: "Failed to fetch class CBT performance." }); 
    }
});

// 5. PRINCIPAL: Approve/Change Exam Status (Draft -> Published)
app.put('/api/v1/cbt/exams/:id/status', verifyToken, async (req, res) => {
    try {
        // 🚀 THE FIX: Included 'Super Admin' in the authorized roles!
        const authorizedRoles = ['Principal', 'Super Admin'];
        if (!authorizedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: "Access Denied: Only Super Admin/Principal can publish exams." });
        }
        
        const TenantExam = req.tenantDb.model('Exam', examSchema);
        const { status } = req.body;
        
        const exam = await TenantExam.findByIdAndUpdate(req.params.id, { status }, { new: true });
        if (!exam) return res.status(404).json({ error: "Exam not found." });
        
        res.json({ success: true, message: `Exam is now ${status}` });
    } catch (error) { 
        console.error("Publish Error:", error);
        res.status(500).json({ error: "Failed to update exam status" }); 
    }
});

// 5.2 ADMIN: Soft Delete (Archive) an Exam
app.delete('/api/v1/cbt/exams/:id', verifyAdmin, async (req, res) => {
    try {
        const TenantExam = req.tenantDb.model('Exam', examSchema);
        const exam = await TenantExam.findById(req.params.id);
        if(!exam) return res.status(404).json({ error: "Exam not found" });

        exam.status = 'Archived';
        await exam.save();
        res.json({ success: true, message: "Exam archived safely." });
    } catch(e) { res.status(500).json({ error: "Failed to archive exam." }); }
});

// 5.3 ADMIN: Restore an Archived Exam
app.put('/api/v1/cbt/exams/:id/restore', verifyAdmin, async (req, res) => {
    try {
        const TenantExam = req.tenantDb.model('Exam', examSchema);
        const exam = await TenantExam.findById(req.params.id);
        if(!exam) return res.status(404).json({ error: "Exam not found" });

        exam.status = 'Published'; 
        await exam.save();
        res.json({ success: true, message: "Exam restored successfully!" });
    } catch(e) { res.status(500).json({ error: "Failed to restore exam." }); }
});

// 5.4 ADMIN: Permanently Delete Exam
app.delete('/api/v1/cbt/exams/:id/permanent', verifyAdmin, async (req, res) => {
    try {
        const TenantExam = req.tenantDb.model('Exam', examSchema);
        const TenantExamSession = req.tenantDb.model('ExamSession', examSessionSchema);
        const TenantExamAssignment = req.tenantDb.model('ExamAssignment', examAssignmentSchema);

        const exam = await TenantExam.findById(req.params.id);
        if(!exam) return res.status(404).json({ error: "Exam not found" });

        await TenantExam.findByIdAndDelete(req.params.id);
        await TenantExamSession.deleteMany({ examId: req.params.id });
        await TenantExamAssignment.deleteMany({ examId: req.params.id });

        res.json({ success: true, message: "Exam and all related records completely deleted." });
    } catch(e) { res.status(500).json({ error: "Failed to permanently delete exam." }); }
});

// 5.5. ADMIN: Fetch only "Entrance" CBT Sessions
app.get('/api/v1/cbt/sessions/entrance', verifyToken, async (req, res) => {
    try {
        const TenantExam = req.tenantDb.model('Exam', examSchema);
        const TenantExamSession = req.tenantDb.model('ExamSession', examSessionSchema);

        let query = { examType: 'Entrance' };
        if (req.query.class) query.targetClass = req.query.class;

        const entranceExams = await TenantExam.find(query).select('_id title subject targetClass');
        const examIds = entranceExams.map(e => e._id);
        
        // 🚀 THE FIX: Added endTime check so expired batches automatically disappear!
        const sessions = await TenantExamSession.find({ 
            examId: { $in: examIds }, 
            status: { $ne: 'Archived' },
            endTime: { $gt: new Date() } // MUST be in the future
        }).populate('examId', 'title subject targetClass');
        
        res.json(sessions);
    } catch (err) { res.status(500).json({ error: "Failed to fetch entrance sessions." }); }
});

// 6. ADMIN ONLY: Create an Exam Session (Batch)
app.post('/api/v1/cbt/exams/:id/sessions', verifyAdmin, async (req, res) => {
    try {
        const TenantExam = req.tenantDb.model('Exam', examSchema);
        const TenantExamSession = req.tenantDb.model('ExamSession', examSessionSchema);

        const { name, startTime, endTime, venue, maxStudents } = req.body;
        
        const exam = await TenantExam.findById(req.params.id);
        if (!exam) return res.status(404).json({ error: "Exam not found" });

        let pin = null;
        if (exam.examType === 'Official' || exam.examType === 'Entrance') pin = Math.floor(10000 + Math.random() * 90000).toString(); 
        
        const newSession = new TenantExamSession({ examId: req.params.id, name, startTime, endTime, venue: venue || "Main ICT Lab", maxStudents, pin });
        await newSession.save();

        let successMsg = pin ? `Session '${name}' created! PIN: ${pin}` : `Session '${name}' created! No PIN required.`;
        res.json({ success: true, message: successMsg });
    } catch (error) { res.status(500).json({ error: "Failed to create exam session" }); }
});

// 7. ADMIN ONLY: Get all Sessions for an Exam
app.get('/api/v1/cbt/exams/:id/sessions', verifyTeacherOrAdmin, async (req, res) => {
    try {
        const TenantExamSession = req.tenantDb.model('ExamSession', examSessionSchema);
        const sessions = await TenantExamSession.find({ examId: req.params.id }).sort({ startTime: 1 });
        res.json(sessions);
    } catch (error) { res.status(500).json({ error: "Failed to fetch sessions" }); }
});

// 8. ADMIN ONLY: Assign Students to a Session
app.post('/api/v1/cbt/sessions/:sessionId/assign', verifyAdmin, async (req, res) => {
    try {
        req.tenantDb.model('Exam', examSchema); // 🚀 THE FIX: Tell Mongoose what an Exam is!
        const TenantExamSession = req.tenantDb.model('ExamSession', examSessionSchema);
        const TenantExamAssignment = req.tenantDb.model('ExamAssignment', examAssignmentSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);

        const { examId, students } = req.body; 
        const sessionId = req.params.sessionId;

        const session = await TenantExamSession.findById(sessionId).populate('examId');
        if (!session) return res.status(404).json({ error: "Session not found." });

        const isEntrance = session.examId.examType === 'Entrance';
        const currentAssigned = await TenantExamAssignment.countDocuments({ sessionId });
        
        if (currentAssigned + students.length > session.maxStudents) {
            return res.status(400).json({ error: `Cannot assign. This batch only has ${session.maxStudents - currentAssigned} seats left.` });
        }

        const studentIds = students.map(s => s.studentId);
        const apps = await TenantApplication.find({ linkedStudentId: { $in: studentIds } });
        
        for (let app of apps) {
            if (isEntrance && app.status === 'Admitted') return res.status(400).json({ error: `Security Block: Cannot assign an Active Student to an Entrance Exam.` });
            if (!isEntrance && app.status !== 'Admitted') return res.status(400).json({ error: `Security Block: Cannot assign an Applicant to an Official School Exam.` });
        }

        await TenantExamAssignment.deleteMany({ examId: examId, studentId: { $in: studentIds } });

        const assignments = students.map(s => ({ examId, sessionId, studentId: s.studentId, studentName: s.studentName }));
        await TenantExamAssignment.insertMany(assignments);

        if (isEntrance) {
            const dateStr = new Date(session.startTime).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
            const timeStr = new Date(session.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            const timeText = `Online CBT: ${session.name} (${dateStr} @ ${timeStr}) | Venue: ${session.venue || 'Main ICT Lab'}`;

            for (let app of apps) {
                if (app.status === 'Pending Fee' || app.status === 'Applied') app.status = 'Exam Scheduled';
                app.examDate = timeText;
                await app.save();
            }
        }

        // 🚀 AUTOMATED BOT: Notify these specific students of their exact CBT time
        const TenantMessage = req.tenantDb.model('Message', messageSchema);
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
        const settings = await TenantSettings.findOne() || {};
        const dynamicSchoolName = settings.schoolName || 'Automated System';
        
        const dStr = new Date(session.startTime).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        const tStr = new Date(session.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

        const botMessages = students.map(s => ({
            senderId: 'SYSTEM_BOT',
            senderName: dynamicSchoolName,
            senderRole: 'System Bot',
            targetId: s.studentId, // Direct message to the student's ID
            targetName: s.studentName,
            targetRole: isEntrance ? 'Applicant' : 'Student',
            subject: `🖥️ CBT Schedule: ${session.examId.subject}`,
            message: `You have been assigned to a computer batch for your ${session.examId.subject} exam.\n\nBatch Name: ${session.name}\nDate: ${dStr}\nTime: ${tStr}\nVenue: ${session.venue || 'Main ICT Lab'}\n\nPlease be punctual.`,
            isReadByTarget: false,
            isReadBySender: true,
            replies: []
        }));

        if (botMessages.length > 0) await TenantMessage.insertMany(botMessages);

        res.json({ success: true, message: `Successfully assigned ${students.length} students to ${session.name}! Notifications sent.` });
    } catch (error) { res.status(500).json({ error: "Failed to assign students" }); }
});

// 8.5 ADMIN ONLY: Smart Auto-Assign
app.post('/api/v1/cbt/sessions/:sessionId/auto-assign', verifyAdmin, async (req, res) => {
    try {
        req.tenantDb.model('Exam', examSchema); // 🚀 THE FIX: Tell Mongoose what an Exam is!
        const TenantExamSession = req.tenantDb.model('ExamSession', examSessionSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantExamAssignment = req.tenantDb.model('ExamAssignment', examAssignmentSchema);

        const session = await TenantExamSession.findById(req.params.sessionId).populate('examId');
        if (!session) return res.status(404).json({ error: "Session not found." });

        if (new Date() > session.endTime) return res.status(403).json({ error: "Action Denied: Batch closed." });

        const exam = session.examId;
        const isEntrance = exam.examType === 'Entrance';

        let eligibleStudents = [];
        if (isEntrance) {
            eligibleStudents = await TenantApplication.find({ targetClass: exam.targetClass, status: { $in: ['Applied', 'Pending Fee', 'Exam Scheduled'] } });
        } else {
            eligibleStudents = await TenantApplication.find({ targetClass: exam.targetClass, status: 'Admitted' });
        }

        const existingAssignments = await TenantExamAssignment.find({ examId: exam._id });
        const assignedStudentIds = existingAssignments.map(a => a.studentId.toString());

        const unassignedStudents = eligibleStudents.filter(app => {
            return app.linkedStudentId && !assignedStudentIds.includes(app.linkedStudentId.toString());
        });

        const currentBatchCount = await TenantExamAssignment.countDocuments({ sessionId: session._id });
        const seatsAvailable = session.maxStudents - currentBatchCount;

        if (seatsAvailable <= 0) return res.status(400).json({ error: "This batch is already full!" });
        if (unassignedStudents.length === 0) return res.status(400).json({ error: "All eligible students have already been assigned!" });

        const studentsToAssign = unassignedStudents.slice(0, seatsAvailable);

        const assignments = studentsToAssign.map(s => ({ examId: exam._id, sessionId: session._id, studentId: s.linkedStudentId, studentName: s.studentName }));
        await TenantExamAssignment.insertMany(assignments);

        if (isEntrance) {
            const dateStr = new Date(session.startTime).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
            const timeStr = new Date(session.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            const timeText = `Online CBT: ${session.name} (${dateStr} @ ${timeStr}) | Venue: ${session.venue || 'Main ICT Lab'}`;

            for (let s of studentsToAssign) {
                const app = await TenantApplication.findOne({ linkedStudentId: s.linkedStudentId });
                if (app) {
                    if (app.status === 'Pending Fee' || app.status === 'Applied') app.status = 'Exam Scheduled';
                    app.examDate = timeText;
                    await app.save();
                }
            }
        }

        // 🚀 AUTOMATED BOT: Notify the auto-assigned students!
        const TenantMessage = req.tenantDb.model('Message', messageSchema);
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
        const settings = await TenantSettings.findOne() || {};
        const dynamicSchoolName = settings.schoolName || 'Automated System';
        
        const dStr = new Date(session.startTime).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        const tStr = new Date(session.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

        const botMessages = studentsToAssign.map(s => ({
            senderId: 'SYSTEM_BOT',
            senderName: dynamicSchoolName,
            senderRole: 'System Bot',
            targetId: s.linkedStudentId.toString(), 
            targetName: s.studentName,
            targetRole: isEntrance ? 'Applicant' : 'Student',
            subject: `🖥️ CBT Schedule: ${exam.subject}`,
            message: `You have been assigned to a computer batch for your ${exam.subject} exam.\n\nBatch Name: ${session.name}\nDate: ${dStr}\nTime: ${tStr}\nVenue: ${session.venue || 'Main ICT Lab'}\n\nPlease be punctual.`,
            isReadByTarget: false,
            isReadBySender: true,
            replies: []
        }));

        if (botMessages.length > 0) await TenantMessage.insertMany(botMessages);

        res.json({ success: true, message: `Successfully auto-assigned ${studentsToAssign.length} students! Notifications sent.`, unassignedLeft: unassignedStudents.length - studentsToAssign.length });
    } catch (error) { res.status(500).json({ error: "Failed to auto-assign students." }); }
});

// 8.6 ADMIN ONLY: Empty a Batch 
app.post('/api/v1/cbt/sessions/:sessionId/empty', verifyAdmin, async (req, res) => {
    try {
        req.tenantDb.model('Exam', examSchema); // 🚀 THE FIX: Tell Mongoose what an Exam is!
        const TenantExamSession = req.tenantDb.model('ExamSession', examSessionSchema);
        const TenantExamAssignment = req.tenantDb.model('ExamAssignment', examAssignmentSchema);
        const TenantExamAttempt = req.tenantDb.model('ExamAttempt', examAttemptSchema);
        const TenantExamProgress = req.tenantDb.model('ExamProgress', examProgressSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);

        const session = await TenantExamSession.findById(req.params.sessionId).populate('examId');
        if (!session) return res.status(404).json({ error: "Session not found." });

        if (new Date() > session.endTime) return res.status(403).json({ error: "Action Denied: You cannot empty a batch that has already closed." });

        const assignments = await TenantExamAssignment.find({ sessionId: session._id });
        if (assignments.length === 0) return res.status(400).json({ error: "This batch is already empty!" });

        const studentIds = assignments.map(a => a.studentId);
        const attemptsCount = await TenantExamAttempt.countDocuments({ examId: session.examId._id, studentId: { $in: studentIds } });
        const progressCount = await TenantExamProgress.countDocuments({ examId: session.examId._id, studentId: { $in: studentIds } });

        if (attemptsCount > 0 || progressCount > 0) return res.status(403).json({ error: "Action Denied: Students in this batch have already started or submitted their exams." });

        await TenantExamAssignment.deleteMany({ sessionId: session._id });

        if (session.examId.examType === 'Entrance') {
            const apps = await TenantApplication.find({ linkedStudentId: { $in: studentIds } });
            for (let app of apps) {
                if (app.status === 'Exam Scheduled') app.status = 'Applied';
                app.examDate = null;
                await app.save();
            }
        }
        res.json({ success: true, message: `Success! ${assignments.length} students removed.` });
    } catch (error) { res.status(500).json({ error: "Failed to empty the batch." }); }
});

// 8.7 ADMIN ONLY: Transfer/Reschedule a Student 
app.post('/api/v1/cbt/sessions/transfer-student', verifyAdmin, async (req, res) => {
    try {
        req.tenantDb.model('Exam', examSchema); // 🚀 THE FIX: Tell Mongoose what an Exam is!
        const TenantExamSession = req.tenantDb.model('ExamSession', examSessionSchema);
        const TenantExamAssignment = req.tenantDb.model('ExamAssignment', examAssignmentSchema);
        const TenantExamProgress = req.tenantDb.model('ExamProgress', examProgressSchema);
        const TenantExamAttempt = req.tenantDb.model('ExamAttempt', examAttemptSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);

        const { studentId, examId, newSessionId, resetProgress } = req.body;
        const newSession = await TenantExamSession.findById(newSessionId).populate('examId');
        if (!newSession) return res.status(404).json({ error: "New session not found." });

        const currentCount = await TenantExamAssignment.countDocuments({ sessionId: newSessionId });
        if (currentCount >= newSession.maxStudents) return res.status(400).json({ error: "The selected batch is already at maximum capacity." });

        await TenantExamAssignment.findOneAndUpdate({ studentId, examId }, { sessionId: newSessionId });

        if (resetProgress) {
            await TenantExamProgress.findOneAndDelete({ studentId, examId });
            await TenantExamAttempt.findOneAndDelete({ studentId, examId });
        }

        if (newSession.examId.examType === 'Entrance') {
            const app = await TenantApplication.findOne({ linkedStudentId: studentId });
            if (app) {
                const dateStr = new Date(newSession.startTime).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
                const timeStr = new Date(newSession.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                app.examDate = `Online CBT: ${newSession.name} (${dateStr} @ ${timeStr}) | Venue: ${newSession.venue || 'Main ICT Lab'}`;
                app.status = 'Exam Scheduled';
                await app.save();
            }
        }
        res.json({ success: true, message: `Student successfully transferred to ${newSession.name}!` });
    } catch (error) { res.status(500).json({ error: "Failed to transfer student." }); }
});

// 9. ADMIN ONLY: Update a Session (Edit)
app.put('/api/v1/cbt/sessions/:id', verifyAdmin, async (req, res) => {
    try {
        const TenantExamSession = req.tenantDb.model('ExamSession', examSessionSchema);
        const TenantExamAssignment = req.tenantDb.model('ExamAssignment', examAssignmentSchema);
        const TenantExamAttempt = req.tenantDb.model('ExamAttempt', examAttemptSchema);
        const TenantExamProgress = req.tenantDb.model('ExamProgress', examProgressSchema);

        const session = await TenantExamSession.findById(req.params.id);
        if (!session) return res.status(404).json({ error: "Session not found." });

        if (new Date() > session.endTime) return res.status(403).json({ error: "Action Denied: You cannot edit a batch that has already closed." });

        const assignments = await TenantExamAssignment.find({ sessionId: session._id });
        const studentIds = assignments.map(a => a.studentId);
        const attemptsCount = await TenantExamAttempt.countDocuments({ examId: session.examId, studentId: { $in: studentIds } });
        const progressCount = await TenantExamProgress.countDocuments({ examId: session.examId, studentId: { $in: studentIds } });

        if (attemptsCount > 0 || progressCount > 0) return res.status(403).json({ error: "Action Denied: Students have already started this exam. Editing is blocked." });

        const { name, startTime, endTime, venue, maxStudents } = req.body;
        await TenantExamSession.findByIdAndUpdate(req.params.id, { name, startTime, endTime, venue, maxStudents });

        res.json({ success: true, message: "Batch session updated successfully!" });
    } catch (error) { res.status(500).json({ error: "Failed to update session" }); }
});

// 10. ADMIN ONLY: Soft Delete a Session (Archive)
app.delete('/api/v1/cbt/sessions/:id', verifyAdmin, async (req, res) => {
    try {
        const TenantExamSession = req.tenantDb.model('ExamSession', examSessionSchema);
        const session = await TenantExamSession.findById(req.params.id);
        if (!session) return res.status(404).json({ error: "Session not found" });
        session.status = 'Archived';
        await session.save();
        res.json({ success: true, message: "Batch session archived safely." });
    } catch (error) { res.status(500).json({ error: "Failed to archive session" }); }
});

// 10.5 ADMIN ONLY: Restore an Archived Session
app.put('/api/v1/cbt/sessions/:id/restore', verifyAdmin, async (req, res) => {
    try {
        const TenantExamSession = req.tenantDb.model('ExamSession', examSessionSchema);
        const session = await TenantExamSession.findById(req.params.id);
        if (!session) return res.status(404).json({ error: "Session not found" });
        session.status = 'Active';
        await session.save();
        res.json({ success: true, message: "Batch session restored successfully." });
    } catch (error) { res.status(500).json({ error: "Failed to restore session" }); }
});

// 11. STUDENT PORTAL: Fetch ALL ASSIGNED exams (Batched Official & Open Homework)
app.get('/api/v1/cbt/student/:studentId/assigned-exams', verifyToken, async (req, res) => {
    try {
        // Register models for the Tenant DB
        req.tenantDb.model('Exam', examSchema);
        req.tenantDb.model('ExamSession', examSessionSchema);
        const TenantExamAssignment = req.tenantDb.model('ExamAssignment', examAssignmentSchema);
        const TenantExamAttempt = req.tenantDb.model('ExamAttempt', examAttemptSchema);
        const TenantExam = req.tenantDb.model('Exam', examSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);

        const studentId = req.params.studentId;
        const studentProfile = await TenantApplication.findOne({ linkedStudentId: studentId });
        if (!studentProfile) return res.status(404).json({ error: "Student profile not found." });

        // 1. Get Official Exams (Assigned via Batches)
        const assignments = await TenantExamAssignment.find({ studentId }).populate('examId').populate('sessionId');
        
        // 2. Get Open Access Exams (Mocks & Homeworks for this class)
        const openExams = await TenantExam.find({ 
            targetClass: studentProfile.targetClass, 
            examType: { $in: ['Mock', 'Homework'] },
            status: 'Published'
        });

        const attempts = await TenantExamAttempt.find({ studentId });
        const finalExams = [];

        // Process Batched Exams
        assignments.forEach(a => {
            if (a.examId && a.examId.status === 'Published' && a.sessionId && a.examId.examType !== 'Entrance') {
                const pastAttempt = attempts.find(att => att.examId.toString() === a.examId._id.toString());
                finalExams.push({
                    _id: a.examId._id, title: a.examId.title, subject: a.examId.subject,
                    examType: a.examId.examType, durationMinutes: a.examId.durationMinutes,
                    questionCount: a.examId.questions.length, batchName: a.sessionId.name,
                    startTime: a.sessionId.startTime, endTime: a.sessionId.endTime,
                    venue: a.sessionId.venue, session: a.examId.session, term: a.examId.term,
                    isCompleted: !!pastAttempt, percentage: pastAttempt ? pastAttempt.percentage : null
                });
            }
        });

        // Process Open Access Exams
        openExams.forEach(mock => {
            // Prevent duplicates if a teacher accidentally batched a mock
            if (!finalExams.find(e => e._id.toString() === mock._id.toString())) {
                const pastAttempt = attempts.find(att => att.examId.toString() === mock._id.toString());
                
                // 🚀 THE FIX: Calculate expiry strictly from the creation date, NEVER from Date.now()!
                const createdDate = new Date(mock.startTime || mock.createdAt);
                const daysToLive = mock.validityDays || 14; 
                const lockedExpiryDate = mock.endTime || new Date(createdDate.getTime() + (1000 * 60 * 60 * 24 * daysToLive));
                
                finalExams.push({
                    _id: mock._id, title: mock.title, subject: mock.subject,
                    examType: mock.examType, durationMinutes: mock.durationMinutes,
                    questionCount: mock.questions.length, batchName: "Open Access",
                    startTime: createdDate, 
                    endTime: lockedExpiryDate, 
                    venue: "Virtual", session: mock.session, term: mock.term,
                    isCompleted: !!pastAttempt, percentage: pastAttempt ? pastAttempt.percentage : null
                });
            }
        });

        res.json(finalExams);
    } catch (error) { 
        console.error("Student Exams Error:", error);
        res.status(500).json({ error: "Failed to fetch assigned exams" }); 
    }
});

// 12. STUDENT: Get or Initialize Exam Progress 
app.get('/api/v1/cbt/progress/:studentId/:examId', optionalVerifyToken, async (req, res) => {
    try {
        const TenantExamProgress = req.tenantDb.model('ExamProgress', examProgressSchema);
        let progress = await TenantExamProgress.findOne({ studentId: req.params.studentId, examId: req.params.examId });
        
        if (!progress) {
            progress = new TenantExamProgress({ studentId: req.params.studentId, examId: req.params.examId, absoluteStartTime: Date.null(), answers: {} });
            await progress.save();
        }
        res.json(progress);
    } catch (error) { res.status(500).json({ error: "Failed to fetch progress" }); }
});

app.post('/api/v1/cbt/exams/:id/start', optionalVerifyToken, async (req, res) => {
    try {
        const TenantExamProgress = req.tenantDb.model('ExamProgress', examProgressSchema);
        const { studentId } = req.body;
        
        let progress = await TenantExamProgress.findOne({ studentId, examId: req.params.id });
        
        // If not started yet, set the official start time
        if (progress && !progress.absoluteStartTime) {
            progress.absoluteStartTime = Date.now();
            await progress.save();
        }
        
        res.json(progress);
    } catch (error) { res.status(500).json({ error: "Failed to start exam timer" }); }
});

// 13. STUDENT: Auto-Save Answers 
app.put('/api/v1/cbt/progress/:studentId/:examId', verifyToken, async (req, res) => {
    try {
        const TenantExamProgress = req.tenantDb.model('ExamProgress', examProgressSchema);
        const { answers } = req.body;
        await TenantExamProgress.findOneAndUpdate({ studentId: req.params.studentId, examId: req.params.examId }, { answers: answers }, { upsert: true });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Failed to auto-save" }); }
});

// 14. KIOSK: Login and Fetch Exam
app.post('/api/v1/cbt/kiosk/login', async (req, res) => {
    try {
        req.tenantDb.model('Exam', examSchema);
        const TenantExamSession = req.tenantDb.model('ExamSession', examSessionSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantExamAssignment = req.tenantDb.model('ExamAssignment', examAssignmentSchema);
        const TenantExamAttempt = req.tenantDb.model('ExamAttempt', examAttemptSchema); // Schema for checking history

        const { systemId, pin } = req.body;
        const session = await TenantExamSession.findOne({ pin }).populate('examId');
        if (!session || !session.examId) return res.status(404).json({ error: "Invalid Exam PIN or Exam data missing." });
        
        if (session.examId.examType !== 'Official' && session.examId.examType !== 'Entrance') {
            return res.status(403).json({ error: "This Kiosk is strictly for Official or Entrance Exams." });
        }

        const studentApp = await TenantApplication.findOne({ systemId: systemId.toUpperCase().trim() });
        if (!studentApp) return res.status(404).json({ error: "Invalid ID. Check your spelling." });

        if (session.examId.examType === 'Entrance' && studentApp.status === 'Admitted') {
            return res.status(403).json({ error: "Access Denied: Admitted students cannot take Entrance Exams." });
        }
        if (session.examId.examType === 'Official' && studentApp.status !== 'Admitted') {
            return res.status(403).json({ error: "Access Denied: Only officially admitted students can take this exam." });
        }

        const now = new Date();
        if (now < new Date(session.startTime)) return res.status(400).json({ error: "This exam session has not started yet." });
        if (now > new Date(session.endTime)) return res.status(400).json({ error: "This exam session has closed." });

        // 🚀 Identification
        const searchId = studentApp.linkedStudentId || studentApp._id.toString();
        const assignment = await TenantExamAssignment.findOne({ sessionId: session._id, studentId: searchId });
        
        if (!assignment) return res.status(403).json({ error: "You are not assigned to this computer batch." });

        // 🛑 NEW: Re-entry Block
        const existingAttempt = await TenantExamAttempt.findOne({
            studentId: searchId,
            examId: session.examId._id
        });
        if (existingAttempt) {
            return res.status(403).json({
                error: "You have already completed this exam."
            });
        }

        const secureExam = {
            _id: session.examId._id, title: session.examId.title, subject: session.examId.subject,
            durationMinutes: session.examId.durationMinutes,
            instructions: session.examId.instructions || "No special instructions provided.",
            questions: session.examId.questions.map(q => ({ _id: q._id, questionText: q.questionText, options: q.options }))
        };

        res.json({ success: true, student: { linkedStudentId: searchId, studentName: studentApp.studentName }, exam: secureExam });
    } catch (error) { 
        console.error("Kiosk Error:", error);
        res.status(500).json({ error: "Server error: " + error.message }); 
    }
});

// 🚀 NEW: Results Check Route (To block re-entry for completed exams)
app.get('/api/v1/cbt/exams/:id/results-check/:studentId', async (req, res) => {
    try {
        const TenantExamAttempt = req.tenantDb.model('ExamAttempt', examAttemptSchema);
        const existingAttempt = await TenantExamAttempt.findOne({ 
            studentId: req.params.studentId, 
            examId: req.params.id 
        });

        if (existingAttempt) {
            return res.status(403).json({ error: "You have already completed this exam." });
        }
        
        res.json({ alreadyCompleted: false });
    } catch (err) {
        res.status(500).json({ error: "Check failed" });
    }
});

// ==========================================
// CBT QUESTION BANK API
// ==========================================

// 15. TEACHER/ADMIN: Add questions to the Central Bank 
app.post('/api/v1/cbt/question-bank', verifyToken, async (req, res) => {
    try {
        const TenantQuestionBank = req.tenantDb.model('QuestionBank', questionBankSchema);
        const { subject, targetClass, vaultType, questions } = req.body; 
        
        const bankQuestions = questions.map(q => ({
            subject, targetClass, questionText: q.questionText, options: q.options,
            correctAnswer: q.correctAnswer, addedBy: req.user.name || "Teacher",
            vaultType: vaultType || 'Regular'
        }));

        await TenantQuestionBank.insertMany(bankQuestions);
        res.json({ success: true, message: `Successfully added ${questions.length} questions to the bank!` });
    } catch (error) { res.status(500).json({ error: "Failed to save to Question Bank" }); }
});

// 16. TEACHER/ADMIN: Fetch available questions 
app.get('/api/v1/cbt/question-bank/:targetClass/:subject', verifyToken, async (req, res) => {
    try {
        const TenantQuestionBank = req.tenantDb.model('QuestionBank', questionBankSchema);
        const questions = await TenantQuestionBank.find({ targetClass: req.params.targetClass, subject: req.params.subject }).sort({ createdAt: -1 });
        res.json(questions);
    } catch (error) { res.status(500).json({ error: "Failed to fetch Question Bank" }); }
});

// 17. TEACHER: Get Quick Stats for the Question Bank
app.get('/api/v1/cbt/question-bank/stats/:targetClass/:subject', verifyAdmin, async (req, res) => {
    try {
        const TenantQuestionBank = req.tenantDb.model('QuestionBank', questionBankSchema);
        const count = await TenantQuestionBank.countDocuments({ targetClass: req.params.targetClass, subject: req.params.subject });
        res.json({ count });
    } catch (error) { res.status(500).json({ error: "Failed to fetch stats" }); }
});

// 17.5 ADMIN: Clear Vault Questions 
app.delete('/api/v1/cbt/question-bank/:targetClass/:subject/:vaultType', verifyAdmin, async (req, res) => {
    try {
        const TenantQuestionBank = req.tenantDb.model('QuestionBank', questionBankSchema);
        const { targetClass, subject, vaultType } = req.params;
        await TenantQuestionBank.deleteMany({ targetClass, subject, vaultType });
        res.json({ success: true, message: `Successfully cleared the ${vaultType} vault.` });
    } catch (error) { res.status(500).json({ error: "Failed to clear vault." }); }
});

// ==========================================
// CBT RESULTS & GRADING BRIDGE API
// ==========================================

// 18. ADMIN: Fetch Results Broadsheet 
app.get('/api/v1/cbt/sessions/:id/results', verifyToken, async (req, res) => {
    try {
        const TenantExamSession = req.tenantDb.model('ExamSession', examSessionSchema);
        const TenantExam = req.tenantDb.model('Exam', examSchema);
        const TenantExamAssignment = req.tenantDb.model('ExamAssignment', examAssignmentSchema);
        const TenantExamAttempt = req.tenantDb.model('ExamAttempt', examAttemptSchema);
        const TenantExamProgress = req.tenantDb.model('ExamProgress', examProgressSchema);

        const session = await TenantExamSession.findById(req.params.id).lean();
        if(!session) return res.status(404).json({error: "Session not found"});

        const exam = await TenantExam.findById(session.examId).lean();
        if(!exam) return res.status(404).json({error: "Parent Exam not found"});

        const assignments = await TenantExamAssignment.find({ sessionId: session._id }).lean();
        const attempts = await TenantExamAttempt.find({ examId: exam._id }).lean();
        const progressDocs = await TenantExamProgress.find({ examId: exam._id }).lean();

        session.assignedStudents = assignments.map(a => {
            const attempt = attempts.find(att => att.studentId.toString() === a.studentId.toString());
            if (attempt) return { studentId: a.studentId, studentName: a.studentName, status: 'Completed', score: attempt.score, percentage: attempt.percentage };
            const inProgress = progressDocs.find(p => p.studentId.toString() === a.studentId.toString());
            if (inProgress) return { studentId: a.studentId, studentName: a.studentName, status: 'In Progress', score: 0, percentage: 0 };
            return { studentId: a.studentId, studentName: a.studentName, status: 'Pending', score: 0, percentage: 0 };
        });

        res.json({ session, exam });
    } catch(e) { res.status(500).json({error: "Failed to fetch results from database"}); }
});

// 🚀 NEW: Fetch results for Open Access Exams (Mocks/Homework) without a Batch
app.get('/api/v1/cbt/exams/:id/open-results', verifyToken, async (req, res) => {
    try {
        const TenantExamAttempt = req.tenantDb.model('ExamAttempt', examAttemptSchema);
        const TenantExam = req.tenantDb.model('Exam', examSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);

        const exam = await TenantExam.findById(req.params.id).lean();
        if (!exam) return res.status(404).json({ error: "Exam not found" });

        // Fetch all attempts for this specific exam
        const attempts = await TenantExamAttempt.find({ examId: req.params.id }).sort({ score: -1 }).lean();
        
        // Match them with the student's current class
        const studentIds = attempts.map(a => a.studentId);
        const apps = await TenantApplication.find({ linkedStudentId: { $in: studentIds } }).lean();

        const enrichedAttempts = attempts.map(att => {
            const app = apps.find(a => a.linkedStudentId && a.linkedStudentId.toString() === att.studentId.toString());
            return {
                ...att,
                targetClass: app ? app.targetClass : 'Unknown'
            };
        });

        res.json({ exam, attempts: enrichedAttempts });
    } catch (error) {
        console.error("Open Results Error:", error);
        res.status(500).json({ error: "Failed to fetch open exam results." });
    }
});

// 19. ADMIN: The Magic "Push" Button (Scales CBT score and pushes to Report Cards)
app.post('/api/v1/cbt/sessions/:id/push-scores', verifyToken, async (req, res) => {
    try {
        const TenantExamSession = req.tenantDb.model('ExamSession', examSessionSchema);
        const TenantExam = req.tenantDb.model('Exam', examSchema);
        const TenantExamAssignment = req.tenantDb.model('ExamAssignment', examAssignmentSchema);
        const TenantExamAttempt = req.tenantDb.model('ExamAttempt', examAttemptSchema);
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
        const TenantResult = req.tenantDb.models.Result || req.tenantDb.model('Result', resultSchema);

        const { targetStage } = req.body; 
        
        const session = await TenantExamSession.findById(req.params.id);
        if(!session || !session.examId) return res.status(404).json({error: "Data missing"});

        const exam = await TenantExam.findById(session.examId);
        if(!exam) return res.status(404).json({error: "Parent Exam not found"});

        if (exam.examType !== 'Official') {
            return res.status(403).json({error: "Security Alert: Only 'Official' exams can be pushed to the Report Cards."});
        }

        const assignments = await TenantExamAssignment.find({ sessionId: session._id });
        const attempts = await TenantExamAttempt.find({ examId: exam._id });
        const settings = await TenantSettings.findOne() || {};
        const gFormat = settings.gradingFormat || '40-60';
        
        const safeSession = exam.session || settings.activeSession || '2025/2026';
        const safeTerm = exam.term || settings.activeTerm || 'First';
        
        let maxAllowed = 0;
        if (targetStage === 'EXAM') maxAllowed = (gFormat === '30-70') ? 70 : 60;
        else maxAllowed = (gFormat === '30-70') ? 15 : 20;

        const totalCbtQuestions = exam.questions.length;
        if(totalCbtQuestions === 0) return res.status(400).json({error: "Exam has no questions to grade."});

        let pushCount = 0;

        for (let assignment of assignments) {
            const attempt = attempts.find(a => a.studentId.toString() === assignment.studentId.toString());
            
            if (attempt) { 
                let termResult = await TenantResult.findOne({ 
                    studentId: assignment.studentId, 
                    session: safeSession, 
                    term: safeTerm 
                });

                // 🚀 THE SECURITY LOCK: Block pushing if the report card is already published!
                if (termResult && termResult.publishStage === 'Full') {
                    return res.status(403).json({ error: `Action Denied: Scores cannot be pushed because the Final Report Cards for this term have already been published. Please revert them to 'Draft' in the Release Results menu first.` });
                }

                let rawScore = attempt.score || 0;
                let scaledScore = Math.round((rawScore / totalCbtQuestions) * maxAllowed);

                if (!termResult) {
                    termResult = new TenantResult({
                        studentId: assignment.studentId, session: safeSession, 
                        term: safeTerm, type: "Regular", records: []
                    });
                }

                let subjectRecord = termResult.records.find(r => r.subject === exam.subject);
                if (!subjectRecord) {
                    subjectRecord = { subject: exam.subject, ca1: null, ca2: null, exam: null, score: 0 };
                    termResult.records.push(subjectRecord);
                }

                if (targetStage === 'CA1') subjectRecord.ca1 = scaledScore;
                if (targetStage === 'CA2') subjectRecord.ca2 = scaledScore;
                if (targetStage === 'EXAM') subjectRecord.exam = scaledScore;

                subjectRecord.score = (subjectRecord.ca1 || 0) + (subjectRecord.ca2 || 0) + (subjectRecord.exam || 0);

                await termResult.save();
                pushCount++;
            }
        }

        res.json({ success: true, message: `Success! Pushed and scaled ${pushCount} scores to the ${targetStage} column!` });
    } catch(e) { 
        console.error("Score Push Error:", e);
        res.status(500).json({error: "Server error pushing scores"}); 
    }
});

// ==========================================
// 3. CORE ROUTES, LOGIN & CACHE ENGINE
// ==========================================

// 🚀 ENTERPRISE RAM CACHE
const SystemCache = {
    settings: { data: null, expiry: 0 },
    structure: { data: null, expiry: 0 },
    ttl: 10 * 60 * 1000, 

    getSettings: async function() {
        if (this.settings.data && Date.now() < this.settings.expiry) return this.settings.data;
        const data = await mongoose.model('Settings').findOne() || new (mongoose.model('Settings'))();
        this.settings.data = data; this.settings.expiry = Date.now() + this.ttl;
        return data;
    },
    getStructure: async function() {
        if (this.structure.data && Date.now() < this.structure.expiry) return this.structure.data;
        const data = await mongoose.model('Structure').findOne() || new (mongoose.model('Structure'))();
        this.structure.data = data; this.structure.expiry = Date.now() + this.ttl;
        return data;
    },
    clearSettings: function() { this.settings.data = null; this.settings.expiry = 0; },
    clearStructure: function() { this.structure.data = null; this.structure.expiry = 0; }
};

app.get('/api/v1/settings', async (req, res) => {
    try {
        // 🚀 SAAS FIX: Use the specific tenant database!
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
        const TenantSubscription = req.tenantDb.model('Subscription', subscriptionSchema);

        let settings = await TenantSettings.findOne();
        if (!settings) { settings = new TenantSettings(); await settings.save(); }

        let sub = await TenantSubscription.findOne();
        if (!sub) { sub = new TenantSubscription(); await sub.save(); }

        // Default to Premium (Everything Unlocked)
        let autoFeatures = {
            cbt: true, cbtBank: true, schoolStore: true, financialAudit: true, 
            gpsAttendance: true, auditLogs: true, idGeneration: true, 
            timetable: true, debtorSms: true, broadsheets: true, 
            elearning: true, staffAttendance: true, autoEmails: true, lessonNotes: true,
            parentMultiStudent: true, parentHistory: true, parentDownloads: true, 
            parentLedger: true, parentCbtScores: true,
            gateSecurity: true, fullMessaging: true // 🚀 NEW
        };

        // 🟡 ADVANCE (Standard) PLAN
        if (sub.planTier === 'Standard') {
            autoFeatures.schoolStore = false; 
            autoFeatures.financialAudit = false; 
            autoFeatures.auditLogs = false; 
            autoFeatures.parentLedger = true; 
            autoFeatures.parentCbtScores = false; 
            autoFeatures.cbtBank = true;
            autoFeatures.gpsAttendance = true;
            autoFeatures.staffAttendance = true;
        }

        // 🟢 FOUNDATION (Basic) PLAN
        else if (sub.planTier === 'Basic') {
            autoFeatures.cbt = false; autoFeatures.cbtBank = false;
            autoFeatures.staffAttendance = false;
            autoFeatures.schoolStore = false; autoFeatures.financialAudit = false; 
            autoFeatures.gpsAttendance = false; autoFeatures.auditLogs = false; 
            autoFeatures.timetable = false; autoFeatures.debtorSms = false;
            autoFeatures.broadsheets = false; autoFeatures.elearning = false;
            autoFeatures.autoEmails = false; autoFeatures.lessonNotes = false;
            autoFeatures.parentMultiStudent = true; autoFeatures.parentHistory = false; 
            autoFeatures.parentDownloads = false; autoFeatures.parentLedger = false; 
            autoFeatures.parentCbtScores = false; 
            autoFeatures.gateSecurity = false; autoFeatures.fullMessaging = false; // 🚀 LOCKED FOR BASIC
        }

        const combinedSettings = {
            ...settings.toObject(),
            planTier: sub.planTier,
            accountStatus: sub.accountStatus,
            enabledFeatures: autoFeatures
        };

        delete combinedSettings.smtpPass;
        delete combinedSettings.paystackSecretKey;
        res.json(combinedSettings);
    } catch(err) { res.status(500).json({ error: "Failed to fetch settings" }); }
});

// ==========================================
// 🏫 SCHOOL STRUCTURE ROUTES (SAAS UPDATED)
// ==========================================

app.get('/api/v1/structure', async (req, res) => {
    try {
        // 🚀 SAAS FIX: Bind to the specific school's database!
        const TenantStructure = req.tenantDb.model('Structure', structureSchema);
        
        let struct = await TenantStructure.findOne();
        
        // If a brand new school doesn't have a structure yet, send the default blueprint
        if (!struct) { 
            struct = new TenantStructure(); 
            await struct.save(); 
        }
        res.json(struct);
    } catch(err) { 
        console.error("Structure Fetch Error:", err);
        res.status(500).json({ error: "Failed to fetch school structure" }); 
    }
});

app.put('/api/v1/structure', verifyAdmin, async (req, res) => {
    try {
        // 🚀 SAAS FIX: Bind to the specific school's database!
        const TenantStructure = req.tenantDb.model('Structure', structureSchema);

        let struct = await TenantStructure.findOne();
        if (!struct) struct = new TenantStructure();
        
        if (req.body.levels) struct.levels = req.body.levels;
        if (req.body.arms) struct.arms = req.body.arms;
        if (req.body.streams) struct.streams = req.body.streams;
        if (req.body.subjects) struct.subjects = req.body.subjects; 
        if (req.body.classrooms) struct.classrooms = req.body.classrooms;
        
        await struct.save();
        
        // Log the action securely
        logSystemAction(req, 'ADMINISTRATION', `Updated the global school structure configuration.`);
        
        res.json({ success: true, message: "School Structure Updated successfully!" });
    } catch(err) { 
        console.error("Structure Update Error:", err);
        res.status(500).json({ error: "Failed to update school structure" }); 
    }
});

app.post('/api/v1/applications/verify-resume', async (req, res) => {
    try {
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const { email } = req.body;
        
        // 🚀 THE FIX: Find any application that is 'Applied' but missing the photo
        const existingIncomplete = await TenantApplication.findOne({
            parentEmail: email.toLowerCase().trim(),
            status: 'Applied',
            $or: [
                { passportPhoto: null },
                { passportPhoto: "" },
                { passportPhoto: { $exists: false } }
            ]
        });

        if (existingIncomplete) {
            // Return EXACTLY what the frontend expects to resume!
            return res.json({
                exists: true,
                phone: existingIncomplete.parentPhone || "",
                message: "Payment record found! Please complete your bio-data."
            });
        }

        return res.json({ exists: false });
    } catch (error) { 
        console.error("Verify Resume Error:", error);
        res.status(500).json({ error: "System error checking email." }); 
    }
});

// 2. Staff GPS Attendance
app.get('/api/v1/admin/staff-attendance', verifyAdmin, async (req, res) => {
    try {
        // 🚀 SAAS FIX: Dive into the specific school's database!
        const TenantStaffAttendance = req.tenantDb.model('StaffAttendance', staffAttendanceSchema);
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) return res.status(400).json({ error: "Dates required" });

        // Fetch all records
        const allRecords = await TenantStaffAttendance.find();

        // Establish the precise start and end boundaries
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        // 🛡️ DYNAMIC DATE FILTER: Ensure we capture the UK formatted dates (DD/MM/YYYY) correctly
        const filteredRecords = allRecords.filter(r => {
            if (!r.date) return false;
            const parts = r.date.split('/');
            if (parts.length !== 3) return false;
            // Rebuild into standard ISO so JavaScript can accurately compare the dates
            const logDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00Z`);
            return logDate >= start && logDate <= end;
        });

        res.json(filteredRecords);
    } catch (error) {
        console.error("Staff Attendance Fetch Error:", error);
        res.status(500).json({ error: "Failed to fetch staff attendance." });
    }
});

app.get('/api/v1/attendance-range', verifyTeacherOrAdmin, async (req, res) => {
    try { 
        const TenantAttendance = req.tenantDb.model('Attendance', attendanceSchema);
        const { className, startDate, endDate } = req.query;
        const records = await TenantAttendance.find({ 
            className, 
            date: { $gte: startDate, $lte: endDate } 
        }).lean();

        const uniqueMap = new Map();
        records.forEach(r => uniqueMap.set(`${r.studentId}_${r.date}`, r));
        res.json(Array.from(uniqueMap.values())); 
    } catch (error) { 
        res.status(500).json({ error: "Failed to fetch attendance matrix." }); 
    }
});

app.get('/api/v1/admin/lesson-notes', verifyAdmin, async (req, res) => {
    try { 
        // 🚀 SAAS FIX
        const TenantLessonNote = req.tenantDb.model('LessonNote', lessonNoteSchema);
        const notes = await TenantLessonNote.find().sort({ createdAt: -1 }); 
        res.json(notes); 
    } 
    catch(err) { res.status(500).json({error: "Failed to fetch notes."}); }
});

// APPROVE / QUERY LESSON NOTES
app.put('/api/v1/admin/lesson-notes/:id/status', verifyToken, async (req, res) => {
    try { 
        const TenantLessonNote = req.tenantDb.model('LessonNote', lessonNoteSchema);
        const TenantUser = req.tenantDb.model('User', userSchema);
        const status = req.body.status;
        
        // Update the note and get the new document back
        const updatedNote = await TenantLessonNote.findByIdAndUpdate(
            req.params.id, 
            { status: status }, 
            { new: true }
        ); 
        
        // 🤖 SYSTEM BOT (Instant Write - 0.01s Execution Time)
        if (updatedNote && (status === 'Approved' || status === 'Query')) {
            const teacherUser = await TenantUser.findOne({ fullName: updatedNote.teacherName, accountStatus: 'Active' });
            if (teacherUser) {
                const botMsg = status === 'Approved' 
                    ? `Academic Update: Your lesson note for ${updatedNote.subject} (${updatedNote.week}) has been officially Approved by the Principal.`
                    : `Action Required: Your lesson note for ${updatedNote.subject} (${updatedNote.week}) has been Queried. Please review the document and resubmit.`;
                const botSubj = status === 'Approved' ? '✅ Lesson Note Approved' : '⚠️ Lesson Note Queried';

                await sendSystemMessage(req.tenantDb, teacherUser._id.toString(), teacherUser.fullName, teacherUser.role, botSubj, botMsg);
            }
        }

        res.json({ success: true, message: "Status updated successfully." }); 
    } 
    catch(err) { 
        console.error("Lesson Note Update Error:", err);
        res.status(500).json({error: "Failed to update status."}); 
    }
});

app.post('/api/v1/lesson-notes', verifyToken, async (req, res) => {
    try {
        const TenantLessonNote = req.tenantDb.model('LessonNote', lessonNoteSchema);
        const newNote = new TenantLessonNote({ teacherName: req.user.name, targetClass: req.body.targetClass, subject: req.body.subject, week: req.body.week, topic: req.body.topic, contentLink: req.body.contentLink });
        await newNote.save(); 
        res.status(201).json({ success: true, message: "Lesson note submitted to Principal for approval!" });
    } catch (error) { res.status(500).json({ error: "Failed to submit lesson note." }); }
});

app.post('/api/v1/teacher/clock-in', verifyToken, async (req, res) => {
    try {
        // 🚀 SAAS FIX
        const TenantStaffAttendance = req.tenantDb.model('StaffAttendance', staffAttendanceSchema);
        
        const today = new Date().toLocaleDateString('en-GB'); 
        const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const existing = await TenantStaffAttendance.findOne({ teacherName: req.user.name, date: today });
        
        if (existing) return res.status(400).json({ error: "You have already clocked in today." });
        
        const clockIn = new TenantStaffAttendance({ 
            teacherName: req.user.name, date: today, timeIn: time, locationVerified: true, photoIn: req.body.photo 
        });
        await clockIn.save(); 
        
        logSystemAction(req, 'ADMINISTRATION', `Staff Clock-In Verified via GPS & Facial Capture`);
        res.status(200).json({ success: true, message: "Clock-in successful", timeIn: time });
    } catch (error) { res.status(500).json({ error: "Failed to record clock-in." }); }
});

app.post('/api/v1/teacher/clock-out', verifyToken, async (req, res) => {
    try {
        // 🚀 SAAS FIX
        const TenantStaffAttendance = req.tenantDb.model('StaffAttendance', staffAttendanceSchema);
        
        const today = new Date().toLocaleDateString('en-GB'); 
        const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const existing = await TenantStaffAttendance.findOne({ teacherName: req.user.name, date: today });
        
        if (!existing) return res.status(400).json({ error: "You must clock in first before you can clock out." });
        if (existing.timeOut) return res.status(400).json({ error: "You have already clocked out for today." });
        
        existing.timeOut = time; 
        existing.photoOut = req.body.photo; 
        await existing.save(); 
        
        logSystemAction(req, 'ADMINISTRATION', `Staff Clock-Out Verified via GPS & Facial Capture`);
        res.status(200).json({ success: true, message: "Clock-out successful", timeOut: time });
    } catch (error) { res.status(500).json({ error: "Failed to record clock-out." }); }
});

app.get('/api/v1/teacher/clock-status', verifyToken, async (req, res) => {
    try {
        // 🚀 SAAS FIX
        const TenantStaffAttendance = req.tenantDb.model('StaffAttendance', staffAttendanceSchema);
        
        const today = new Date().toLocaleDateString('en-GB');
        const record = await TenantStaffAttendance.findOne({ teacherName: req.user.name, date: today });
        res.json({ record });
    } catch (e) { res.status(500).json({ error: "Error fetching status" }); }
});

app.post('/api/v1/applications/log-payment', async (req, res) => {
    try {
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
        const TenantUser = req.tenantDb.model('User', userSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantInvoice = req.tenantDb.model('Invoice', invoiceSchema);
        const TenantTransaction = req.tenantDb.model('Transaction', transactionSchema);

        const { name, email, phone, feeAmount, targetClass } = req.body;
        let settings = await TenantSettings.findOne() || new TenantSettings();
        
        // 🚀 SMART PRICING VERIFICATION
        let actualExpectedFee = settings.applicationFee || 5000;
        // 🚀 THE FIX: Use standard Object lookup instead of Map functions!
        if (targetClass && settings.classApplicationFees && settings.classApplicationFees[targetClass]) {
            actualExpectedFee = settings.classApplicationFees[targetClass];
        }
        
        const cleanEmail = email.toLowerCase().trim();
        const applicantId = `APP/${new Date().getFullYear()}/${Math.floor(1000 + Math.random() * 9000)}`;
        const safePassword = settings.defaultStudentPassword || "Student123!";
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(safePassword, salt);

        // 🚀 THE SIBLING & PARENT PORTAL FIX
        // Because Applicants log in via Applicant ID, we give their User account an internal system email.
        // This completely prevents duplicate crashes for siblings AND leaves the real email available for the Parent Portal!
        const systemInternalEmail = `${applicantId.replace(/\//g, '').toLowerCase()}@applicant.portal`;

        const user = new TenantUser({ 
            email: systemInternalEmail, // Internal email just to satisfy MongoDB
            password: hashedPassword, 
            fullName: name, 
            role: 'Applicant', 
            systemId: applicantId 
        });
        await user.save();

        const newApp = new TenantApplication({ 
            studentName: name, 
            parentEmail: cleanEmail, // 🚀 REAL EMAIL IS SAVED HERE! This links all siblings together for the Parent Portal.
            parentPhone: phone, 
            targetClass: targetClass || 'Pending', 
            linkedStudentId: user._id, 
            systemId: applicantId, 
            status: 'Applied' 
        });
        await newApp.save();

        const appFee = new TenantInvoice({ 
            studentId: user._id, title: "Admission Application Fee", amount: feeAmount, amountPaid: feeAmount, 
            balance: 0, session: settings.activeSession || '2025/2026', term: settings.activeTerm || 'First', status: 'Paid', breakdown: [] 
        });
        await appFee.save();

        const newTransaction = new TenantTransaction({
            name: name, amount: feeAmount, type: 'Income', description: 'Application Fee',
            session: settings.activeSession || '2025/2026', term: settings.activeTerm || 'First'
        });
        await newTransaction.save();

        res.json({ 
            success: true, applicantId: applicantId, tempPassword: safePassword, 
            message: "Application initiated! Please save these login credentials to track your admission status."
        });
    } catch (error) { 
        console.error("Payment Log Error:", error);
        res.status(500).json({ error: "Failed to log payment: " + error.message }); 
    }
});

app.put('/api/v1/applications/complete', async (req, res) => {
    let finalSystemId = "APP-PENDING"; // 🚀 FIX: Default value
    try {
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantUser = req.tenantDb.model('User', userSchema);
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
        const TenantSubscription = req.tenantDb.model('Subscription', subscriptionSchema);

        const { studentName, targetClass, studentType, parentName, parentEmail, parentPhone, passportPhoto, dateOfBirth, gender, religion } = req.body;
        
        // 🚀 THE FIX: Find the latest application for this email that doesn't have a photo yet!
        const existingApps = await TenantApplication.find({
    parentEmail: parentEmail.toLowerCase().trim(),
    status: { $in: ['Applied', 'Completed'] }
}).sort({ createdAt: -1 });
        if (existingApps.length === 0) return res.status(404).json({ error: "No pending payment record found. Please restart your application." });
        
        let app = existingApps.find(a =>
    !a.passportPhoto ||
    (typeof a.passportPhoto === 'string' && a.passportPhoto.trim() === "")
);
        if (!app) app = existingApps[0]; // Failsafe fallback

        // 🚀 THE FIX: Robust Photo Upload with Success Validation
        let securePhotoUrl = app.passportPhoto; // Start with the existing photo (if any)

        if (passportPhoto && !passportPhoto.startsWith('http')) {
            const uploadedUrl = await uploadToCloudinary(passportPhoto, 'student_passports');
            
            // Only update if the upload actually returned a valid string
            if (uploadedUrl && uploadedUrl.startsWith('http')) {
                securePhotoUrl = uploadedUrl;
            } else {
                console.warn("⚠️ Photo upload failed, keeping existing photo or leaving null.");
            }
        }

        // Apply Bio-data to Application
        app.studentName = studentName; 
        
        // 🚀 CRITICAL SECURITY FIX: Do NOT assign targetClass here. 
        // We keep the value that was already saved in the database during Step 2.
        
        app.studentType = studentType || 'Day'; 
        app.parentName = parentName || "Parent/Sponsor"; 
        app.parentPhone = parentPhone; 
        app.dateOfBirth = dateOfBirth; 
        app.gender = gender || ""; 
        app.religion = religion || "";
        app.status = 'Applied';
        
        // Save the valid URL (or null if no photo)
        app.passportPhoto = securePhotoUrl; 
        await app.save();
        finalSystemId = app.systemId;

        // Sync with User Collection
        const user = await TenantUser.findById(app.linkedStudentId);
        if (user) {
            user.fullName = studentName;
            user.dateOfBirth = dateOfBirth; 
            user.gender = gender || ""; 
            user.religion = religion || "";
            user.role = 'Applicant'; 
            
            // Sync the photo only if we have a valid URL
            if (securePhotoUrl) user.photo = securePhotoUrl; 
            
            await user.save();
        }

        const settings = await TenantSettings.findOne() || {};

        // ==============================================================
        // 🚀 SMART PARENT ACCOUNT GENERATOR (Siblings & Credentials Sync)
        // ==============================================================
        let parentUser = await TenantUser.findOne({ 
            email: parentEmail.toLowerCase().trim(),
            role: 'Parent' 
        });

        const defaultParentPass = settings.defaultParentPassword || "Parent123!";
        let isNewParent = false;

        if (!parentUser) {
            isNewParent = true;
            const salt = await bcrypt.genSalt(10);
            const hashedParentPass = await bcrypt.hash(defaultParentPass, salt);

            parentUser = new TenantUser({
                email: parentEmail.toLowerCase().trim(),
                fullName: parentName || "Parent/Guardian",
                phone: parentPhone || "",
                password: hashedParentPass,
                role: 'Parent',
                systemId: `PRT-${Date.now().toString().slice(-6)}`,
                linkedStudentIds: [user._id] // Link first child
            });
            await parentUser.save();
        } else {
            // SIBLING LINKING: Add student to existing parent's array if not already there
            if (!parentUser.linkedStudentIds.includes(user._id)) {
                parentUser.linkedStudentIds.push(user._id);
                await parentUser.save();
            }
        }
        // ==============================================================

        const defaultPass = settings.defaultStudentPassword || "Student123!";
        const sub = await TenantSubscription.findOne() || {};

        if (sub.planTier !== 'Basic') {
            await sendMasterAlert({
                to: parentEmail.toLowerCase(),
                subject: `Admission Login Details for ${studentName}`,
                html: `
                <div style="font-family:sans-serif; padding:20px; border:1px solid #e2e8f0; border-radius:12px; max-width:600px; margin:auto; background:#fff;">
                    <h2 style="color:#3182ce; margin-top:0;">Application Received!</h2>
                    <p>Dear Parent,</p>
                    <p>The application for <b>${studentName}</b> has been processed.</p>
                    
                    <div style="background:#f8fafc; border:1px dashed #cbd5e1; padding:20px; border-radius:8px; margin:25px 0;">
                        <p style="margin:0 0 12px 0; font-weight:800; color:#475569; font-size:12px; letter-spacing:1px;">1. STUDENT TRACKER</p>
                        <p style="margin:0 0 8px 0;">Applicant ID: <b>${finalSystemId}</b></p>
                        <p style="margin:0 0 20px 0;">Password: <b>${defaultPass}</b></p>

                        <p style="margin:0 0 12px 0; font-weight:800; color:#475569; font-size:12px; letter-spacing:1px;">2. PARENT PORTAL</p>
                        <p style="margin:0 0 8px 0;">Email: <b>${parentEmail.toLowerCase().trim()}</b></p>
                        <p style="margin:0;">Password: <b>${defaultParentPass}</b></p>
                    </div>
                    <p style="font-size: 13px; color: #64748b;">Login at: https://your-subdomain.vertexnextgen.com.ng</p>
                </div>`
            });
        }
        res.json({ success: true, message: "Application Complete!", systemId: finalSystemId });
    } catch (error) {
        console.error("APPLICATION COMPLETE ERROR:", error); 
        res.status(500).json({ error: "System failed to process the application.", details: error.message });
    }
});

// 🚀 SAAS FIX: Bulk Admission Actions
app.put('/api/v1/applications/bulk-status', verifyAdmin, async (req, res) => {
    try {
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantUser = req.tenantDb.model('User', userSchema);

        const { appIds, action, examDate } = req.body;
        if (!appIds || appIds.length === 0) return res.status(400).json({ error: "No applications selected." });

        let processedCount = 0;
        for (let id of appIds) {
            const app = await TenantApplication.findById(id);
            if (!app) continue;

            if (action === 'Schedule') {
                app.examDate = examDate;
                app.status = 'Exam Scheduled';
            } else if (action === 'Admit') {
                app.status = 'Admitted';
                if (!app.systemId || app.systemId.includes('APP/')) {
                    app.systemId = await generateSystemId(req, 'Student', app.targetClass);
                }
                await TenantUser.findByIdAndUpdate(app.linkedStudentId, { role: 'Student', systemId: app.systemId });
            } else if (action === 'Reject') {
                app.status = 'Rejected';
            }
            await app.save();
            processedCount++;
        }
        
        logSystemAction(req, 'ACADEMIC', `Performed bulk [${action}] on ${processedCount} applicants.`);
        res.json({ success: true, message: `Successfully applied ${action} to ${processedCount} applicants!` });
    } catch (error) { res.status(500).json({ error: "Bulk action failed." }); }
});

app.post('/api/v1/admin/enroll-existing', verifyAdmin, async (req, res) => {
    let savedUserId = null; 
    try {
        // 🚀 SAAS FIX: Bind to specific database
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
        const TenantUser = req.tenantDb.model('User', userSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);

        let settings = await TenantSettings.findOne() || new TenantSettings();
        const safePassword = settings.defaultStudentPassword || "Student123!";
        
        const sysId = await generateSystemId(req, 'Student', req.body.targetClass);
        const salt = await bcrypt.genSalt(10); 
        const hashedPassword = await bcrypt.hash(safePassword, salt);
        
        const newStudent = new TenantUser({ 
            email: req.body.parentEmail, 
            password: hashedPassword, 
            fullName: req.body.studentName, 
            role: 'Student', 
            systemId: sysId, 
            dateOfBirth: req.body.dateOfBirth, 
            gender: req.body.gender || "", 
            religion: req.body.religion || "" 
        });
        
        const savedUser = await newStudent.save(); 
        savedUserId = savedUser._id; 
        
        const newApp = new TenantApplication({ 
            studentName: req.body.studentName, 
            parentEmail: req.body.parentEmail, 
            parentPhone: req.body.parentPhone, 
            targetClass: req.body.targetClass, 
            studentType: req.body.studentType || 'Day', 
            passportPhoto: req.body.passportPhoto, 
            dateOfBirth: req.body.dateOfBirth, 
            gender: req.body.gender || "", 
            religion: req.body.religion || "", 
            linkedStudentId: savedUser._id, 
            status: 'Admitted', 
            systemId: sysId 
        });
        await newApp.save();
        
        logSystemAction(req, 'ADMINISTRATION', `Directly enrolled existing student: ${req.body.studentName} into ${req.body.targetClass}`);
        res.status(201).json({ success: true, message: "Existing student successfully enrolled into the database!" });
    } catch (error) { 
        if (savedUserId) {
            const TenantUser = req.tenantDb.model('User', userSchema);
            await TenantUser.findByIdAndDelete(savedUserId); 
        }
        res.status(500).json({ error: "System failed to enroll the student." }); 
    }
});

// ==========================================
// SHIELDED APPLICATION ROUTES
// ==========================================
app.get('/api/v1/applications', verifyToken, async (req, res) => {
    try {
        // 🚀 SAAS FIX: Bind the Application model to the specific school database
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);

        let query = {};
        if (req.query.status) query.status = req.query.status;
        if (req.query.targetClass) query.targetClass = req.query.targetClass;

        const apps = await TenantApplication.find(query).sort({ studentName: 1 }).lean();
        res.json(apps);
    } catch (error) {
        console.error("Fetch Apps Error:", error);
        res.status(500).json({ error: "Failed to fetch" });
    }
});

app.put('/api/v1/applications/:id/schedule', verifyAdmin, async (req, res) => {
    try {
        // 🚀 SAAS FIX: Bind to specific database
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);

        const app = await TenantApplication.findById(req.params.id); 
        if (!app) return res.status(404).json({ error: "Application not found." });
        
        app.examDate = req.body.examDate; 
        app.status = 'Exam Scheduled'; 
        await app.save(); 
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Failed to schedule exam." });
    }
});

app.put('/api/v1/applications/:id/grade', verifyAdmin, async (req, res) => {
    try {
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);

        const app = await TenantApplication.findById(req.params.id); 
        if (!app) return res.status(404).json({ error: "Application not found." });
        
        // 🚀 FRAUD PREVENTION LOCK: Block manual input if they are tied to the CBT Engine!
        if (app.examDate && app.examDate.includes('Online CBT')) {
            return res.status(403).json({ error: "Security Lock: This applicant is assigned to a CBT Entrance Exam. Their score will be automatically pushed upon completion. Manual entry is disabled to prevent fraud." });
        }

        app.entranceScore = req.body.entranceScore; 
        app.status = 'Exam Graded'; 
        await app.save(); 
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Failed to save grade." });
    }
});

app.put('/api/v1/applications/:id/admit', verifyAdmin, async (req, res) => {
    try {
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantUser = req.tenantDb.model('User', userSchema);

        const app = await TenantApplication.findById(req.params.id); 
        if (!app) return res.status(404).json({ error: "Application not found." });
        
        app.status = 'Admitted'; 
        
        // 1. Generate System ID
        if (!app.systemId || app.systemId.includes('APP/')) { 
            app.systemId = await generateSystemId(req, 'Student', app.targetClass); 
        }
        
        await app.save(); 
        
        // 2. Update Student User role
        await TenantUser.findByIdAndUpdate(app.linkedStudentId, { role: 'Student', systemId: app.systemId }); 

        // 🚀 THE MISSING LINK: Sync with Parent Account
        // We find the parent by their email, and add the student to their linkedStudentIds array
        if (app.parentEmail) {
            const parent = await TenantUser.findOne({ 
                email: new RegExp('^' + app.parentEmail.trim() + '$', 'i'), 
                role: 'Parent' 
            });

            if (parent) {
                // $addToSet ensures we don't add the same student twice
                await TenantUser.findByIdAndUpdate(parent._id, { 
                    $addToSet: { linkedStudentIds: app.linkedStudentId } 
                });
            }
        }
        
        logSystemAction(req, 'ACADEMIC', `Approved admission for student: ${app.studentName} into ${app.targetClass}`);
        
        res.json({ success: true, message: "Student admitted and linked to parent account." });
    } catch (error) {
        console.error("Admit Error:", error);
        res.status(500).json({ error: "Failed to admit student." });
    }
});

app.get('/api/v1/admin/resync-parents', verifyAdmin, async (req, res) => {
    try {
        const TenantUser = req.tenantDb.model('User', userSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);

        // 1. Get all admitted students
        const students = await TenantApplication.find({ status: 'Admitted' });
        let updatedCount = 0;

        for (let student of students) {
            if (!student.parentEmail || !student.linkedStudentId) continue;

            // 2. Find the parent account by email
            const parent = await TenantUser.findOne({ 
                email: new RegExp('^' + student.parentEmail.trim() + '$', 'i'), 
                role: 'Parent' 
            });

            if (parent) {
                // 3. Add the student ID to the parent's array if it's not there
                if (!parent.linkedStudentIds.includes(student.linkedStudentId)) {
                    parent.linkedStudentIds.push(student.linkedStudentId);
                    await parent.save();
                    updatedCount++;
                }
            }
        }

        res.json({ success: true, message: `Re-synced ${updatedCount} parent-student links.` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/v1/applications/:id/reject', verifyAdmin, async (req, res) => {
    try {
        // 🚀 SAAS FIX: Bind to specific database
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);

        const app = await TenantApplication.findById(req.params.id); 
        if (!app) return res.status(404).json({ error: "Application not found." });
        
        app.status = 'Rejected'; 
        await app.save(); 
        
        // 🔒 THE BLACK BOX: Record the rejection
        logSystemAction(req, 'ACADEMIC', `Declined admission for applicant: ${app.studentName}`);
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Failed to reject student." });
    }
});

// --- SAAS BULK ACTIONS (STATUS & SCHEDULING) ---
app.put('/api/v1/applications/bulk-status', verifyAdmin, async (req, res) => {
    try {
        const { appIds, action, examDate } = req.body;
        if (!appIds || appIds.length === 0) return res.status(400).json({ error: "No applications selected." });

        let processedCount = 0;
        for (let id of appIds) {
            const app = await Application.findById(id);
            if (!app) continue;

            if (action === 'Schedule') {
                app.examDate = examDate;
                app.status = 'Exam Scheduled';
            } else if (action === 'Admit') {
                app.status = 'Admitted';
                // THE FIX: Applied same logic to bulk actions
                if (!app.systemId || app.systemId.includes('APP/')) {
                    app.systemId = await generateSystemId('Student', app.targetClass);
                }
                await User.findByIdAndUpdate(app.linkedStudentId, { role: 'Student', systemId: app.systemId });
            } else if (action === 'Reject') {
                app.status = 'Rejected';
            }
            await app.save();
            processedCount++;
        }
        
        logSystemAction(req, 'ACADEMIC', `Performed bulk [${action}] on ${processedCount} applicants.`);
        res.json({ success: true, message: `Successfully applied ${action} to ${processedCount} applicants!` });
    } catch (error) { res.status(500).json({ error: "Bulk action failed." }); }
});

// 🚀 SAAS FIX: Bulk Manual Grading
app.put('/api/v1/applications/bulk-grade', verifyAdmin, async (req, res) => {
    try {
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        
        const { grades } = req.body; 
        if (!grades || grades.length === 0) return res.status(400).json({ error: "No grades provided." });

        let gradedCount = 0;
        let skippedCbtCount = 0; // 🚀 Tracker for fraud prevention

        for (let g of grades) {
            if (g.score === "" || g.score === null) continue;
            
            // Load the app to ensure they aren't CBT assigned
            const app = await TenantApplication.findById(g.appId);
            if (app && app.examDate && app.examDate.includes('Online CBT')) {
                skippedCbtCount++;
                continue; // Skip CBT students silently
            }

            await TenantApplication.findByIdAndUpdate(g.appId, { entranceScore: g.score, status: 'Exam Graded' });
            gradedCount++;
        }
        
        logSystemAction(req, 'ACADEMIC', `Bulk graded ${gradedCount} applicants manually.`);
        
        let msg = `Successfully graded ${gradedCount} applicants!`;
        if (skippedCbtCount > 0) msg += `\n\nSecurity Notice: ${skippedCbtCount} applicants were skipped because their scores are locked to the automated CBT Engine.`;
        
        res.json({ success: true, message: msg });
    } catch (error) { res.status(500).json({ error: "Bulk grading failed." }); }
});

// 🚀 SAAS FIX: Student Personal Application Route
app.get('/api/v1/my-application/:userId', verifyToken, async (req, res) => {
    try {
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        
        const app = await TenantApplication.findOne({ linkedStudentId: req.params.userId }); 
        res.json(app);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch user application." });
    }
});

// =====================================================================
// 🚀 PUBLIC VERIFICATION API (Explicitly Tenant-Scoped)
// =====================================================================

// 1. VERIFY STUDENT
app.get('/api/v1/public/verify/student/:id', async (req, res) => {
    try {
        if (!req.tenantDb) return res.status(400).json({ error: "Missing tenant connection context." });
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);

        const person = await TenantApplication.findOne({ linkedStudentId: req.params.id });
        if (!person) return res.status(404).json({ error: "INVALID ID: No student record found." });

        const settings = await TenantSettings.findOne() || {};
        res.json({
            success: true, type: 'Student', name: person.studentName, systemId: person.systemId,
            roleOrClass: person.targetClass, status: person.status, photo: person.passportPhoto,
            schoolName: settings.schoolName || 'Syncra', themeColor: settings.themeColor || '#3182ce', logo: settings.schoolLogo || null
        });
    } catch (error) { res.status(500).json({ error: "Verification system error." }); }
});

// 2. VERIFY STAFF
app.get('/api/v1/public/verify/staff/:id', async (req, res) => {
    try {
        if (!req.tenantDb) return res.status(400).json({ error: "Missing tenant connection context." });
        const TenantUser = req.tenantDb.model('User', userSchema);
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);

        const person = await TenantUser.findOne({ _id: req.params.id });
        if (!person || ['Student', 'Applicant', 'Parent'].includes(person.role)) {
            return res.status(404).json({ error: "INVALID ID: No staff record found." });
        }

        const settings = await TenantSettings.findOne() || {};
        res.json({
            success: true, type: 'Staff', name: person.fullName, systemId: person.systemId,
            roleOrClass: person.jobTitle || person.role, status: person.accountStatus || 'Active', photo: person.photo,
            schoolName: settings.schoolName || 'Syncra', themeColor: settings.themeColor || '#3182ce', logo: settings.schoolLogo || null
        });
    } catch (error) { res.status(500).json({ error: "Verification system error." }); }
});

// 3. VERIFY RESULT (REPORT CARD)
app.get('/api/v1/public/verify/result/:id', async (req, res) => {
    try {
        if (!req.tenantDb) return res.status(400).json({ error: "Missing connection." });
        const TenantResult = req.tenantDb.model('Result', resultSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);

        // 1. Find the Result
        const resultDoc = await TenantResult.findOne({ _id: req.params.id });
        if (!resultDoc) return res.status(404).json({ error: "Result not found." });

        // 2. Use the studentId stored INSIDE the result document
        // We don't need req.params.studentId because resultDoc.studentId is already the reference
        const student = await TenantApplication.findOne({ 
            $or: [
                { _id: resultDoc.studentId }, 
                { linkedStudentId: resultDoc.studentId }
            ] 
        });

        const settings = await TenantSettings.findOne() || {};

        res.json({
            success: true, 
            studentName: student ? student.studentName : 'Unknown',
            systemId: student ? student.systemId : 'N/A',
            session: resultDoc.session,
            term: resultDoc.term,
            stage: resultDoc.publishStage || 'Full',
            schoolName: settings.schoolName || 'Vertex School Portal',
            themeColor: settings.themeColor || '#3182ce',
            logo: settings.schoolLogo || null,
            records: resultDoc.records
        });
    } catch (error) { 
        console.error("Result Route Error:", error);
        res.status(500).json({ error: "Verification error." }); 
    }
});

// 4. VERIFY TRANSCRIPT (Multi-Year Compilation - MASTER RESOLUTION FIX)
app.get('/api/v1/public/verify/transcript', async (req, res) => {
    try {
        if (!req.tenantDb) return res.status(400).json({ error: "Missing tenant connection." });
        
        // 🚀 Grab id from query string: ?id=69ce...
        const searchId = req.query.id ? decodeURIComponent(req.query.id).trim() : '';
        
        if (!searchId) return res.status(400).json({ error: "Missing ID" });

        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantResult = req.tenantDb.model('Result', resultSchema);
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);

        // 1. Log what we are searching for
        console.log("🕵️ Searching for student with ID:", searchId);

        // 2. Search using multiple formats (String, RegExp, and ObjectId if valid)
        let query = {
            $or: [
                { systemId: new RegExp('^' + searchId + '$', 'i') }
            ]
        };

        if (mongoose.Types.ObjectId.isValid(searchId)) {
            query.$or.push({ _id: new mongoose.Types.ObjectId(searchId) });
            query.$or.push({ linkedStudentId: new mongoose.Types.ObjectId(searchId) });
        }

        const student = await TenantApplication.findOne(query);

        if (!student) {
            console.log("❌ No student found in Application collection.");
            return res.status(404).json({ error: "Record not found" });
        }

        console.log("✅ Student found:", student.studentName, "ID:", student.linkedStudentId);

        // 3. Find results - Using the raw ID string to ensure a match
        const targetIdString = student.linkedStudentId ? student.linkedStudentId.toString() : student._id.toString();
        
        console.log("🔍 Querying Result collection for ID:", targetIdString);

        // Try searching by the string representation
        let results = await TenantResult.find({ studentId: targetIdString }).lean();

        // If that returns nothing, try searching by the ObjectId
        if (!results || results.length === 0) {
            console.log("⚠️ String search failed, trying ObjectId search...");
            results = await TenantResult.find({ 
                studentId: new mongoose.Types.ObjectId(targetIdString) 
            }).lean();
        }

        console.log(`📊 Found ${results.length} result documents.`);

        const settings = await TenantSettings.findOne() || {};
        res.json({
            success: true,
            studentName: student.studentName,
            systemId: student.systemId || 'Pending',
            photo: student.passportPhoto,
            schoolName: settings.schoolName || 'Syncra',
            results: results
        });

    } catch (error) {
        console.error("🔥 Route Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// --- SECURE LOGIN (Parent vs Student Split) ---
app.post('/api/v1/login', async (req, res) => {
    console.log("\n👉 --- SECURE LOGIN INITIATED ON DB:", req.tenantDb.name, "---");
    try {
        // 🚀 SAAS FIX: Bind the Mongoose models to this specific school's database
        const TenantUser = req.tenantDb.model('User', userSchema);
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
        const TenantSubscription = req.tenantDb.model('Subscription', subscriptionSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);

        const { email, password, portalType } = req.body; 
        const loginId = email.trim();

        let user;
        let isParentLogin = false;

        // ==========================================
        // 🚀 ADMISSIONS PORTAL (Strict Applicant Logic)
        // ==========================================
        if (portalType === 'applicant') {
            if (!loginId.toUpperCase().startsWith('APP/')) {
                return res.status(403).json({ error: 'Applicants should login using their Applicant ID (e.g. APP/...)' });
            }
            user = await TenantUser.findOne({ systemId: new RegExp('^' + loginId + '$', 'i'), role: 'Applicant' });
        } 
        // ==========================================
        // 🚀 MAIN PORTAL (Staff, Student, Parent, Admin)
        // ==========================================
        else if (portalType === 'main') {
            if (loginId.toUpperCase().startsWith('APP/')) {
                return res.status(403).json({ error: 'Applicants must track their admission via the Admissions Portal.' });
            }

            if (loginId.includes('@')) {
                // 🚀 THE FIX: Fetch ALL accounts tied to this email
                const potentialUsers = await TenantUser.find({
                    email: new RegExp('^' + loginId + '$', 'i'),
                    role: { $ne: 'Applicant' },
                    accountStatus: { $ne: 'Archived' }
                });

                // 🚀 PRIORITY ROUTING: Staff/Admin > Parent > Student
                // This guarantees we don't accidentally log them in as a Student if a Parent account exists!
                user = potentialUsers.find(u => !['Student', 'Parent', 'Applicant'].includes(u.role)) 
                    || potentialUsers.find(u => u.role === 'Parent') 
                    || potentialUsers.find(u => u.role === 'Student'); 

            } else {
                // Fallback for Students/Staff using System IDs (e.g., VIS/JSS/001)
                user = await TenantUser.findOne({ 
                    systemId: new RegExp('^' + loginId + '$', 'i'),
                    role: { $ne: 'Applicant' },
                    accountStatus: { $ne: 'Archived' }
                });
            }

            if (user && user.role === 'Parent') {
                isParentLogin = true;
            }
        }
        
        if (!user) return res.status(404).json({ error: "Account not found. Check your credentials." });
        if (user.accountStatus === 'Archived') return res.status(403).json({ error: "This account has been deactivated. Contact the School Admin." }); 
        
        if (user.lockUntil && user.lockUntil > Date.now()) {
            const msLeft = user.lockUntil - Date.now();
            const hrsLeft = Math.floor(msLeft / (1000 * 60 * 60));
            const minsLeft = Math.ceil((msLeft % (1000 * 60 * 60)) / (1000 * 60));
            
            if (hrsLeft >= 1) return res.status(429).json({ error: `Security Lockout: Too many attempts. Try again in ${hrsLeft}h ${minsLeft}m.` });
            else return res.status(429).json({ error: `Security Lockout: Try again in ${minsLeft} minutes.` });
        }

        if (user.lockUntil && user.lockUntil <= Date.now()) {
            user.loginAttempts = 0;
            user.lockUntil = undefined;
            await user.save();
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            user.loginAttempts += 1;
            if (user.loginAttempts >= 5) {
                let currentStrikes = (user.lockCount || 0) + 1;
                user.lockCount = currentStrikes;
                if (currentStrikes >= 3) {
                    user.lockUntil = Date.now() + 24 * 60 * 60 * 1000; 
                    user.loginAttempts = 0; 
                    user.lockCount = 0; 
                    await user.save();
                    return res.status(429).json({ error: "Account locked for 24 HOURS due to extreme suspicious activity." });
                } else {
                    user.lockUntil = Date.now() + 15 * 60 * 1000; 
                    user.loginAttempts = 0; 
                    await user.save();
                    return res.status(429).json({ error: `Account locked due to 5 failed attempts. Try again in 15 minutes.` });
                }
            }
            await user.save(); 
            return res.status(401).json({ error: `Incorrect password. ${5 - user.loginAttempts} attempts remaining.` });
        }

// 🚀 ALL PORTAL ROUTING CROSS-TALK REMOVED
        // (Guard rails are now strictly enforced at the database query level)
        
        // 🚀 SAAS ROLE ENFORCER
        if (['Principal', 'Bursar'].includes(user.role)) {
            const sub = await TenantSubscription.findOne() || { planTier: 'Premium' };
            if (sub.planTier === 'Basic') return res.status(403).json({ error: `SaaS Restriction: The ${user.role} role is not supported on the Basic Plan.` });
            if (sub.planTier === 'Standard' && user.role === 'Bursar') return res.status(403).json({ error: "SaaS Restriction: The Bursar role is only available on the Premium Plan." });
        }

        user.loginAttempts = 0; 
        user.lockUntil = undefined; 
        user.lockCount = 0; 
        await user.save();

        let finalRole = isParentLogin ? 'Parent' : user.role;
        let finalName = isParentLogin ? "Parent/Guardian" : user.fullName;

        let settings = await TenantSettings.findOne() || {};
        
        // 🚀 SAAS FIX: Dynamically check the default password based on the exact role
        let defaultPass;
        if (finalRole === 'Student') {
            defaultPass = settings.defaultStudentPassword || 'Student123!';
        } else if (finalRole === 'Parent') {
            defaultPass = settings.defaultParentPassword || 'Parent123!';
        } else {
            defaultPass = settings.defaultStaffPassword || 'Staff123!';
        }

        const isDefaultPassword = await bcrypt.compare(defaultPass, user.password);
        
        const token = jwt.sign({ 
            id: user._id, role: finalRole, name: finalName, email: user.email, 
            classAssigned: user.classAssigned, subjectsAssigned: user.subjectsAssigned, 
            teacherType: user.teacherType, formClass: user.formClass,
            tenantDbName: req.tenantDb.name // 🚀 Pass the tenant ID securely in the JWT token!
        }, process.env.JWT_SECRET, { expiresIn: '1d' });
        
        res.cookie('portalToken', token, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 24 * 60 * 60 * 1000 });

        return res.status(200).json({ 
            success: true, requiresPasswordChange: isDefaultPassword, 
            user: { 
                id: user._id, role: finalRole, name: finalName, email: user.email,
                photo: user.photo, walletBalance: user.walletBalance, systemId: user.systemId,
                classAssigned: user.classAssigned, subjectsAssigned: user.subjectsAssigned, 
                teacherType: user.teacherType, formClass: user.formClass
            } 
        });

    } catch (error) { 
        console.error(error);
        return res.status(500).json({ error: "System error during login." }); 
    }
});

// 🚀 SAAS FIX: Explicit Forgot Password Handling
app.post('/api/v1/forgot-password', async (req, res) => {
    try {
        const TenantUser = req.tenantDb.model('User', userSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const { identifier } = req.body;
        const cleanIdentifier = identifier.trim().toLowerCase();

        let user;
        let targetEmail = "";

        if (cleanIdentifier.includes('@')) {
            // 1. Email entered: Target Parents and Staff ONLY.
            user = await TenantUser.findOne({ 
                email: new RegExp('^' + cleanIdentifier + '$', 'i'),
                role: { $nin: ['Student', 'Applicant'] },
                accountStatus: { $ne: 'Archived' }
            });
            if (user) targetEmail = user.email;
        } else {
            // 2. ID entered: Target Students, Applicants, or Staff using ID.
            user = await TenantUser.findOne({ 
                systemId: new RegExp('^' + cleanIdentifier + '$', 'i'),
                accountStatus: { $ne: 'Archived' }
            });

            if (user) {
                if (['Student', 'Applicant'].includes(user.role)) {
                    // Securely pull the REAL parent email from the Application record
                    const app = await TenantApplication.findOne({ linkedStudentId: user._id });
                    if (app && app.parentEmail) {
                        targetEmail = app.parentEmail;
                    }
                } else {
                    targetEmail = user.email; // Staff
                }
            }
        }

        if (!user || !targetEmail) {
            return res.status(404).json({ error: "Account not found, or no valid email linked to this ID." });
        }

        // 🚀 RATE LIMIT: 3 requests per 24 hours
        const lastRequest = new Date(user.lastOtpDate || 0);
        const isNewDay = (Date.now() - lastRequest.getTime()) > (24 * 60 * 60 * 1000);
        if (isNewDay) user.otpRequests = 0;
        if (user.otpRequests >= 3) return res.status(429).json({ error: "Limit reached. Try again in 24 hours." });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        user.resetPasswordToken = otp;
        user.resetPasswordExpires = Date.now() + 15 * 60 * 1000; // 15 Minutes
        user.otpRequests += 1;
        user.lastOtpDate = Date.now();
        await user.save();

        console.log(`DEBUG: Generated OTP for ${user.email}: ${otp} (Sending to: ${targetEmail})`); // 🚀 LOOK AT YOUR TERMINAL

        // 4. Send the email
        const mailSent = await sendSchoolEmail(req, {
            to: targetEmail, // 🚀 THE FIX: Send to the parent's REAL email, not the fake system email!
            subject: "Password Reset Request",
            html: `
                <div style="font-family:sans-serif; padding:20px; border-radius:10px; border:1px solid #e2e8f0;">
                    <h2 style="color:#1e3a8a; margin-top:0;">Password Reset</h2>
                    <p>You requested a password reset. Here is your 6-digit authorization code:</p>
                    <div style="background:#f1f5f9; padding:15px; font-size:24px; font-weight:bold; letter-spacing:5px; text-align:center; color:#2563eb; border-radius:8px; margin:20px 0;">
                        ${otp}
                    </div>
                    <p style="font-size:12px; color:#64748b;">This code expires in 1 hour. If you did not request this, please ignore this email.</p>
                </div>
            `
        });

        if (!mailSent) {
            return res.status(500).json({ error: "Failed to send the email. Please try again later." });
        }

        res.json({ success: true, message: "A password reset code has been sent to your registered email address." });
    } catch (err) {
        console.error("Forgot Password Error:", err);
        res.status(500).json({ error: "System error during reset process." });
    }
});

app.post('/api/v1/reset-password', async (req, res) => {
    try {
        const TenantUser = req.tenantDb.model('User', userSchema);
        const { identifier, otp, newPassword } = req.body;
        const cleanIdentifier = identifier.trim().toLowerCase();

        let user;
        if (cleanIdentifier.includes('@')) {
            user = await TenantUser.findOne({ 
                email: new RegExp('^' + cleanIdentifier + '$', 'i'),
                role: { $nin: ['Student', 'Applicant'] }
            });
        } else {
            user = await TenantUser.findOne({ 
                systemId: new RegExp('^' + cleanIdentifier + '$', 'i')
            });
        }

        if (!user) return res.status(404).json({ error: "User not found." });
        
        // --- DEEP DEBUGGING BLOCK ---
        console.log("--- RESET PASSWORD DEBUG ---");
        console.log("Saved Token in DB:", user.resetPasswordToken);
        console.log("Type of Saved Token:", typeof user.resetPasswordToken);
        console.log("Provided OTP from Form:", otp);
        console.log("Type of Provided OTP:", typeof otp);
        console.log("Compare Result:", user.resetPasswordToken === String(otp).trim());
        // -----------------------------

        if (user.resetPasswordToken !== String(otp).trim()) {
            return res.status(400).json({ error: "Invalid code. Check your email." });
        }
        
        if (!user.resetPasswordExpires || user.resetPasswordExpires < Date.now()) {
            return res.status(400).json({ error: "Code expired." });
        }

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        res.json({ success: true, message: "Password reset!" });
    } catch (err) { 
        console.error("Critical Reset Error:", err);
        res.status(500).json({ error: "Reset failed." }); 
    }
});

app.post('/api/v1/logout', (req, res) => { 
    res.clearCookie('portalToken'); 
    return res.status(200).json({ success: true, message: "Logged out securely." }); 
});

// ==========================================
// 4. ACADEMICS & ATTENDANCE
// ==========================================
app.post('/api/v1/results', verifyTeacherOrAdmin, async (req, res) => {
    try { 
        const TenantResult = req.tenantDb.models.Result || req.tenantDb.model('Result', resultSchema);
        const TenantUser = req.tenantDb.model('User', userSchema);
        
        let { studentId, session, term, records, attendance, maxAttendance, remarks, principalRemarks, skills, publishStage, formTeacherSignature, formTeacherName } = req.body;
        if (req.user && (req.user.role === 'Teacher' || req.user.role === 'Staff')) {
            const teacherDoc = await TenantUser.findById(req.user.id);
            if (teacherDoc && teacherDoc.signature) { formTeacherSignature = teacherDoc.signature; }
            formTeacherName = req.user.name; 
        }
        let result = await TenantResult.findOne({ studentId, session, term });
        if (result) {
            result.records = records;
            if(attendance !== undefined) result.attendance = attendance;
            if(maxAttendance !== undefined) result.maxAttendance = maxAttendance;
            if(remarks !== undefined) result.remarks = remarks;
            if(principalRemarks !== undefined) result.principalRemarks = principalRemarks;
            if(skills !== undefined) result.skills = skills;
            if(publishStage !== undefined) result.publishStage = publishStage;
            if(formTeacherSignature !== undefined) result.formTeacherSignature = formTeacherSignature;
            if(formTeacherName !== undefined) result.formTeacherName = formTeacherName;
            await result.save();
        } else {
            const newRecordData = req.body;
            if (formTeacherSignature) newRecordData.formTeacherSignature = formTeacherSignature;
            if (formTeacherName) newRecordData.formTeacherName = formTeacherName;
            result = new TenantResult(newRecordData); 
            await result.save();
            logSystemAction(req, 'ACADEMIC', `Uploaded/Updated term results for student ID: ${studentId}`);
        }
        res.status(200).json({ success: true, message: "Records securely saved/updated." }); 
    } catch (error) { res.status(500).json({ error: "Failed to upload result." }); }
});

app.post('/api/v1/results/bulk-subject', verifyTeacherOrAdmin, async (req, res) => {
    try {
        const TenantResult = req.tenantDb.models.Result || req.tenantDb.model('Result', resultSchema);
        const { scores } = req.body; 
        for (let data of scores) {
            const { studentId, session, term, type, subject, ca1, ca2, exam } = data;
            let reportCard = await TenantResult.findOne({ studentId, session, term });
            if (!reportCard) reportCard = new TenantResult({ studentId, session, term, type, records: [] });
            let subjectIndex = reportCard.records.findIndex(r => r.subject === subject);
            if (subjectIndex > -1) {
                if (ca1 !== undefined) reportCard.records[subjectIndex].ca1 = ca1;
                if (ca2 !== undefined) reportCard.records[subjectIndex].ca2 = ca2;
                if (exam !== undefined) reportCard.records[subjectIndex].exam = exam;
            } else {
                reportCard.records.push({ subject, ca1, ca2, exam });
                subjectIndex = reportCard.records.length - 1; 
            }
            let currentRecord = reportCard.records[subjectIndex];
            let safeC1 = currentRecord.ca1 || 0; let safeC2 = currentRecord.ca2 || 0; let safeEx = currentRecord.exam || 0;
            currentRecord.score = safeC1 + safeC2 + safeEx;
            await reportCard.save();
        }
        logSystemAction(req, 'ACADEMIC', `Bulk uploaded subject scores.`);
        res.status(200).json({ message: "Bulk upload successful" });
    } catch (error) { res.status(500).json({ error: "Failed to process bulk upload" }); }
});

// ==========================================
// 🎓 UNIFIED RESULTS FETCHING (Multi-Tenant)
// ==========================================

// 1. Single Fetch (For Parents & Individuals)
app.get('/api/v1/results/:studentId', verifyToken, async (req, res) => {
    try {
        // 🚀 THE FIX: Check models cache first to prevent OverwriteModelError memory leaks
        const TenantResult = req.tenantDb.models.Result || req.tenantDb.model('Result', resultSchema);
        
        const results = await TenantResult.find({ studentId: req.params.studentId })
            .sort({ session: -1, term: -1, createdAt: -1 })
            .lean();

        return res.json(results);
    } catch (error) {
        console.error("Fetch Student Results Error:", error.message);
        return res.status(500).json({ error: "Failed to fetch student results." });
    }
});

// 🚀 2. NEW: Bulk Fetch (For Teachers) - Prevents the Windows Socket Crash!
app.post('/api/v1/results/bulk-fetch', verifyToken, async (req, res) => {
    try {
        const TenantResult = req.tenantDb.models.Result || req.tenantDb.model('Result', resultSchema);
        const { studentIds } = req.body;
        
        // Fetch ALL results for ALL requested students in exactly ONE database query
        const allResults = await TenantResult.find({ studentId: { $in: studentIds } }).lean();
        
        // Group the results back into an array-of-arrays matching the exact order the frontend expects
        const groupedResults = studentIds.map(id => {
            return allResults
                .filter(r => r.studentId.toString() === id.toString())
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        });
        
        return res.json(groupedResults);
    } catch (error) {
        console.error("Bulk Fetch Error:", error.message);
        return res.status(500).json({ error: "Failed to bulk fetch results." });
    }
});

// =====================================================================
// 🚀 SUPER-FAST FORM MASTER BULK PROCESSOR (WITH SMART LOCKS)
// =====================================================================
app.post('/api/v1/teacher/bulk-process-form', verifyToken, async (req, res) => {
    try {
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantResult = req.tenantDb.models.Result || req.tenantDb.model('Result', resultSchema);
        const TenantAttendance = req.tenantDb.model('Attendance', attendanceSchema);
        const TenantUser = req.tenantDb.model('User', userSchema);
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);

        const { defaultSkillScore } = req.body;
        const formClass = req.user.formClass;

        if (!formClass) return res.status(403).json({ error: "Access Denied: You are not assigned as a Form Master." });

        // 1. Get Global Environment Variables
        const settings = await TenantSettings.findOne() || {};
        const session = settings.activeSession || "2025/2026";
        const term = settings.activeTerm || "First";

        // 2. Grab the Teacher's Signature
        const teacherDoc = await TenantUser.findById(req.user.id);
        const signature = teacherDoc && teacherDoc.signature ? teacherDoc.signature : "";
        const teacherName = req.user.name;

        // 3. 🚀 FETCH EVERYTHING IN THREE MASSIVE QUERIES
        const students = await TenantApplication.find({ targetClass: formClass, status: 'Admitted' }).lean();
        if (students.length === 0) return res.status(404).json({ error: "No active students found in your class." });
        const studentIds = students.map(s => s.linkedStudentId.toString());

        const results = await TenantResult.find({ studentId: { $in: studentIds }, session, term }).lean();
        
        // =========================================================
        // 🛑 THE STRICT CHAIN OF COMMAND LOCK
        // =========================================================
        const publishedCount = results.filter(r => r.publishStage && r.publishStage !== 'Draft').length;
        if (publishedCount > 0) {
            return res.status(403).json({ 
                // 🚀 FIXED: Crisp, professional text without line breaks
                error: "Class Locked: Official results have already been published. Please request the Administrator to revert to 'Draft' status before modifying grades." 
            });
        }

        const attendances = await TenantAttendance.find({ className: formClass }).lean();

        // 4. Calculate School Days Opened
        const maxDays = [...new Set(attendances.map(a => a.date))].length; 

        // Pre-calculate attendance per student in memory
        const attMap = {};
        attendances.forEach(a => {
            if (!attMap[a.studentId]) attMap[a.studentId] = 0;
            if (a.status === 'Present') attMap[a.studentId] += 0.5;
            if (a.afternoonStatus === 'Present') attMap[a.studentId] += 0.5;
        });

        // 5. Prepare the Bulk Database Operations
        const bulkOps = [];
        const scoreVal = Number(defaultSkillScore) || 4;
        
        let processedCount = 0;
        let skippedCount = 0;

        students.forEach(student => {
            const sId = student.linkedStudentId.toString();
            let existingResult = results.find(r => r.studentId.toString() === sId);

            // 🛑 THE SMART LOCK FIX: Skip if the result is already published!
            // If the stage is anything other than 'Draft' (e.g. CA1, CA2, or Full), the Admin has locked it.
            if (existingResult && existingResult.publishStage && existingResult.publishStage !== 'Draft') {
                skippedCount++;
                return; // Instantly skip to the next student
            }

            let daysPresent = Math.ceil(attMap[sId] || 0);
            
            // Dynamic Punctuality Calculation based on attendance percentage
            let pScore = scoreVal; 
            if (maxDays > 0) {
                let p = (daysPresent / maxDays) * 100;
                if (p >= 95) pScore = 5;
                else if (p >= 80) pScore = 4;
                else if (p >= 60) pScore = 3;
                else if (p >= 40) pScore = 2;
                else pScore = 1;
            }

            const skillsData = { 
                attentiveness: scoreVal, honesty: scoreVal, neatness: scoreVal, politeness: scoreVal, 
                punctuality: pScore, obedience: scoreVal, reliability: scoreVal, tools: scoreVal, 
                drawing: scoreVal, handwriting: scoreVal, speaking: scoreVal, sports: scoreVal 
            };

            // 🧠 THE SMART REMARK ENGINE (Lightning fast local processing)
            let totalScore = 0; let subjCount = 0;
            if (existingResult && existingResult.records) {
                existingResult.records.forEach(r => { totalScore += (r.score || 0); subjCount++; });
            }
            
            let avg = subjCount > 0 ? (totalScore / subjCount) : 0;
            let autoRemark = "Awaiting final scores.";
            const fName = student.studentName.split(' ')[0]; 
            
            if (subjCount > 0) {
                if (avg >= 75) autoRemark = `An outstanding performance, ${fName}! Keep up the excellent work.`;
                else if (avg >= 60) autoRemark = `A very good result. Maintain this focus next term.`;
                else if (avg >= 50) autoRemark = `Good effort, but there is still room for improvement in weaker subjects.`;
                else if (avg >= 40) autoRemark = `A fair attempt. You must work much harder next term, ${fName}.`;
                else autoRemark = `Poor performance. Urgent academic intervention and study focus is required.`;
            }

            // Create the update document
            bulkOps.push({
                updateOne: {
                    filter: { studentId: sId, session: session, term: term },
                    update: { 
                        $set: { 
                            attendance: daysPresent, maxAttendance: maxDays, 
                            skills: skillsData, remarks: autoRemark, 
                            formTeacherSignature: signature, formTeacherName: teacherName 
                        } 
                    },
                    upsert: true 
                }
            });
            
            processedCount++;
        });

        // 6. 🚀 EXECUTE THE MASSIVE UPDATE
        if (bulkOps.length > 0) {
            await TenantResult.bulkWrite(bulkOps);
        }

        // 🔒 Log the action
        logSystemAction(req, 'ACADEMIC', `Bulk processed Form Master tasks (Processed: ${processedCount}, Locked/Skipped: ${skippedCount}) for ${formClass}`);

        let finalMessage = `Successfully processed ${processedCount} students!`;
        if (skippedCount > 0) {
            finalMessage += `\n(${skippedCount} students were safely skipped because their results are already published by Admin).`;
        }

        res.json({ success: true, message: finalMessage });
    } catch (error) {
        console.error("Bulk Process Error:", error);
        res.status(500).json({ error: "Server failed to execute bulk processing." });
    }
});

// POST NEW E-LEARNING MATERIAL
app.post('/api/v1/elearning', verifyToken, async (req, res) => {
    try { 
        const TenantELearning = req.tenantDb.model('ELearning', eLearningSchema);
        const TenantMessage = req.tenantDb.model('Message', messageSchema);
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema); // 🚀 Fetch Settings Model
        
        const newNote = new TenantELearning(req.body); 
        await newNote.save(); 
        
        // 🚀 AUTOMATED BOT: Notify students using the Dynamic School Name!
        const settings = await TenantSettings.findOne() || {};
        const dynamicSchoolName = settings.schoolName || 'Automated System';

        const sysMsg = new TenantMessage({
            senderId: 'SYSTEM_BOT',
            senderName: dynamicSchoolName, // 🚀 Uses the actual school name
            senderRole: 'System Bot',
            targetId: 'ALL',
            targetName: req.body.targetClass,
            targetRole: `Broadcast - ${req.body.targetClass}`,
            subject: `New Study Material: ${req.body.subject}`,
            message: `Your teacher (${req.body.postedBy || 'a teacher'}) has posted new study material for ${req.body.subject} titled "${req.body.title}". Please visit the Study Materials section to view and complete it.`,
            isGlobal: false
        });
        await sysMsg.save();

        res.status(201).json({ message: "Note published successfully!" }); 
    } catch (error) { 
        res.status(500).json({ error: "Failed to publish note" }); 
    }
});

app.get('/api/v1/elearning/:className', verifyToken, async (req, res) => {
    try { 
        const TenantELearning = req.tenantDb.model('ELearning', eLearningSchema);
        const notes = await TenantELearning.find({ targetClass: req.params.className }).sort({ createdAt: -1 }); 
        res.status(200).json(notes); 
    } catch (error) { res.status(500).json({ error: "Failed to fetch notes" }); }
});

// 🚀 FETCH TEACHER'S POSTED STUDY MATERIALS
app.get('/api/v1/teacher/my-elearning', verifyToken, async (req, res) => {
    try { 
        const TenantELearning = req.tenantDb.model('ELearning', eLearningSchema);
        // Find materials posted by this specific teacher
        const notes = await TenantELearning.find({ postedBy: req.user.name }).sort({ createdAt: -1 }); 
        res.status(200).json(notes); 
    } catch (error) { res.status(500).json({ error: "Failed to fetch materials" }); }
});

// 🚀 FETCH TEACHER'S SUBMITTED LESSON NOTES
app.get('/api/v1/teacher/my-lesson-notes', verifyToken, async (req, res) => {
    try {
        const TenantLessonNote = req.tenantDb.model('LessonNote', lessonNoteSchema);
        // Find notes submitted by this specific teacher
        const notes = await TenantLessonNote.find({ teacherName: req.user.name }).sort({ createdAt: -1 });
        res.status(200).json(notes);
    } catch (error) { res.status(500).json({ error: "Failed to fetch lesson notes." }); }
});

// 🚀 SAAS FEATURE: Historical Academic Results Importer (DYNAMIC BROADSHEET)
app.post('/api/v1/admin/import/results', verifyAdmin, async (req, res) => {
    try {
        const TenantUser = req.tenantDb.model('User', userSchema);
        const TenantResult = req.tenantDb.models.Result || req.tenantDb.model('Result', resultSchema);

        const { records } = req.body; 
        if (!records || records.length === 0) return res.status(400).json({ error: "No academic records provided for import." });

        let successCount = 0; let skippedCount = 0;

        for (let row of records) {
            try {
                const sysId = String(row.Student_ID || row.ID || '').trim();
                const session = String(row.Session || '').trim();
                const term = String(row.Term || '').trim();

                if (!sysId || !session || !term) continue; // Skip totally blank rows

                // 1. Locate the Student
                const student = await TenantUser.findOne({ 
                    systemId: new RegExp('^' + sysId + '$', 'i') 
                });

                if (!student) { skippedCount++; continue; }

                // 2. Find or Create the Term Record
                let reportCard = await TenantResult.findOne({ studentId: student._id, session: session, term: term });
                if (!reportCard) {
                    reportCard = new TenantResult({ studentId: student._id, session, term, publishStage: 'Full', records: [] });
                }

                // 📅 3. Inject Historical Attendance
                if (row.Days_Opened) reportCard.maxAttendance = Number(row.Days_Opened) || 0;
                if (row.Days_Present) reportCard.attendance = Number(row.Days_Present) || 0;

                // 📚 4. Dynamic Subject Parser (The Broadsheet Engine)
                const subjectsMap = {};
                for (const [key, value] of Object.entries(row)) {
                    // Look for columns like "Mathematics_CA1", "English_Exam", etc.
                    if (key.includes('_CA1') || key.includes('_CA2') || key.includes('_Exam')) {
                        const lastUnderscore = key.lastIndexOf('_');
                        const subjectName = key.substring(0, lastUnderscore).replace(/_/g, ' ').trim();
                        const scoreType = key.substring(lastUnderscore + 1).toLowerCase(); // 'ca1', 'ca2', 'exam'

                        if (!subjectsMap[subjectName]) subjectsMap[subjectName] = { ca1: 0, ca2: 0, exam: 0 };
                        subjectsMap[subjectName][scoreType] = Number(value) || 0;
                    }
                }

                // 5. Apply Parsed Subjects to the Report Card
                for (const [subjectName, scores] of Object.entries(subjectsMap)) {
                    const totalScore = scores.ca1 + scores.ca2 + scores.exam;
                    let subjectIndex = reportCard.records.findIndex(r => r.subject.toLowerCase() === subjectName.toLowerCase());
                    
                    if (subjectIndex > -1) {
                        reportCard.records[subjectIndex].ca1 = scores.ca1;
                        reportCard.records[subjectIndex].ca2 = scores.ca2;
                        reportCard.records[subjectIndex].exam = scores.exam;
                        reportCard.records[subjectIndex].score = totalScore;
                    } else {
                        reportCard.records.push({ 
                            subject: subjectName, ca1: scores.ca1, ca2: scores.ca2, exam: scores.exam, score: totalScore 
                        });
                    }
                }

                // Force publish so it appears on the Student/Parent portal immediately
                reportCard.publishStage = 'Full';
                await reportCard.save();
                successCount++;

            } catch (err) { skippedCount++; }
        }

        logSystemAction(req, 'ACADEMIC', `Migrated broadsheet academic records for ${successCount} students.`);
        res.status(200).json({ success: true, message: "Academic Migration Complete!", details: { imported: successCount, skipped: skippedCount } });

    } catch (error) {
        res.status(500).json({ error: "System failed to process the legacy academic data." });
    }
});

app.put('/api/v1/results/bulk-publish', verifyAdmin, async (req, res) => {
    try {
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantResult = req.tenantDb.models.Result || req.tenantDb.model('Result', resultSchema);

        const { targetClass, session, term, publishStage } = req.body;
        const students = await TenantApplication.find({ targetClass: targetClass, status: 'Admitted' });
        const studentIds = students.map(s => s.linkedStudentId).filter(id => id !== null);
        
        if(studentIds.length === 0) return res.status(404).json({ error: "No active students found in this class." });
        
        await TenantResult.updateMany({ studentId: { $in: studentIds }, session: session, term: term }, { $set: { publishStage: publishStage } });
        
        logSystemAction(req, 'ACADEMIC', `Bulk published [${publishStage}] results for ${targetClass}`);

        // 🚀 AUTOMATED BOT: Announce Published Results
        if (publishStage !== 'Draft') {
            const TenantMessage = req.tenantDb.model('Message', messageSchema);
            const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
            const settings = await TenantSettings.findOne() || {};
            const dynamicSchoolName = settings.schoolName || 'Automated System';
            let stageText = publishStage === 'Full' ? 'Final Term Report Cards' : (publishStage === 'CA2' ? '2nd CA Test Results' : '1st CA Test Results');
            
            const sysMsg = new TenantMessage({
                senderId: 'SYSTEM_BOT',
                senderName: dynamicSchoolName,
                senderRole: 'System Bot',
                targetId: 'ALL',
                targetName: targetClass,
                targetRole: `Broadcast - ${targetClass}`,
                subject: `🎓 Academic Results Published: ${stageText}`,
                message: `The ${stageText} for the ${term} term (${session}) have been officially published. You can now view your grades in the Academic Performance section.`,
                isReadByTarget: false,
                isReadBySender: true
            });
            await sysMsg.save();
        }

        res.json({ success: true, message: `Successfully updated! All ${targetClass} results for ${term} term are now set to [${publishStage}].` });
    } catch (error) { res.status(500).json({ error: "Failed to update publish status." }); }
});

// 📊 ENTERPRISE BROADSHEET ENGINE
app.get('/api/v1/admin/broadsheet/:className', verifyToken, async (req, res) => {
    try {
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantResult = req.tenantDb.models.Result || req.tenantDb.model('Result', resultSchema);
        const TenantStructure = req.tenantDb.model('Structure', structureSchema);

        const { className } = req.params;
        const { session, term } = req.query; 
        if (!session || !term) return res.status(400).json({ error: "Session and Term required" });

        const struct = await TenantStructure.findOne();
        const classroom = struct.classrooms.find(c => c.displayName === className);
        const subjects = classroom ? classroom.subjects : [];

        const students = await TenantApplication.find({ targetClass: className, status: 'Admitted' }).lean();
        const studentIds = students.map(s => s.linkedStudentId);

        const results = await TenantResult.find({ studentId: { $in: studentIds }, session, term }).lean();

        let broadsheetData = students.map(s => {
            const resDoc = results.find(r => r.studentId.toString() === s.linkedStudentId.toString());
            let row = { studentName: s.studentName, systemId: s.systemId, scores: {}, grandTotal: 0, avg: 0, subjectCount: 0 };

            subjects.forEach(sub => {
                const subRecord = resDoc ? resDoc.records.find(r => r.subject === sub) : null;
                const total = subRecord ? (Number(subRecord.ca1 || 0) + Number(subRecord.ca2 || 0) + Number(subRecord.exam || 0)) : 0;
                row.scores[sub] = subRecord ? total : '-';
                if(subRecord) { row.grandTotal += total; row.subjectCount++; }
            });
            row.avg = row.subjectCount > 0 ? (row.grandTotal / row.subjectCount).toFixed(1) : 0;
            return row;
        });

        broadsheetData.sort((a, b) => b.grandTotal - a.grandTotal);
        broadsheetData = broadsheetData.map((row, index) => ({ ...row, position: index + 1 }));

        res.json({ subjects, data: broadsheetData });
    } catch (error) { res.status(500).json({ error: "Broadsheet calculation failed." }); }
});

// ⚡ HIGH-SPEED BULK REPORT DATA ROUTE
app.get('/api/v1/admin/bulk-report-data/:className', verifyToken, async (req, res) => {
    try {
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantResult = req.tenantDb.models.Result || req.tenantDb.model('Result', resultSchema);
        
        const { className } = req.params;
        const { session, term } = req.query;

        const students = await TenantApplication.find({ targetClass: className, status: 'Admitted' })
                                .select('studentName linkedStudentId passportPhoto systemId dateOfBirth targetClass').lean();
        const studentIds = students.map(s => s.linkedStudentId);

        const allResults = await TenantResult.find({ studentId: { $in: studentIds }, session, term }).lean();
        res.json({ students, results: allResults });
    } catch (error) { res.status(500).json({ error: "Bulk fetch failed" }); }
});

app.get('/api/v1/admin/grading-status', verifyAdmin, async (req, res) => {
    try {
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
        const TenantStructure = req.tenantDb.model('Structure', structureSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantResult = req.tenantDb.models.Result || req.tenantDb.model('Result', resultSchema);

        const settings = await TenantSettings.findOne() || {};
        const session = settings.activeSession || "2025/2026"; 
        const term = settings.activeTerm || "First";
        const structure = await TenantStructure.findOne() || { classrooms: [] };
        
        const apps = await TenantApplication.find({ status: 'Admitted' });
        const results = await TenantResult.find({ session: session, term: term });
        
        let classData = {};
        apps.forEach(app => {
            const c = app.targetClass;
            if(!classData[c]) {
                classData[c] = { totalStudents: 0, expectedSubjectUploads: 0, actualSubjectUploads: 0, formMasterProcessed: 0, subjectBreakdown: {} };
                const classObj = structure.classrooms.find(cls => cls.displayName === c);
                if (classObj && classObj.subjects) { classObj.subjects.forEach(sub => { classData[c].subjectBreakdown[sub] = 0; }); }
            }
            classData[c].totalStudents++;
            const classObj = structure.classrooms.find(cls => cls.displayName === c);
            const expectedSubjCount = classObj && classObj.subjects ? classObj.subjects.length : 0;
            classData[c].expectedSubjectUploads += expectedSubjCount;
            
            const studentResult = results.find(r => r.studentId.toString() === app.linkedStudentId.toString());
            if(studentResult) {
                classData[c].actualSubjectUploads += studentResult.records.length;
                studentResult.records.forEach(rec => {
                    if (classData[c].subjectBreakdown[rec.subject] !== undefined) { classData[c].subjectBreakdown[rec.subject]++; } 
                    else { classData[c].subjectBreakdown[rec.subject] = 1; }
                });
                if(studentResult.remarks || studentResult.attendance > 0 || studentResult.principalRemarks) { classData[c].formMasterProcessed++; }
            }
        });
        res.json({ session, term, classes: classData });
    } catch(e) { res.status(500).json({ error: "Failed to load tracking data." }); }
});

app.get('/api/v1/attendance/stats/:className/:studentId', verifyTeacherOrAdmin, async (req, res) => {
    try {
        const TenantAttendance = req.tenantDb.model('Attendance', attendanceSchema);
        const { className, studentId } = req.params;
        const records = await TenantAttendance.find({ className, studentId });
        let sessionCount = 0;
        records.forEach(r => {
            if(r.status === 'Present') sessionCount += 0.5;
            if(r.afternoonStatus === 'Present') sessionCount += 0.5;
        });
        const distinctDates = await TenantAttendance.distinct("date", { className });
        res.json({ totalDays: distinctDates.length, daysPresent: Math.ceil(sessionCount) });
    } catch (error) { res.status(500).json({ error: "Failed to calculate attendance stats." }); }
});

// ==========================================
// 📊 STUDENT ATTENDANCE API (STRICT DUAL-SESSION ENGINE + AUTO EMAIL)
// ==========================================
app.post('/api/v1/attendance', verifyToken, async (req, res) => {
    try {
        const TenantAttendance = req.tenantDb.model('Attendance', attendanceSchema);
        const TenantSubscription = req.tenantDb.model('Subscription', subscriptionSchema);
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);

        const { className, date, session, records } = req.body; 
        
        for (let rec of records) {
            const fieldToUpdate = (session === 'Morning') ? 'status' : 'afternoonStatus';
            await TenantAttendance.findOneAndUpdate(
                { studentId: rec.studentId, date: date },
                { $set: { className, [fieldToUpdate]: rec.status } },
                { upsert: true }
            );
        }

        // Auto-Emailer Engine (Background)
        (async () => {
            try {
                const sub = await TenantSubscription.findOne();
                if (sub && sub.planTier !== 'Basic') {
                    const settings = await TenantSettings.findOne();
                    const absentees = records.filter(r => r.status === 'Absent');
                    for (let rec of absentees) {
                        const app = await TenantApplication.findOne({ linkedStudentId: rec.studentId });
                        if (app && app.parentEmail) {
                            let subjectTemplate = settings.absentEmailSubject || "Attendance Alert: {studentName}";
                            let bodyTemplate = settings.absentEmailBody || "Dear Parent, this is to inform you that {studentName} was marked ABSENT from {className} today, {date}.";
                            const finalSubject = subjectTemplate.replace(/{studentName}/gi, app.studentName);
                            const finalBody = bodyTemplate.replace(/{studentName}/gi, `<strong>${app.studentName}</strong>`).replace(/{className}/gi, `<strong>${className}</strong>`).replace(/{date}/gi, `<strong>${date}</strong>`);
                            
                            await sendSchoolEmail(req, {
                                to: app.parentEmail,
                                subject: finalSubject,
                                html: `<div style="font-family:sans-serif; padding:20px;"><h3>Official Attendance Notice</h3><p>${finalBody}</p></div>`
                            });
                        }
                    }
                }
            } catch (emailError) {}
        })();

        res.json({ success: true, message: `Register saved.` });
    } catch (error) { res.status(500).json({ error: "Sync failed" }); }
});

// 📊 ATTENDANCE HISTORY ENGINE (ROCK SOLID)
app.get('/api/v1/attendance/history/:className', verifyToken, async (req, res) => {
    try {
        const TenantAttendance = req.tenantDb.model('Attendance', attendanceSchema);
        const history = await TenantAttendance.find({ className: req.params.className }).lean();
        res.json(history || []);
    } catch (error) { res.status(500).json({ error: "Database lookup failed" }); }
});

app.get('/api/v1/attendance/:className/:date', verifyTeacherOrAdmin, async (req, res) => {
    try { 
        const TenantAttendance = req.tenantDb.model('Attendance', attendanceSchema);
        const records = await TenantAttendance.find({ className: req.params.className, date: req.params.date }); 
        res.json(records); 
    } catch (error) { res.status(500).json({ error: "Failed to load attendance register." }); }
});

// ==========================================
// PARENT/STUDENT SECURE ATTENDANCE ROUTE
// ==========================================
app.get('/api/v1/my-attendance/:studentId', verifyToken, async (req, res) => {
    try {
        const TenantAttendance = req.tenantDb.model('Attendance', attendanceSchema);
        const { studentId } = req.params;
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) return res.status(400).json({ error: "Missing date range" });
        const records = await TenantAttendance.find({ studentId: studentId, date: { $gte: startDate, $lte: endDate } });
        res.json(records);
    } catch (error) { res.status(500).json({ error: "Failed to fetch attendance records" }); }
});

// 🚀 ROUTE: Admin Reset Parent Password (WITH SAAS & AUTO-UNLOCK)
app.put('/api/v1/admin/parents/reset-password', verifyAdmin, async (req, res) => {
    try {
        // 🚀 SAAS FIX: Bind to specific database
        const TenantUser = req.tenantDb.model('User', userSchema);
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);

        const { email } = req.body;
        if (!email) return res.status(400).json({ error: "Email is required." });

        const cleanEmail = email.toLowerCase().trim();

        // 🚀 THE FIX: Strictly target the Parent account so we don't accidentally reset the Student!
        const user = await TenantUser.findOne({ 
            email: new RegExp('^' + cleanEmail + '$', 'i'),
            role: 'Parent' 
        });
        
        if (!user) {
            return res.status(404).json({ error: `Parent account not found for: ${cleanEmail}` });
        }

        // Fetch the default parent password from settings
        let settings = await TenantSettings.findOne() || {};
        const defaultPass = settings.defaultParentPassword || "Parent123!"; 

        const bcrypt = require('bcrypt'); 
        user.password = await bcrypt.hash(defaultPass, 10);
        
        // 🚀 THE LOCKOUT FIX: Instantly forgive all strikes so they can log in immediately
        user.loginAttempts = 0;
        user.lockUntil = undefined;
        user.lockCount = 0;

        await user.save();

        logSystemAction(req, 'SECURITY', `Reset Parent Portal password for email: ${user.email}`);

        res.json({ message: `Password for ${user.email} has been successfully reset to: ${defaultPass}. All security lockouts have been cleared.` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error resetting password." });
    }
});

// 🚀 SAAS FIX: Secure Password Update
app.put('/api/v1/users/:id/password', verifyToken, async (req, res) => {
    try {
        const TenantUser = req.tenantDb.model('User', userSchema);
        
        const user = await TenantUser.findById(req.params.id);
        if (!user) return res.status(404).json({ error: "User not found" });

        const isMatch = await bcrypt.compare(req.body.oldPassword, user.password);
        if (!isMatch) return res.status(400).json({ error: "Incorrect current password" });

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(req.body.newPassword, salt);
        await user.save();
        
        res.json({ success: true, message: "Password updated securely." });
    } catch (error) { 
        console.error("Password Update Error:", error);
        res.status(500).json({ error: "System failed to update password." }); 
    }
});

// 🚀 ROUTE: Update User Profile Photo
app.put('/api/v1/users/:id/photo', verifyToken, async (req, res) => {
    try {
        const TenantUser = req.tenantDb.model('User', userSchema);
        const user = await TenantUser.findById(req.params.id);
        if (!user) return res.status(404).json({ error: "User not found." });

        // 🛡️ SECURITY: Only allow users to update their own photo, or Super Admins to update anyone
        if (req.user.id !== req.params.id && req.user.role !== 'Super Admin') {
            return res.status(403).json({ error: "Access Denied." });
        }

        // ☁️ CLOUDINARY INTERCEPTOR
        let securePhotoUrl = req.body.photo;
        if (securePhotoUrl && !securePhotoUrl.startsWith('http')) {
            securePhotoUrl = await uploadToCloudinary(securePhotoUrl, 'staff_passports');
        }

        user.photo = securePhotoUrl;
        await user.save();

        res.json({ success: true, message: "Profile picture updated successfully!", photo: user.photo });
    } catch (error) {
        console.error("Photo Update Error:", error);
        res.status(500).json({ error: "Failed to update profile picture." });
    }
});

// 🚀 ROUTE: Update User Profile (Name & Email)
app.put('/api/v1/users/:id/profile', verifyToken, async (req, res) => {
    try {
        const TenantUser = req.tenantDb.model('User', userSchema);
        const user = await TenantUser.findById(req.params.id);
        if (!user) return res.status(404).json({ error: "User not found." });

        // 🛡️ SECURITY: Only allow users to update their own profile
        if (req.user.id !== req.params.id && req.user.role !== 'Super Admin') {
            return res.status(403).json({ error: "Access Denied." });
        }

        const { fullName, email } = req.body;
        
        // Check if email is being changed and if it's already taken
        if (email && email.toLowerCase() !== user.email.toLowerCase()) {
            const existing = await TenantUser.findOne({ email: new RegExp('^' + email.trim() + '$', 'i') });
            if (existing) return res.status(400).json({ error: "Email is already in use by another account." });
            user.email = email.toLowerCase().trim();
        }

        if (fullName) user.fullName = fullName.trim();

        await user.save();

        res.json({ success: true, message: "Profile updated successfully!", user: { name: user.fullName, email: user.email } });
    } catch (error) {
        console.error("Profile Update Error:", error);
        res.status(500).json({ error: "Failed to update profile." });
    }
});

app.get('/api/v1/setup-admin', async (req, res) => {
    try {
        // 🚀 SAAS FIX: Use the specific tenant database for this subdomain!
        const TenantUser = req.tenantDb.model('User', userSchema);

        const salt = await bcrypt.genSalt(10); 
        const hashedPassword = await bcrypt.hash('AdminPass2026!', salt);
        
        await TenantUser.deleteMany({ role: 'Super Admin' });
        
        const admin = new TenantUser({ 
            email: 'superadmin@vertex.com', 
            password: hashedPassword, 
            fullName: 'System Owner', 
            role: 'Super Admin',
            accountStatus: 'Active'
        });
        
        await admin.save();
        const userCount = await TenantUser.countDocuments();

        res.json({ 
            success: true, 
            message: "SUPER ADMIN FORCE-CREATED SUCCESSFULLY!",
            useThisEmail: "superadmin@vertex.com", 
            useThisPassword: "AdminPass2026!",
            databaseCurrentlyConnected: req.tenantDb.name, // 🚀 Will dynamically print 'school_foundation'
            totalUsersInThisDB: userCount
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 🚀 SAAS FIX: Admin Password Reset (Hashes password & unlocks account)
app.put('/api/v1/users/:id/reset-password', verifyAdmin, async (req, res) => {
    try {
        const TenantUser = req.tenantDb.model('User', userSchema);
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
        
        const user = await TenantUser.findById(req.params.id);
        if (!user) return res.status(404).json({ error: "User not found." });

        const settings = await TenantSettings.findOne() || {};
        
        // 🚀 THE FIX: Check against ALL Staff and Admin roles
        const staffRoles = ['Super Admin', 'Admin', 'Principal', 'Bursar', 'Assistant Admin', 'Assistant Bursar', 'Teacher', 'Staff'];
        
        let defaultPass = settings.defaultStudentPassword || "Student123!";
        if (staffRoles.includes(user.role)) {
            defaultPass = settings.defaultStaffPassword || "Staff123!";
        } else if (user.role === 'Parent') {
            defaultPass = settings.defaultParentPassword || "Parent123!";
        }

        // 1. Properly Hash the new password so the login system accepts it
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(defaultPass, salt);

        // 2. Erase the 15-minute security lockout!
        user.loginAttempts = 0;
        user.lockUntil = undefined;

        await user.save();
        
        logSystemAction(req, 'SECURITY', `Admin manually reset password and unlocked account for ${user.fullName}`);
        
        res.json({ 
            success: true, 
            message: `Account unlocked! Password reset to the default: ${defaultPass}` 
        });
    } catch (error) {
        console.error("Admin Reset Error:", error);
        res.status(500).json({ error: "Failed to reset password." });
    }
});

// ==========================================
// 🚀 AUTOMATED TERM-END ROLLOVER ENGINE
// ==========================================
// 🚀 SAAS FIX: Automated Term-End Bulk Rollover
app.put('/api/v1/admin/rollover-bulk', verifyAdmin, async (req, res) => {
    try {
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);

        const { appIds, action } = req.body; 
        
        if (!appIds || !Array.isArray(appIds) || appIds.length === 0 || !action) {
            return res.status(400).json({ error: "Missing required data for rollover." });
        }

        let updateQuery = {};
        
        // 1. Send to Alumni
        if (action === 'Graduate') updateQuery = { status: 'Graduated' };
        // 2. Withdraw from school
        else if (action === 'Archive') updateQuery = { status: 'Archived' };
        // 3. Promote to a new class
        else updateQuery = { targetClass: action, status: 'Admitted' };

        // Execute bulk update in the tenant DB
        const result = await TenantApplication.updateMany(
            { _id: { $in: appIds } },
            { $set: updateQuery }
        );

        // 🚀 THE PHANTOM DEBT FIX: Wipe out unpaid expected income for the whole batch!
        if (action === 'Archive' || action === 'Graduate') {
            const apps = await TenantApplication.find({ _id: { $in: appIds } });
            const studentIds = apps.map(a => a.linkedStudentId).filter(id => id);
            const TenantInvoice = req.tenantDb.model('Invoice', invoiceSchema);
            await TenantInvoice.deleteMany({ studentId: { $in: studentIds }, status: 'Unpaid' });
        }

        logSystemAction(req, 'ACADEMIC', `Bulk rolled over ${result.modifiedCount} students. Action: ${action}`);
        res.json({ success: true, message: `Success! ${result.modifiedCount} students have been successfully moved.` });
    } catch (error) {
        console.error("Rollover Engine Error:", error);
        res.status(500).json({ error: "Failed to execute bulk rollover. Please check server logs." });
    }
});

// ==========================================
// 6. STAFF DIRECTORY
// ==========================================
// 🚀 SAAS FIX: Teacher's Form Class Students Route
app.get('/api/v1/teacher/mystudents/:className', verifyToken, async (req, res) => {
    try {
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);

        const classArray = req.params.className.split(',').map(c => c.trim()); 
        const students = await TenantApplication.find({ targetClass: { $in: classArray }, status: 'Admitted' });
        res.json(students);
    } catch (error) { 
        res.status(500).json({ error: "Failed to fetch class list." }); 
    }
});

app.post('/api/v1/admin/teachers', verifyAdmin, async (req, res) => {
    try {
        // 🚀 SAAS FIX: Bind to specific database
        const TenantUser = req.tenantDb.model('User', userSchema);
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);

        const adminRoles = ['Super Admin', 'Admin', 'Principal', 'Bursar', 'Assistant Admin', 'Assistant Bursar'];
        
        if (req.user.role !== 'Super Admin' && adminRoles.includes(req.body.role)) {
            return res.status(403).json({ error: "Access Denied: Only the Super Admin can create administrative accounts." });
        }

        const primaryRoles = ['Principal', 'Admin', 'Bursar'];
        if (req.user.role === 'Super Admin' && primaryRoles.includes(req.body.role)) {
            const existingPrimary = await TenantUser.findOne({ role: req.body.role, accountStatus: { $ne: 'Archived' } });
            if (existingPrimary) {
                return res.status(400).json({ error: `A primary ${req.body.role} already exists (${existingPrimary.fullName}). Please use the 'Assistant' role.` });
            }
        }

        const staffRoles = ['Super Admin', 'Admin', 'Principal', 'Bursar', 'Assistant Admin', 'Assistant Bursar', 'Teacher', 'Staff'];
        const existingStaffEmail = await TenantUser.findOne({ 
            email: new RegExp('^' + req.body.email.trim() + '$', 'i'), 
            role: { $in: staffRoles } 
        });
        
        if (existingStaffEmail) {
            if (existingStaffEmail.accountStatus === 'Archived') {
                return res.status(400).json({ error: `A deactivated staff account already uses this email. Please restore them or use a different email.` });
            } else {
                return res.status(400).json({ error: `An active staff member is already using this email address.` });
            }
        }

        let rawSubj = req.body.subjectsAssigned;
        let rawClass = req.body.classAssigned;
        let subjArray = Array.isArray(rawSubj) ? rawSubj : (rawSubj ? String(rawSubj).split(',') : []);
        let classArray = Array.isArray(rawClass) ? rawClass : (rawClass ? String(rawClass).split(',') : []);
        let cleanSubjects = subjArray.map(s => s.trim()).filter(s => s).join(', ');
        let cleanClasses = classArray.map(c => c.trim()).filter(c => c).join(', ');
        let cleanFormClass = req.body.formClass ? String(req.body.formClass).trim() : "";

        if (cleanFormClass) {
            const existingFormMaster = await TenantUser.findOne({
                formClass: cleanFormClass,
                accountStatus: { $ne: 'Archived' }
            });
            if (existingFormMaster) {
                return res.status(400).json({ error: `SYSTEM LOCK: ${existingFormMaster.fullName} is already the Form Master for ${cleanFormClass}.` });
            }
        }

        let incomingSubjectsArr = cleanSubjects ? cleanSubjects.split(', ') : [];
        let incomingClassesArr = cleanClasses ? cleanClasses.split(', ') : [];

        if (incomingSubjectsArr.length > 0 && incomingClassesArr.length > 0) {
            const otherTeachers = await TenantUser.find({
                accountStatus: { $ne: 'Archived' },
                subjectsAssigned: { $exists: true, $ne: "" },
                classAssigned: { $exists: true, $ne: "" }
            });

            for (let other of otherTeachers) {
                const otherSubjects = other.subjectsAssigned ? other.subjectsAssigned.split(',').map(s => s.trim()) : [];
                const otherClasses = other.classAssigned ? other.classAssigned.split(',').map(c => c.trim()) : [];

                const overlappingClasses = incomingClassesArr.filter(c => otherClasses.includes(c));
                const overlappingSubjects = incomingSubjectsArr.filter(s => otherSubjects.includes(s));

                if (overlappingClasses.length > 0 && overlappingSubjects.length > 0) {
                    return res.status(400).json({ error: `SYSTEM LOCK: ${other.fullName} is already assigned to teach ${overlappingSubjects.join(' & ')} in ${overlappingClasses.join(', ')}.` });
                }
            }
        }

        let settings = await TenantSettings.findOne() || new TenantSettings();
        const isTeachingRole = ['Teacher', 'Subject Teacher', 'Class Teacher', 'Both'].includes(req.body.role);
        const isAdminRole = ['Super Admin', 'Admin', 'Principal', 'Bursar', 'Assistant Admin', 'Assistant Bursar'].includes(req.body.role);
        
        let idType = isTeachingRole ? 'Teacher' : (isAdminRole ? 'Admin' : 'Staff');
        
        // 🚀 SAAS FIX: Pass req to the ID generator
        const sysId = await generateSystemId(req, idType);
        
        const safePassword = settings.defaultStaffPassword || "Staff123!";
        const salt = await bcrypt.genSalt(10); const hashedPassword = await bcrypt.hash(safePassword, salt);
        
        const newStaff = new TenantUser({ 
            fullName: req.body.fullName, 
            email: req.body.email, 
            password: hashedPassword, 
            role: req.body.role || 'Teacher', 
            systemId: sysId, 
            jobTitle: req.body.jobTitle || "Staff", 
            classAssigned: cleanClasses, 
            subjectsAssigned: cleanSubjects, 
            teacherType: req.body.teacherType || "Both", 
            formClass: cleanFormClass, 
            photo: req.body.photo
        });
        await newStaff.save(); 
        
        // 🛡️ AUDIT TRAIL: Log New Staff Creation
        logSystemAction(req, 'ADMINISTRATION', `Created new staff account: ${req.body.fullName} (${req.body.role || 'Teacher'})`);
        
        res.status(201).json({ success: true, message: "Staff account created! They can log in with the Default Staff Password." });
    } catch (error) { 
        console.error("Create Staff Error:", error);
        res.status(500).json({ error: error.message || "Failed to create account." }); 
    }
});

app.get('/api/v1/admin/teachers', verifyAdmin, async (req, res) => {
    try { 
        if (!req.user || !req.user.role) return res.json([]);

        // 🚀 SAAS FIX: Bind the User model to the specific school database
        const TenantUser = req.tenantDb.model('User', userSchema);

        if (req.user.role === 'Bursar') return res.json([]); 

        if (req.user.role === 'Principal' || req.user.role === 'Admin') {
            const staff = await TenantUser.find({ 
                role: { $in: ['Teacher', 'Staff', 'Bursar', 'Admin', 'Principal'] }, 
                accountStatus: { $ne: 'Archived' } 
            }).select('-password'); 
            return res.json(staff);
        }

        if (req.user.role === 'Super Admin') {
            const staff = await TenantUser.find({ 
                // 🚀 THE FIX: Added 'Parent' to the exclusion list!
                role: { $nin: ['Student', 'Applicant', 'Parent'] }, 
                accountStatus: { $ne: 'Archived' } 
            }).select('-password'); 
            return res.json(staff);
        }

        res.json([]);
    } catch (error) { 
        console.error("🔥 Backend Route Error:", error); 
        res.status(500).json({ error: "Failed to fetch staff directory." }); 
    }
});

// SOFT DELETE A STAFF MEMBER (Moves them to Recycle Bin)
app.delete('/api/v1/admin/teachers/:id', verifyAdmin, async (req, res) => {
    try { 
        // 🚀 THE SAAS FIX: Bind to the specific school database
        const TenantUser = req.tenantDb.model('User', userSchema);

        const staff = await TenantUser.findById(req.params.id);
        if(!staff) return res.status(404).json({ error: "Staff not found." });
        
        staff.accountStatus = 'Archived';
        await staff.save();
        
        // 🔒 THE BLACK BOX: Catch Staff Deletion
        logSystemAction(req, 'SECURITY', `Deactivated (Soft Deleted) staff member: ${staff.fullName} (${staff.role})`);
        
        res.json({ success: true, message: "Staff account successfully deactivated and archived." }); 
    } 
    catch (error) { res.status(500).json({ error: "Failed to delete staff." }); }
});

// RESTORE A STAFF MEMBER
app.put('/api/v1/admin/teachers/:id/restore', verifyAdmin, async (req, res) => {
    try { 
        // 🚀 THE SAAS FIX: Bind to the specific school database
        const TenantUser = req.tenantDb.model('User', userSchema);

        const staff = await TenantUser.findById(req.params.id);
        if(!staff) return res.status(404).json({ error: "Staff not found." });
        
        staff.accountStatus = 'Active';
        await staff.save();
        
        // 🔒 THE BLACK BOX: Catch Staff Restoration
        logSystemAction(req, 'SECURITY', `Restored previously archived staff member: ${staff.fullName} (${staff.role})`);
        
        res.json({ success: true, message: "Staff account successfully restored to Active status!" }); 
    } 
    catch (error) { res.status(500).json({ error: "Failed to restore staff." }); }
});

// GET ARCHIVED STAFF (For Super Admins to view the Recycle Bin)
app.get('/api/v1/admin/archived-staff', verifyAdmin, async (req, res) => {
    try {
        if (req.user.role !== 'Super Admin' && req.user.role !== 'Principal') return res.json([]);
        // 🚀 THE SAAS FIX: Bind to the specific school database
        const TenantUser = req.tenantDb.model('User', userSchema);
        const archivedStaff = await TenantUser.find({ accountStatus: 'Archived' }).select('-password');
        res.json(archivedStaff);
    } catch (err) { res.status(500).json({ error: "Failed to fetch archived staff." }); }
});

app.put('/api/v1/admin/teachers/:id/classes', verifyAdmin, async (req, res) => {
    try {
        // 🚀 THE SAAS FIX: Bind to the specific school database
        const TenantUser = req.tenantDb.model('User', userSchema);

        // 1. Safely parse incoming data whether it's an Array, String, or Empty
        let rawSubj = req.body.subjectsAssigned;
        let rawClass = req.body.classAssigned;
        
        let subjArray = Array.isArray(rawSubj) ? rawSubj : (rawSubj ? String(rawSubj).split(',') : []);
        let classArray = Array.isArray(rawClass) ? rawClass : (rawClass ? String(rawClass).split(',') : []);
        
        // 2. Convert to clean, comma-separated strings (Empty arrays become "")
        let cleanSubjects = subjArray.map(s => s.trim()).filter(s => s).join(', ');
        let cleanClasses = classArray.map(c => c.trim()).filter(c => c).join(', ');
        let cleanFormClass = req.body.formClass ? String(req.body.formClass).trim() : "";
        
        const excludeIdQuery = { _id: { $ne: req.params.id } };

        // 🛑 3. FORM MASTER COLLISION CHECK
        if (cleanFormClass) {
            const existingFormMaster = await TenantUser.findOne({
                ...excludeIdQuery,
                formClass: cleanFormClass,
                accountStatus: { $ne: 'Archived' }
            });
            if (existingFormMaster) {
                return res.status(400).json({ error: `SYSTEM LOCK: ${existingFormMaster.fullName} is already the Form Master for ${cleanFormClass}.` });
            }
        }

        // 🛑 4. SUBJECT TEACHER COLLISION CHECK
        let incomingSubjectsArr = cleanSubjects ? cleanSubjects.split(', ') : [];
        let incomingClassesArr = cleanClasses ? cleanClasses.split(', ') : [];

        if (incomingSubjectsArr.length > 0 && incomingClassesArr.length > 0) {
            const otherTeachers = await TenantUser.find({
                ...excludeIdQuery,
                accountStatus: { $ne: 'Archived' },
                subjectsAssigned: { $exists: true, $ne: "" },
                classAssigned: { $exists: true, $ne: "" }
            });

            for (let other of otherTeachers) {
                const otherSubjects = other.subjectsAssigned ? other.subjectsAssigned.split(',').map(s => s.trim()) : [];
                const otherClasses = other.classAssigned ? other.classAssigned.split(',').map(c => c.trim()) : [];

                const overlappingClasses = incomingClassesArr.filter(c => otherClasses.includes(c));
                const overlappingSubjects = incomingSubjectsArr.filter(s => otherSubjects.includes(s));

                if (overlappingClasses.length > 0 && overlappingSubjects.length > 0) {
                    return res.status(400).json({ error: `SYSTEM LOCK: ${other.fullName} is already assigned to teach ${overlappingSubjects.join(' & ')} in ${overlappingClasses.join(', ')}.` });
                }
            }
        }

        // 🚀 5. THE FIX: Save using the clean strings AND the Role!
        const updateData = { 
            classAssigned: cleanClasses, 
            subjectsAssigned: cleanSubjects, 
            teacherType: req.body.teacherType || "Both", 
            formClass: cleanFormClass, 
            jobTitle: req.body.jobTitle 
        };
        
        // Let the backend accept Role changes from the Admin panel!
        if (req.body.role) updateData.role = req.body.role;
        if (req.body.photo) updateData.photo = req.body.photo; 
        
        const updatedStaff = await TenantUser.findByIdAndUpdate(req.params.id, updateData, { new: true });
        
        // 🛡️ AUDIT TRAIL: Log Staff Role/Profile Edit
        logSystemAction(req, 'ADMINISTRATION', `Modified system permissions/profile for staff member: ${updatedStaff.fullName}`);
        
        res.json({ success: true, message: "Staff profile updated successfully." });
    } catch (error) { 
        console.error("Profile Update Crash:", error);
        res.status(500).json({ error: error.message || "Failed to update profile." }); 
    }
});

// ==========================================
// 7. BULK CLASS SCHEDULES & TIMETABLE (SAAS UPDATED)
// ==========================================

app.post('/api/v1/schedules', verifyTeacherOrAdmin, async (req, res) => {
    try { 
        const TenantSchedule = req.tenantDb.model('Schedule', scheduleSchema);
        const TenantMessage = req.tenantDb.model('Message', messageSchema);
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
        
        const newSched = new TenantSchedule(req.body); 
        await newSched.save(); 

        // 🚀 AUTOMATED BOT: Announce the new timetable to the students
        const settings = await TenantSettings.findOne() || {};
        const dynamicSchoolName = settings.schoolName || 'Automated System';
        
        const sysMsg = new TenantMessage({
            senderId: 'SYSTEM_BOT',
            senderName: dynamicSchoolName,
            senderRole: 'System Bot',
            targetId: 'ALL',
            targetName: req.body.className,
            targetRole: `Broadcast - ${req.body.className}`,
            subject: `📅 New Timetable Posted: ${req.body.title}`,
            message: `A new ${req.body.type} timetable has been posted for your class. Please check the "CA & Exam Timetable" section on your dashboard for details.`,
            isReadByTarget: false,
            isReadBySender: true
        });
        await sysMsg.save();

        res.status(201).json({ success: true, message: "Class schedule posted!" }); 
    } catch (error) { res.status(500).json({ error: "Failed to post schedule." }); }
});

app.get('/api/v1/schedules/:className', verifyToken, async (req, res) => {
    try {
        const TenantSchedule = req.tenantDb.model('Schedule', scheduleSchema);
        const classArray = req.params.className.split(',').map(c => c.trim()); 
        const schedules = await TenantSchedule.find({ className: { $in: classArray } }).sort({ createdAt: -1 });
        res.json(schedules);
    } catch (error) { res.status(500).json({ error: "Failed to fetch schedules." }); }
});

// ==========================================
// TIMETABLE ENGINE API (Standard & Premium Only)
// ==========================================

// 1. Fetch Timetable for a specific class
app.get('/api/v1/timetable/:className', verifyToken, requireFeature('timetable'), async (req, res) => {
    try {
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
        const TenantTimetable = req.tenantDb.model('Timetable', timetableSchema);

        const settings = await TenantSettings.findOne() || {};
        const session = settings.activeSession || "2025/2026";
        const term = settings.activeTerm || "First";

        let timetable = await TenantTimetable.findOne({ 
            className: req.params.className, session, term 
        });

        if (!timetable) {
            // Send an empty template if none exists
            return res.json({ className: req.params.className, schedule: [] });
        }
        res.json(timetable);
    } catch(e) { res.status(500).json({error: "Failed to fetch timetable"}); }
});

// 2. ADMIN: Save or Update a Timetable (WITH CONFLICT RESOLUTION)
app.post('/api/v1/timetable/:className', verifyAdmin, requireFeature('timetable'), async (req, res) => {
    try {
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
        const TenantTimetable = req.tenantDb.model('Timetable', timetableSchema);

        const { schedule } = req.body; 
        const className = req.params.className;
        
        const settings = await TenantSettings.findOne() || {};
        const session = settings.activeSession || "2025/2026";
        const term = settings.activeTerm || "First";

        // --- CONFLICT ENGINE START ---
        for (let dayData of schedule) {
            for (let period of dayData.periods) {
                if (period.type === 'Break' || !period.teacherName) continue;

                const conflict = await TenantTimetable.findOne({
                    className: { $ne: className }, 
                    session,
                    term,
                    schedule: {
                        $elemMatch: {
                            day: dayData.day,
                            periods: {
                                $elemMatch: {
                                    startTime: period.startTime,
                                    teacherName: period.teacherName
                                }
                            }
                        }
                    }
                });

                if (conflict) {
                    return res.status(400).json({
                        error: `🚨 CONFLICT DETECTED: ${period.teacherName} is already scheduled to teach ${conflict.className} on ${dayData.day} at ${period.startTime}.`
                    });
                }
            }
        }
        // --- CONFLICT ENGINE END ---

        let timetable = await TenantTimetable.findOne({ className, session, term });
        
        if (timetable) {
            timetable.schedule = schedule;
            await timetable.save();
        } else {
            timetable = new TenantTimetable({ className, session, term, schedule });
            await timetable.save();
        }

        logSystemAction(req, 'ACADEMIC', `Updated the official timetable for ${className}`);
        res.json({ success: true, message: "Timetable securely saved with zero conflicts!" });

    } catch (error) { res.status(500).json({ error: "Failed to save timetable" }); }
});

// ==========================================
// TIMETABLE ENGINE API (Standard & Premium Only)
// ==========================================

// 1. Fetch Timetable for a specific class
app.get('/api/v1/timetable/:className', verifyToken, requireFeature('timetable'), async (req, res) => {
    try {
        const settings = await Settings.findOne() || {};
        const session = settings.activeSession || "2025/2026";
        const term = settings.activeTerm || "First";

        let timetable = await Timetable.findOne({ 
            className: req.params.className, session, term 
        });

        if (!timetable) {
            // Send an empty template if none exists
            return res.json({ className: req.params.className, schedule: [] });
        }
        res.json(timetable);
    } catch(e) { res.status(500).json({error: "Failed to fetch timetable"}); }
});

// 2. ADMIN: Save or Update a Timetable (WITH CONFLICT RESOLUTION)
app.post('/api/v1/timetable/:className', verifyAdmin, requireFeature('timetable'), async (req, res) => {
    try {
        const { schedule } = req.body; // The complete grid for the week
        const className = req.params.className;
        
        const settings = await Settings.findOne() || {};
        const session = settings.activeSession || "2025/2026";
        const term = settings.activeTerm || "First";

        // --- CONFLICT ENGINE START ---
        // Before saving, we must check if any teacher is double-booked across the whole school
        for (let dayData of schedule) {
            for (let period of dayData.periods) {
                if (period.type === 'Break' || !period.teacherName) continue;

                // Look for ANY other class timetable in this session/term
                const conflict = await Timetable.findOne({
                    className: { $ne: className }, // Ignore the class we are currently editing
                    session,
                    term,
                    schedule: {
                        $elemMatch: {
                            day: dayData.day,
                            periods: {
                                $elemMatch: {
                                    startTime: period.startTime,
                                    teacherName: period.teacherName
                                }
                            }
                        }
                    }
                });

                if (conflict) {
                    return res.status(400).json({
                        error: `🚨 CONFLICT DETECTED: ${period.teacherName} is already scheduled to teach ${conflict.className} on ${dayData.day} at ${period.startTime}.`
                    });
                }
            }
        }
        // --- CONFLICT ENGINE END ---

        // If no conflicts, save the timetable!
        let timetable = await Timetable.findOne({ className, session, term });
        
        if (timetable) {
            timetable.schedule = schedule;
            await timetable.save();
        } else {
            timetable = new Timetable({ className, session, term, schedule });
            await timetable.save();
        }

        logSystemAction(req, 'ACADEMIC', `Updated the official timetable for ${className}`);
        res.json({ success: true, message: "Timetable securely saved with zero conflicts!" });

    } catch (error) { res.status(500).json({ error: "Failed to save timetable" }); }
});

// ==========================================
// 8. FINANCE & INVOICE ENGINE (SAAS UPDATED)
// ==========================================
app.post('/api/v1/invoices', verifyAdmin, async (req, res) => {
    try { 
        const TenantInvoice = req.tenantDb.model('Invoice', invoiceSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        
        // 🚀 THE FIX: Capture invoiceType
        const { studentId, title, session, term, breakdown, invoiceType } = req.body;
        
        // 🛡️ BULLETPROOF IDEMPOTENCY LOCK
        const existingInvoices = await TenantInvoice.find({ studentId, session, term });
        const cleanTitle = title.trim().toLowerCase();
        const isDuplicate = existingInvoices.some(inv => inv.title.trim().toLowerCase() === cleanTitle);
        
        if (isDuplicate) {
            return res.status(400).json({ error: `Duplicate Alert: This student has already been billed for "${title}" this term.` });
        }
        
        let totalAmount = 0; if(breakdown && breakdown.length > 0) { breakdown.forEach(item => totalAmount += Number(item.amount)); }
        
        const newInvoice = new TenantInvoice({ 
            studentId, title, session, term, 
            invoiceType: invoiceType || 'Core', // 🚀 Save the Category!
            amount: totalAmount, balance: totalAmount, status: 'Unpaid', breakdown 
        }); 
        await newInvoice.save(); 

        // 🤖 SYSTEM BOT: Single Invoice Alert (Instant Write - No setTimeout!)
        const app = await TenantApplication.findOne({ linkedStudentId: studentId });
        if (app) {
            await sendSystemMessage(
                req.tenantDb, 
                studentId.toString(), 
                app.parentName || 'Parent', 
                'Parent', 
                '💳 Official Billing Notice', 
                `A new fee "${title}" for the ${term} Term has been applied to your account. Please log into the portal and check your Financial Ledger.`
            );
        }

        // 🛡️ AUDIT TRAIL: Log Single Invoice
        logSystemAction(req, 'FINANCE', `Issued manual invoice: "${title}" for ₦${totalAmount.toLocaleString()} to Student ID: ${studentId}`);

        res.status(201).json({ success: true, message: "Invoice generated successfully! Notification dispatched." }); 
    } catch (error) { 
        console.error("Single Invoice Error:", error);
        res.status(500).json({ error: "Failed to generate invoice." }); 
    }
});

app.post('/api/v1/invoices/bulk', verifyAdmin, async (req, res) => {
    try {
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantInvoice = req.tenantDb.model('Invoice', invoiceSchema);
        const TenantMessage = req.tenantDb.model('Message', messageSchema);
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);

        const { targetClass, targetStudentType, title, session, term, breakdown } = req.body;
        let totalAmount = 0; if(breakdown && breakdown.length > 0) { breakdown.forEach(item => totalAmount += Number(item.amount)); }
        
        let query = { targetClass: targetClass, status: 'Admitted' };
        if (targetStudentType === 'Day' || targetStudentType === 'Boarding') query.studentType = targetStudentType;
        
        const students = await TenantApplication.find(query);
        if(students.length === 0) return res.status(404).json({ error: `No admitted students found in this class.` });
        
        // 🚀 THE SAFETY CHECK: Filter out ghost students who don't have a linked account!
        const validStudents = students.filter(s => s.linkedStudentId);
        if(validStudents.length === 0) return res.status(400).json({ error: `Found admitted students, but none have active portal accounts linked. Please check their profiles.` });

        // 🛡️ BULLETPROOF IDEMPOTENCY LOCK
        // 1. Fetch ALL invoices for these students for this term
        const existingInvoices = await TenantInvoice.find({ 
            session: session, 
            term: term, 
            studentId: { $in: validStudents.map(s => s.linkedStudentId) } 
        });
        
        // 2. Filter exactly by the lowercase title in JavaScript to bypass database quirks
        const cleanTitle = title.trim().toLowerCase();
        const alreadyBilledIds = existingInvoices
            .filter(inv => inv.title.trim().toLowerCase() === cleanTitle)
            .map(inv => inv.studentId.toString());
        
        // 3. Filter out anyone who already has the bill
        const unbilledStudents = validStudents.filter(s => !alreadyBilledIds.includes(s.linkedStudentId.toString()));
        
        if (unbilledStudents.length === 0) {
            return res.status(400).json({ error: `Duplicate Alert: All selected students have already been billed for "${title}" this term.` });
        }

        // 🚀 THE FIX: Tag as 'Bulk' AND inject the new 'invoiceType'
        const { invoiceType } = req.body;
        const invoices = unbilledStudents.map(student => ({ 
            studentId: student.linkedStudentId, title, 
            invoiceType: invoiceType || 'Core', // Save Category!
            amount: totalAmount, balance: totalAmount, session, term, status: 'Unpaid', breakdown, isBulk: true 
        }));
        await TenantInvoice.insertMany(invoices);
        
        // Grab the dynamic school name for the Bot
        const settings = await TenantSettings.findOne() || {};
        const dynamicSchoolName = settings.schoolName || 'Automated System';

        const botMessages = [];
        const alertedEmails = new Set();

        for (const app of validStudents) {
            const pEmail = (app.parentEmail || "").toLowerCase().trim();
            
            if (!alertedEmails.has(pEmail)) {
                alertedEmails.add(pEmail);
                botMessages.push({
                    senderId: 'SYSTEM_BOT',
                    senderName: dynamicSchoolName,
                    senderRole: 'Automated Notification',
                    targetId: app.linkedStudentId.toString(),
                    targetName: app.parentName || 'Parent',
                    targetRole: 'Parent',
                    subject: '💳 Official Billing Notice',
                    message: `A new fee "${title}" for the ${term} Term has been applied to your account. Please log into the portal and check your Financial Ledger.`,
                    isReadByTarget: false,
                    isReadBySender: true,
                    replies: []
                });
            }
        }
        
        if (botMessages.length > 0) {
            await TenantMessage.insertMany(botMessages);
        }

        // 🛡️ AUDIT TRAIL: Log Bulk Billing
        logSystemAction(req, 'FINANCE', `Executed BULK BILLING: "${title}" sent to ${validStudents.length} students in ${targetClass}.`);

        res.status(201).json({ success: true, message: `Successfully billed ${validStudents.length} students! Notifications dispatched.` });
    } catch (error) { 
        console.error("Bulk Billing Error:", error);
        // 🚀 CRITICAL FIX: Send the actual crash message back to the frontend so we aren't guessing!
        res.status(500).json({ error: "Failed to process bulk billing: " + error.message }); 
    }
});

// 🚀 ADMIN ONLY: Smart Bulk Invoice Voiding
// 🚀 ADMIN ONLY: Fetch unique Bulk Invoice titles for the Recall Dropdown
app.get('/api/v1/invoices/bulk-titles', verifyAdmin, async (req, res) => {
    try {
        const TenantInvoice = req.tenantDb.model('Invoice', invoiceSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const { targetClass, session, term } = req.query;

        if (!targetClass || !session || !term) return res.json([]);

        // 1. Find all students in this class
        const students = await TenantApplication.find({ targetClass, status: 'Admitted' });
        const studentIds = students.map(s => s.linkedStudentId).filter(id => id);

        if (studentIds.length === 0) return res.json([]);

        // 2. 🛡️ Use MongoDB 'distinct' to find unique titles, but ONLY for Bulk Invoices
        const distinctTitles = await TenantInvoice.distinct('title', {
            studentId: { $in: studentIds },
            session: session,
            term: term,
            isBulk: true
        });

        res.json(distinctTitles);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch bulk invoice titles." });
    }
});

// 🚀 ADMIN ONLY: Track payment progress of a specific Bulk Batch
app.get('/api/v1/invoices/batch-status', verifyAdmin, async (req, res) => {
    try {
        const TenantInvoice = req.tenantDb.model('Invoice', invoiceSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const { title, session, term, targetClass } = req.query;

        if (!title || !targetClass || !session || !term) return res.status(400).json({ error: "Missing parameters." });

        // 1. Get all students in this class
        const students = await TenantApplication.find({ targetClass, status: 'Admitted' });
        const studentIds = students.map(s => s.linkedStudentId).filter(id => id);

        // 2. Get all matching bulk invoices for these students
        const invoices = await TenantInvoice.find({
            title: new RegExp('^' + title.trim() + '$', 'i'),
            session: session,
            term: term,
            studentId: { $in: studentIds },
            isBulk: true
        });

        // 3. Map the names to the invoices and calculate totals
        let totalExpected = 0;
        let totalCollected = 0;
        
        const trackingList = invoices.map(inv => {
            const student = students.find(s => s.linkedStudentId.toString() === inv.studentId.toString());
            totalExpected += inv.amount;
            totalCollected += (inv.amountPaid || 0);
            
            return {
                studentName: student ? student.studentName : 'Unknown Student',
                amount: inv.amount,
                amountPaid: inv.amountPaid || 0,
                balance: inv.balance,
                status: inv.status
            };
        });

        // Sort alphabetically by student name
        trackingList.sort((a, b) => a.studentName.localeCompare(b.studentName));

        res.json({
            totalExpected,
            totalCollected,
            trackingList
        });

    } catch (error) {
        res.status(500).json({ error: "Failed to fetch batch tracking data." });
    }
});

app.post('/api/v1/invoices/bulk-void', verifyAdmin, async (req, res) => {
    try {
        const TenantInvoice = req.tenantDb.model('Invoice', invoiceSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        
        const { title, session, term, targetClass } = req.body;
        if (!title || !session || !term || !targetClass) return res.status(400).json({ error: "Missing required fields." });
        
        // 1. Find all students in that class
        const students = await TenantApplication.find({ targetClass, status: 'Admitted' });
        const studentIds = students.map(s => s.linkedStudentId).filter(id => id);
        
        // 2. Find matching invoices for that class
        const invoices = await TenantInvoice.find({
            studentId: { $in: studentIds },
            title: new RegExp('^' + title.trim() + '$', 'i'),
            session: session, 
            term: term,
            isBulk: true // 🚀 THE FIX: Only touch invoices that belong to a bulk batch!
        });
        
        if (invoices.length === 0) return res.status(404).json({ error: "No matching invoices found to void." });

        let deletedCount = 0;
        let skippedCount = 0;
        
        // 3. 🛡️ SAFE DELETE ENGINE: Only delete unpaid invoices!
        for (let inv of invoices) {
            if (inv.amountPaid > 0) {
                skippedCount++; // Cannot delete an invoice that has money attached!
            } else {
                await TenantInvoice.findByIdAndDelete(inv._id);
                deletedCount++;
            }
        }
        
        logSystemAction(req, 'FINANCE', `Bulk Voided "${title}" for ${targetClass}. Deleted: ${deletedCount}, Skipped (Already Paid): ${skippedCount}`);
        
        let message = `Successfully voided ${deletedCount} unpaid invoices.`;
        if (skippedCount > 0) message += `\n\n(${skippedCount} invoices were skipped because the parents have already made partial or full payments).`;
        
        res.json({ success: true, message: message });
    } catch (error) { 
        console.error("Bulk Void Error:", error);
        res.status(500).json({ error: "Failed to void bulk invoices." }); 
    }
});

// 🚀 SAAS FEATURE: Historical Financial Ledger Importer
app.post('/api/v1/admin/import/finance', verifyAdmin, async (req, res) => {
    try {
        const TenantUser = req.tenantDb.model('User', userSchema);
        const TenantInvoice = req.tenantDb.model('Invoice', invoiceSchema);
        const TenantTransaction = req.tenantDb.model('Transaction', transactionSchema);

        const { records } = req.body; 
        
        if (!records || records.length === 0) {
            return res.status(400).json({ error: "No financial records provided for import." });
        }

        let successCount = 0;
        let skippedCount = 0;
        let totalHistoricalRevenue = 0;

        for (let row of records) {
            try {
                // 1. Smart Data Cleaner
                let safeSession = String(row.Session || '').trim();
                let safeTerm = String(row.Term || '').trim();
                
                if (safeTerm.toLowerCase().includes('first') || safeTerm.includes('1')) safeTerm = 'First';
                else if (safeTerm.toLowerCase().includes('second') || safeTerm.includes('2')) safeTerm = 'Second';
                else if (safeTerm.toLowerCase().includes('third') || safeTerm.includes('3')) safeTerm = 'Third';

                const amountBilled = Number(row.Amount_Billed) || 0;
                const amountPaid = Number(row.Amount_Paid) || 0;
                if (amountBilled <= 0) continue; 

                const student = await TenantUser.findOne({ 
                    systemId: new RegExp('^' + String(row.Student_ID).trim() + '$', 'i') 
                });

                if (!student) { skippedCount++; continue; }

                // 🛑 2. NEW: DUPLICATE PREVENTION (Idempotency Check)
                const feeTitle = String(row.Fee_Title).trim();
                const existingInvoice = await TenantInvoice.findOne({
                    studentId: student._id,
                    title: new RegExp('^' + feeTitle + '$', 'i'),
                    session: safeSession,
                    term: safeTerm
                });

                // If it already exists in the database, skip it to prevent double-billing!
                if (existingInvoice) {
                    skippedCount++;
                    continue; 
                }

                // 3. Calculate Debt Status
                let balance = amountBilled - amountPaid;
                if (balance < 0) balance = 0; 

                let status = 'Unpaid';
                if (balance === 0) status = 'Paid';
                else if (amountPaid > 0) status = 'Partial';

                // 4. Generate the Historical Invoice
                const invoice = new TenantInvoice({
                    studentId: student._id,
                    title: feeTitle, 
                    amount: amountBilled,
                    amountPaid: amountPaid,
                    balance: balance,
                    session: safeSession,
                    term: safeTerm,
                    status: status,
                    paymentDate: amountPaid > 0 ? new Date() : null, 
                    breakdown: [] 
                });
                await invoice.save();

                // 5. Audit Trail
                if (amountPaid > 0) {
                    const transaction = new TenantTransaction({
                        name: student.fullName,
                        amount: amountPaid,
                        type: 'Income',
                        description: `[Imported] ${feeTitle}`,
                        session: safeSession,
                        term: safeTerm,
                        date: new Date() 
                    });
                    await transaction.save();
                    totalHistoricalRevenue += amountPaid;
                }

                successCount++;
            } catch (err) { skippedCount++; }
        }

        logSystemAction(req, 'FINANCE', `Migrated ${successCount} historical financial records. Recovered ₦${totalHistoricalRevenue.toLocaleString()} in legacy payments.`);

        res.status(200).json({ 
            success: true, 
            message: "Financial Migration Complete!", 
            details: { imported: successCount, skipped: skippedCount, revenueRecovered: totalHistoricalRevenue }
        });

    } catch (error) {
        console.error("Finance Import Error:", error);
        res.status(500).json({ error: "System failed to process the legacy financial data." });
    }
});

app.get('/api/v1/invoices/:studentId', verifyToken, async (req, res) => {
    try { 
        const TenantInvoice = req.tenantDb.model('Invoice', invoiceSchema);
        const invoices = await TenantInvoice.find({ studentId: req.params.studentId }).sort({ createdAt: -1 }); 
        res.json(invoices); 
    } catch (error) { res.status(500).json({ error: "Failed to fetch invoices." }); }
});

app.get('/api/v1/admin/finance-stats', verifyAdmin, async (req, res) => {
    try {
        const TenantInvoice = req.tenantDb.model('Invoice', invoiceSchema);
        const { session, term } = req.query;
        let queryFilter = {};
        
        if (session) queryFilter.session = session;
        
        // 🚀 SMART SAAS FIX: Fuzzy matching prevents CSV typos from hiding data
        if (term && term !== 'All Terms') {
            const cleanTerm = term.replace(/ term/i, '').trim();
            queryFilter.term = new RegExp('^' + cleanTerm, 'i');
        }

        const invoices = await TenantInvoice.find(queryFilter);
        let stats = { mandatory: { outstanding: 0, paid: 0 }, optional: { outstanding: 0, paid: 0 }, total: { outstanding: 0, paid: 0 } };

        invoices.forEach(inv => {
            let mandatoryTotal = 0, optionalTotal = 0;
            if (inv.breakdown && inv.breakdown.length > 0) {
                inv.breakdown.forEach(item => { if (item.isMandatory) mandatoryTotal += Number(item.amount); else optionalTotal += Number(item.amount); });
            } else { mandatoryTotal = inv.amount; }

            let paidAmount = inv.amountPaid || 0;
            let mandatoryPaid = Math.min(paidAmount, mandatoryTotal);
            let optionalPaid = Math.max(0, paidAmount - mandatoryTotal);

            stats.mandatory.outstanding += (mandatoryTotal - mandatoryPaid);
            stats.mandatory.paid += mandatoryPaid;
            stats.optional.outstanding += (optionalTotal - optionalPaid);
            stats.optional.paid += optionalPaid;
            stats.total.outstanding += (inv.balance || 0); 
            stats.total.paid += (inv.amountPaid || 0);
        });
        res.json(stats);
    } catch (error) { res.status(500).json({ error: "Failed to fetch finance stats" }); }
});

app.get('/api/v1/admin/debtors', verifyAdmin, async (req, res) => {
    try {
        const TenantInvoice = req.tenantDb.model('Invoice', invoiceSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);

        const { session, term } = req.query;
        let queryFilter = { balance: { $gt: 0 } };
        
        if (session) queryFilter.session = session;
        
        // 🚀 SMART SAAS FIX: Fuzzy matching
        if (term && term !== 'All Terms') {
            const cleanTerm = term.replace(/ term/i, '').trim();
            queryFilter.term = new RegExp('^' + cleanTerm, 'i');
        }

        const invoices = await TenantInvoice.find(queryFilter);
        const apps = await TenantApplication.find(); 
        
        let formattedDebtors = [];
        invoices.forEach(inv => {
            const app = apps.find(a => a.linkedStudentId && a.linkedStudentId.toString() === inv.studentId.toString());
            if (app) { 
                formattedDebtors.push({ 
                    studentId: app.linkedStudentId, // 🚀 THIS IS THE MISSING KEY!
                    studentName: app.studentName, targetClass: app.status === 'Admitted' ? app.targetClass : app.status, 
                    parentEmail: app.parentEmail, parentPhone: app.parentPhone, title: inv.title, balance: inv.balance,
                    term: inv.term, amountPaid: inv.amountPaid, totalFee: inv.amount
                }); 
            }
        });
        res.json(formattedDebtors);
    } catch (error) { res.status(500).json({ error: "Failed to fetch debtors" }); }
});

app.put('/api/v1/invoices/:invoiceId/pay-manual', verifyAdmin, async (req, res) => {
    try {
        const TenantInvoice = req.tenantDb.model('Invoice', invoiceSchema);
        const TenantUser = req.tenantDb.model('User', userSchema);
        const TenantTransaction = req.tenantDb.model('Transaction', transactionSchema);

        const { amountToApply } = req.body;
        const invoice = await TenantInvoice.findById(req.params.invoiceId);
        if (!invoice) return res.status(404).json({ error: "Invoice not found" });
        if (invoice.status === 'Paid') return res.status(400).json({ error: "Invoice is already fully paid" });
        
        let payment = Number(amountToApply);
        invoice.amountPaid = (Number(invoice.amountPaid) || 0) + payment; 
        invoice.balance = Number(invoice.amount) - invoice.amountPaid; 
        invoice.status = invoice.balance <= 0 ? 'Paid' : 'Partial';
        if (invoice.balance <= 0) invoice.balance = 0;
        invoice.paymentDate = new Date(); 
        await invoice.save();

        const student = await TenantUser.findById(invoice.studentId);
        const newTransaction = new TenantTransaction({
            name: student ? student.fullName : "Unknown Student", amount: payment, type: 'Income',
            description: `Manual Cash Payment: ${invoice.title}`, session: invoice.session, term: invoice.term,
            studentId: student ? student._id.toString() : null // 🚀 NEW: Save the ID for the Parent Portal!
        });
        await newTransaction.save();

        logSystemAction(req, 'FINANCE', `Manually applied ₦${payment.toLocaleString()} cash payment to invoice: ${invoice.title}`);
        res.json({ success: true, message: `Successfully applied ₦${payment.toLocaleString()}!`, invoiceStatus: invoice.status, remainingBalance: invoice.balance });
    } catch (error) { res.status(500).json({ error: "Failed to apply manual payment." }); }
});

// 🚀 SAAS FEATURE: Securely Delete Financial Records (Super Admin Only)
app.delete('/api/v1/invoices/:id', verifyAdmin, async (req, res) => {
    try {
        const TenantInvoice = req.tenantDb.model('Invoice', invoiceSchema);
        const invoice = await TenantInvoice.findById(req.params.id);
        
        if (!invoice) return res.status(404).json({ error: "Invoice not found." });

        // 🛡️ THE NEW STRICT RULE
        if (invoice.amountPaid > 0) {
            return res.status(403).json({ error: "Security Lock: You cannot delete an invoice that has payments recorded against it. Please void the payment first." });
        }

        if (invoice.isBulk) {
            return res.status(403).json({ error: "Security Lock: Use the 'Recall Bulk Invoice' tool for bulk batches." });
        }

        await TenantInvoice.findByIdAndDelete(req.params.id);
        logSystemAction(req, 'FINANCE', `Deleted unpaid invoice: '${invoice.title}'`);
        res.json({ success: true, message: "Invoice deleted." });
    } catch (error) {
        res.status(500).json({ error: "System failed to delete the invoice." });
    }
});

app.post('/api/v1/wallet/fund', verifyToken, async (req, res) => {
    try {
        const TenantUser = req.tenantDb.model('User', userSchema);
        const { amountFunded } = req.body; 
        const user = await TenantUser.findById(req.user.id);
        user.walletBalance += Number(amountFunded); await user.save();
        res.json({ success: true, message: 'Wallet funded successfully!', newBalance: user.walletBalance });
    } catch (error) { res.status(500).json({ error: 'Server error funding wallet' }); }
});

app.post('/api/v1/invoices/:invoiceId/pay-advanced', verifyToken, async (req, res) => {
    try {
        const TenantInvoice = req.tenantDb.model('Invoice', invoiceSchema);
        const TenantUser = req.tenantDb.model('User', userSchema);

        const { paystackAmount, useWallet } = req.body;
        const invoice = await TenantInvoice.findById(req.params.invoiceId);
        const user = await TenantUser.findById(req.user.id);
        if (!invoice) return res.status(404).json({ error: "Invoice not found" });
        
        let paymentToApply = Number(paystackAmount) || 0;
        if (useWallet && user.walletBalance > 0) {
            if (user.walletBalance >= invoice.balance) { paymentToApply += invoice.balance; user.walletBalance -= invoice.balance; } 
            else { paymentToApply += user.walletBalance; user.walletBalance = 0; }
            await user.save();
        }
        invoice.amountPaid += paymentToApply; invoice.balance = invoice.amount - invoice.amountPaid;
        if (invoice.balance < 0) { user.walletBalance += Math.abs(invoice.balance); await user.save(); invoice.balance = 0; invoice.amountPaid = invoice.amount; }
        invoice.status = invoice.balance <= 0 ? 'Paid' : (invoice.amountPaid > 0 ? 'Partial' : 'Unpaid'); 
        invoice.paymentDate = new Date();
        await invoice.save();
        res.json({ success: true, message: 'Payment applied successfully', invoiceStatus: invoice.status, remainingBalance: invoice.balance, walletBalance: user.walletBalance });
    } catch (error) { res.status(500).json({ error: 'Error processing advanced payment' }); }
});

app.get('/api/v1/finance/current', verifyAdmin, async (req, res) => {
    try {
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
        const TenantTransaction = req.tenantDb.model('Transaction', transactionSchema);

        let settings = await TenantSettings.findOne() || new TenantSettings();
        const currentTransactions = await TenantTransaction.find({ session: settings.activeSession, term: settings.activeTerm });
        const totalIncome = currentTransactions.reduce((sum, t) => sum + t.amount, 0);
        const today = new Date().toISOString().split('T')[0];
        const todayIncome = currentTransactions.filter(t => t.date.toISOString().startsWith(today)).reduce((sum, t) => sum + t.amount, 0);

        res.json({ term: settings.activeTerm, session: settings.activeSession, totalIncome, todayIncome });
    } catch(e) { res.status(500).json({error: "Failed to fetch current finance"}); }
});

app.get('/api/v1/finance/history', verifyAdmin, requireFeature('financialAudit'), async (req, res) => {
    try {
        const TenantTransaction = req.tenantDb.model('Transaction', transactionSchema);
        const { session, term } = req.query;
        let query = {};
        if (session && session !== 'All') query.session = session;
        if (term && term !== 'All Terms') query.term = term; 
        
        const historyTransactions = await TenantTransaction.find(query).sort({ date: -1 });
        const total = historyTransactions.reduce((sum, t) => sum + t.amount, 0);
        
        res.json({ total, records: historyTransactions });
    } catch(e) { res.status(500).json({error: "Failed to fetch finance history"}); }
});

// ==========================================
// 9. ROLLOVER ENGINE
// ==========================================
// 🚀 SAAS FIX: Single Student Rollover
app.put('/api/v1/applications/:id/rollover', verifyAdmin, async (req, res) => {
    try {
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantUser = req.tenantDb.model('User', userSchema);

        const { action, newClass } = req.body;
        const app = await TenantApplication.findById(req.params.id);
        if (!app) return res.status(404).json({ error: "Application not found." });

        if (action === 'Archive') { app.status = 'Archived'; } 
        else if (action === 'Graduate') { app.status = 'Graduated'; } 
        else if (action === 'UpdateClass') { 
            const isOldJSS = app.targetClass.toUpperCase().includes('JSS') || app.targetClass.toUpperCase().includes('JUNIOR');
            const isNewSSS = newClass.toUpperCase().includes('SSS') || newClass.toUpperCase().includes('SENIOR');
            
            // If promoting from Junior to Senior, generate a new ID
            if (isOldJSS && isNewSSS) {
                const newId = await generateSystemId(req, 'Student', newClass);
                app.systemId = newId;
                await TenantUser.findByIdAndUpdate(app.linkedStudentId, { systemId: newId });
            }
            app.targetClass = newClass; 
        }
        await app.save();
        
        // 🚀 THE PHANTOM DEBT FIX: Wipe out unpaid expected income if they leave the school!
        if (action === 'Archive' || action === 'Graduate') {
            const TenantInvoice = req.tenantDb.model('Invoice', invoiceSchema);
            await TenantInvoice.deleteMany({ studentId: app.linkedStudentId, status: 'Unpaid' });
        }

        logSystemAction(req, 'ADMINISTRATION', `Performed ${action} action on student application ID: ${req.params.id}`);
        res.json({ success: true, message: "Student record updated successfully." });
    } catch (error) { res.status(500).json({ error: "Failed to update student record." }); }
});

// ==========================================
// 10. MASTER SYSTEM SETTINGS
// ==========================================
// --- SECURE ROUTE TO FETCH LOGS (Premium Plan Only) ---
app.get('/api/v1/admin/security-logs', verifyAdmin, requireFeature('auditLogs'), async (req, res) => {
    try {
        if (req.user.role !== 'Super Admin' && req.user.role !== 'Principal') {
            return res.status(403).json({ error: "Access Denied: Security Clearance Required." });
        }

        // 🚀 SAAS FIX
        const TenantAuditLog = req.tenantDb.model('AuditLog', auditLogSchema);

        const { startDate, endDate, category } = req.query;
        let query = {};

        // 1. Date Filtering
        if (startDate && endDate) {
            const start = new Date(startDate); start.setHours(0, 0, 0, 0);
            const end = new Date(endDate); end.setHours(23, 59, 59, 999);
            query.date = { $gte: start, $lte: end };
        }

        // 2. Category Filtering
        if (category && category !== 'All') query.actionType = category;

        const logs = await TenantAuditLog.find(query).sort({ date: -1 }).limit(500);
        res.json(logs);
    } catch(err) { 
        console.error(err);
        res.status(500).json({ error: "Failed to fetch security logs." }); 
    }
});

// 🚀 SAAS FEATURE: Request Plan Upgrade (WITH OWNER EMAIL ALERTS)
app.post('/api/v1/request-upgrade', verifyAdmin, async (req, res) => {
    try {
        const { requestedPlan } = req.body;
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
        const settings = await TenantSettings.findOne() || {};

        const schoolName = settings.schoolName || 'Unknown School';
        const adminEmail = req.user.email;
        const subdomain = req.tenantInfo ? req.tenantInfo.subdomain : 'Unknown';
        
        // 🚀 NEW: Save the request to the Master Database
        const UpgradeRequest = masterDb.models.UpgradeRequest || masterDb.model('UpgradeRequest', new mongoose.Schema({
            tenantId: mongoose.Schema.Types.ObjectId,
            schoolName: String,
            requestedPlan: String,
            status: { type: String, default: 'Pending' },
            createdAt: { type: Date, default: Date.now }
        }));
        
        await UpgradeRequest.create({ 
            tenantId: req.tenantInfo._id, 
            schoolName: schoolName,
            requestedPlan 
        });

        // 2. Email the SaaS Platform Owner (You!)
        await sendMasterAlert({
            to: "school@vertexnextgen.com.ng",
            subject: `🚀 SAAS SALES ALERT: ${schoolName} -> ${requestedPlan} Plan`,
            html: `
                <div style="font-family: sans-serif; padding: 25px; border: 1px solid #bfdbfe; background: #eff6ff; border-radius: 12px; max-width: 600px;">
                    <h2 style="color: #1e3a8a; margin-top: 0;">New Plan Upgrade Request! 💰</h2>
                    <p><strong>School Name:</strong> ${schoolName}</p>
                    <p><strong>Requested Plan:</strong> ${requestedPlan}</p>
                    <p><strong>Admin Contact:</strong> ${adminEmail}</p>
                    <p><i>Check your Master Command Center to approve this.</i></p>
                </div>
            `
        });

        res.json({ success: true, message: "Upgrade request sent successfully!" });
    } catch (err) {
        console.error("Upgrade Request Error:", err);
        res.status(500).json({ error: "Failed to send upgrade request." });
    }
});

app.put('/api/v1/settings', verifyAdmin, async (req, res) => {
    try {
        // 🚀 SAAS FIX: Bind to the specific school database
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
        
        const updates = req.body;

        // 🛡️ THE SAAS VALIDATOR
        if (updates.absentEmailBody) {
            const body = updates.absentEmailBody;
            const openBraces = (body.match(/{/g) || []).length;
            const closeBraces = (body.match(/}/g) || []).length;
            if (openBraces !== closeBraces) return res.status(400).json({ error: "Template Error: Broken tag." });
            if (body.includes('{studentname}') || body.includes('{classname}')) return res.status(400).json({ error: "Template Error: Tags are case-sensitive." });
        }

        // 🛡️ CORE SECURITY: Strip out system-level fields
        delete updates.planTier;
        delete updates.enabledFeatures;
        delete updates.accountStatus;

        // 🚀 THE SMART-SAVE FIX: Restrict sensitive fields & prevent overwriting with blanks
        if (req.user.role === 'Super Admin') {
            const sensitiveFields = ['smtpPass', 'paystackSecretKey', 'bursarSignature', 'principalSignature'];
            
            sensitiveFields.forEach(field => {
                // If the field is the "mask" (********) or empty, DELETE it from updates
                // This ensures the database keeps the old, valid value.
                if (updates[field] === '********' || (updates[field] && updates[field].trim() === '')) {
                    delete updates[field];
                }
            });
        } else {
            // If NOT Super Admin, remove these from the updates object entirely
            delete updates.schoolName;
            delete updates.schoolShortName;
            delete updates.themeColor;
            delete updates.schoolLogo;
            delete updates.schoolBackground;
            delete updates.smtpHost;
            delete updates.smtpPort;
            delete updates.smtpUser;
            delete updates.smtpPass;
            delete updates.paystackPublicKey;
            delete updates.paystackSecretKey;
            delete updates.bursarSignature;
            delete updates.principalSignature;
        }

        // ☁️ CLOUDINARY INTERCEPTOR
        if (updates.schoolLogo) updates.schoolLogo = await uploadToCloudinary(updates.schoolLogo, 'school_assets');
        if (updates.schoolBackground) updates.schoolBackground = await uploadToCloudinary(updates.schoolBackground, 'school_assets');
        if (updates.principalSignature) updates.principalSignature = await uploadToCloudinary(updates.principalSignature, 'school_assets');
        if (updates.bursarSignature) updates.bursarSignature = await uploadToCloudinary(updates.bursarSignature, 'school_assets');

        // 🚀 SAAS FIX: Use TenantSettings to save!
        const updatedSettings = await TenantSettings.findOneAndUpdate({}, { $set: updates }, { returnDocument: 'after', upsert: true });

        SystemCache.clearSettings(); // Force cache wipe
        
        logSystemAction(req, 'SECURITY', `Updated Global School Settings & Configurations.`);
        res.status(200).json({ message: "Settings secured and updated", settings: updatedSettings });
    } catch (error) {
        console.error("Settings Save Error:", error);
        res.status(500).json({ error: "Database failed to save settings." });
    }
});


// 🛡️ ADMIN/SECURITY: Verify Pickup OTP
app.get('/api/v1/admin/verify-pickup/:otp', verifyAdmin, requireFeature('gateSecurity'), async (req, res) => {
    try {
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        
        const app = await TenantApplication.findOne({ 
            pickupOtp: req.params.otp,
            pickupOtpExpiry: { $gt: new Date() } // Must not be expired
        });

        if (!app) {
            return res.status(404).json({ error: "Invalid or Expired PIN. Please verify the code with the parent." });
        }

        res.json({
            success: true,
            studentName: app.studentName,
            targetClass: app.targetClass,
            passportPhoto: app.passportPhoto,
            delegateName: app.pickupDelegate,
            studentId: app.linkedStudentId
        });
    } catch (error) {
        res.status(500).json({ error: "System error verifying PIN." });
    }
});

// 🛡️ ADMIN/SECURITY: Approve Pickup & Clear OTP
app.post('/api/v1/admin/approve-pickup/:studentId', verifyAdmin, requireFeature('gateSecurity'), async (req, res) => {
    try {
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
        
        const app = await TenantApplication.findOne({ linkedStudentId: req.params.studentId });
        if (!app) return res.status(404).json({ error: "Student record not found." });

        // 🚀 FIX 1: Read exactly what the frontend securely sent us so nothing is blank
        const delegate = req.body.delegateName || app.pickupDelegate || "Authorized Delegate";
        const usedOtp = req.body.otp || app.pickupOtp;

        const historyItem = app.pickupHistory.find(h => h.otp === usedOtp && h.status === 'Pending');
        if (historyItem) {
            historyItem.status = 'Verified';
            historyItem.dateVerified = new Date();
            historyItem.verifiedBy = req.user.name;
        }

        app.pickupDelegate = null;
        app.pickupOtp = null;
        app.pickupOtpExpiry = null;
        app.lastPickupDate = new Date(); 
        await app.save();

        // 🚀 FIX 2: Added 'await' so the server doesn't kill the database write before it finishes!
        await logSystemAction(req, 'SECURITY', `Authorized delegate pickup for ${app.studentName}. Released to: ${delegate} (Verified with PIN: ${usedOtp})`);

        // 🤖 SYSTEM BOT (Instant Write - Fast)
        const timeStr = new Date().toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'});
        await sendSystemMessage(
            req.tenantDb, 
            req.params.studentId, 
            app.parentName || 'Parent', 
            'Parent', 
            '🛡️ Security Alert: Gate Release', 
            `Authorization Alert: Your delegate (${delegate}) has successfully picked up ${app.studentName} at ${timeStr}.`
        );

        // 🚀 EMAIL BOT (Fire-and-Forget Background task)
        setTimeout(async () => {
            try {
                const settings = await TenantSettings.findOne() || {};
                const mailOptions = {
                    to: app.parentEmail,
                    subject: `Security Alert: Pickup Confirmation for ${app.studentName}`,
                    html: `
                    <div style="font-family:sans-serif; padding:25px; border:1px solid #e2e8f0; border-radius:12px; max-width:600px; margin:auto; background:#f8fafc;">
                        <h2 style="color:#166534; margin-top:0; text-align:center;">Pickup Authorized</h2>
                        <p>Your child <b>${app.studentName}</b> has just been successfully checked out of the premises.</p>
                        <div style="background:#fff; border:1px solid #cbd5e1; padding:15px; border-radius:8px;">
                            <p style="margin:0 0 8px 0;"><strong>Delegate:</strong> ${delegate}</p>
                            <p style="margin:0;"><strong>Cleared By:</strong> ${req.user.name}</p>
                        </div>
                    </div>`
                };
                if (settings.smtpUser && settings.smtpPass) await sendSchoolEmail(req, mailOptions);
                else await sendMasterAlert(mailOptions);
            } catch (bgErr) {}
        }, 0);

        res.json({ success: true, message: "Student securely released! Notifications dispatched." });
    } catch (error) { 
        console.error("Approve Pickup Error:", error);
        res.status(500).json({ error: "Server error" }); 
    }
});



// ==========================================
// 10.5 PUBLIC VERIFICATION APIs (QR SCANNERS)
// ==========================================

// 1. Verify Student ID
app.get('/api/students/:id', async (req, res) => {
    try {
        const student = await User.findById(req.params.id);
        if (!student) return res.status(404).json({ error: "Student not found" });
        
        const appRecord = await Application.findOne({ linkedStudentId: student._id });
        
        res.json({
            firstName: student.fullName,
            lastName: "",
            photoUrl: student.photo || (appRecord ? appRecord.passportPhoto : ""), // This checks both places for the photo
            currentClass: appRecord ? appRecord.targetClass : "Unknown",
            admissionNumber: student.systemId,
            status: appRecord ? (appRecord.status === 'Admitted' ? 'Active' : appRecord.status) : 'Active'
        });
    } catch (error) { res.status(500).json({ error: "Invalid ID" }); }
});

// 2. Verify Staff ID (Public Route)
app.get('/api/v1/verify-staff-public/:id', async (req, res) => {
    try {
        const staff = await User.findById(req.params.id);
        if (!staff) return res.status(404).json({ error: "Staff not found" });
        
        res.json({
            fullName: staff.fullName,
            photo: staff.photo, // Explicitly sending the photo field
            role: staff.role,
            jobTitle: staff.jobTitle,
            systemId: staff.systemId
        });
    } catch (error) { res.status(500).json({ error: "Invalid ID" }); }
});

// 3. Verify Academic Documents (Report Cards)
app.get('/api/results/:id', async (req, res) => {
    try {
        const result = await Result.findById(req.params.id).populate('studentId');
        if (!result || result.publishStage === 'Draft') return res.status(404).json({ error: "Document not found" });
        const app = await Application.findOne({ linkedStudentId: result.studentId._id });
        
        res.json({
            studentName: result.studentId.fullName,
            term: result.term,
            session: result.session,
            class: app ? app.targetClass : "Unknown",
            records: result.records // <-- MAKE SURE THIS LINE IS THERE
        });
    } catch (error) { res.status(500).json({ error: "Invalid ID" }); }
});

// ==========================================
// 👪 PARENT PORTAL API ROUTES (SAAS UPDATED)
// ==========================================

app.get('/api/v1/parent/dashboard', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'Parent') return res.status(403).json({ error: "Access denied." });
        
        // 🚀 SAAS FIX: Bind to specific database
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantUser = req.tenantDb.model('User', userSchema);

        // 🚀 1. Fetch the Parent User to get the linked array
        const parentUser = await TenantUser.findById(req.user.id);
        if (!parentUser) return res.status(404).json({ error: "Parent account not found." });

        // 🚀 2. Fetch ALL wards using the linkedStudentIds array!
        // This is much more reliable than searching by email.
        const children = await TenantApplication.find({ 
            linkedStudentId: { $in: parentUser.linkedStudentIds } 
        }).lean();

        res.json({
            success: true,
            walletBalance: parentUser.walletBalance || 0,
            children: children
        });
    } catch (error) {
        res.status(500).json({ error: "Failed to load parent dashboard." });
    }
});

app.get('/api/v1/parent/invoices', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'Parent') return res.status(403).json({ error: "Access denied." });
        
        // 🚀 SAAS FIX: Bind to specific database
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantInvoice = req.tenantDb.model('Invoice', invoiceSchema);

        // 1. Get all children IDs for this parent
        const children = await TenantApplication.find({ parentEmail: new RegExp('^' + req.user.email + '$', 'i') });
        const studentIds = children.map(c => c.linkedStudentId).filter(id => id);

        if (studentIds.length === 0) return res.json([]);

        // 2. Fetch all invoices belonging to ANY of those children
        const invoices = await TenantInvoice.find({ studentId: { $in: studentIds } }).sort({ createdAt: -1 }).lean();
        
        // 3. Attach the student's name to each invoice so the parent knows who the bill is for
        invoices.forEach(inv => {
            const child = children.find(c => c.linkedStudentId.toString() === inv.studentId.toString());
            inv.studentName = child ? child.studentName : "Student";
        });

        res.json(invoices);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch family invoices." });
    }
});

// 🚀 PARENT PORTAL: Fetch Official Receipts (Cash & Online)
app.get('/api/v1/parent/receipts', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'Parent') return res.status(403).json({ error: "Access denied." });
        
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantTransaction = req.tenantDb.model('Transaction', transactionSchema);

        const children = await TenantApplication.find({ parentEmail: new RegExp('^' + req.user.email + '$', 'i') });
        const studentIds = children.map(c => c.linkedStudentId ? c.linkedStudentId.toString() : null).filter(id => id);

        if (studentIds.length === 0) return res.json([]);

        // Fetch transactions linked to ANY of their children
        const receipts = await TenantTransaction.find({ studentId: { $in: studentIds } }).sort({ date: -1 }).lean();
        
        res.json(receipts);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch family receipts." });
    }
});

app.put('/api/v1/parent/update-child/:studentId', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'Parent') return res.status(403).json({ error: "Unauthorized" });

        // 🚀 SAAS FIX: Bind to specific database
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantUser = req.tenantDb.model('User', userSchema);

        const { parentEmail, parentPhone, passportPhoto } = req.body;
        
        const app = await TenantApplication.findOne({ linkedStudentId: req.params.studentId });
        if (!app) return res.status(404).json({ error: "Student record not found." });

        let securePhotoUrl = passportPhoto;
        if (passportPhoto && !passportPhoto.startsWith('http')) {
            securePhotoUrl = await uploadToCloudinary(passportPhoto, 'student_passports');
        }

        if (parentEmail) app.parentEmail = parentEmail;
        if (parentPhone) app.parentPhone = parentPhone;
        if (securePhotoUrl) app.passportPhoto = securePhotoUrl; 

        await app.save();

        if (securePhotoUrl) {
            await TenantUser.findByIdAndUpdate(req.params.studentId, { photo: securePhotoUrl });
        }

        res.json({ message: "Profile & Photo updated successfully!" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error updating profile." });
    }
});

// 🚀 PARENT PORTAL: Generate Secure Pickup OTP
app.post('/api/v1/parent/pickup-otp/:studentId', verifyToken, requireFeature('gateSecurity'), async (req, res) => {
    try {
        if (req.user.role !== 'Parent') return res.status(403).json({ error: "Unauthorized" });

        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const { delegateName } = req.body;
        
        if (!delegateName) return res.status(400).json({ error: "Please provide the name of the person picking up the student." });

        const app = await TenantApplication.findOne({ linkedStudentId: req.params.studentId });
        if (!app) return res.status(404).json({ error: "Student record not found." });

        // 🛡️ THE DAILY LOCK
        if (app.lastPickupDate) {
            const today = new Date().toDateString();
            const lastPickup = new Date(app.lastPickupDate).toDateString();
            if (today === lastPickup) {
                return res.status(403).json({ error: "This student has already been officially picked up and checked out of the premises today." });
            }
        }

        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        
        app.pickupDelegate = delegateName;
        app.pickupOtp = otp;
        
        const expiry = new Date();
        expiry.setHours(23, 59, 59, 999);
        app.pickupOtpExpiry = expiry;

        // 🛡️ IMMUTABLE LEDGER: Record the generation
        app.pickupHistory.push({
            dateGenerated: new Date(),
            delegateName: delegateName,
            otp: otp,
            status: 'Pending'
        });

        await app.save();
        res.json({ success: true, otp, message: "Authorization PIN generated successfully." });
    } catch (error) { res.status(500).json({ error: "Server error generating authorization pin." }); }
});

// 🚀 PARENT PORTAL: Fetch Immutable OTP History
app.get('/api/v1/parent/pickup-history/:studentId', verifyToken, requireFeature('gateSecurity'), async (req, res) => {
    try {
        if (req.user.role !== 'Parent') return res.status(403).json({ error: "Unauthorized" });
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const app = await TenantApplication.findOne({ linkedStudentId: req.params.studentId });
        if (!app) return res.status(404).json({ error: "Student record not found." });
        
        res.json(app.pickupHistory || []);
    } catch (error) { res.status(500).json({ error: "Server error fetching history." }); }
});

// ==========================================
// ✉️ INTERNAL MESSAGING API ROUTES
// ==========================================

// 1. GET MESSAGES (Inbox & Sent)
app.get('/api/v1/messages', verifyToken, async (req, res) => {
    try {
        const TenantMessage = req.tenantDb.model('Message', messageSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        let query = {};
        
        // 🚀 THE FIX: Create an array of ALL valid IDs for this user
        let myValidIds = [req.user.id];
        
        if (req.user.role === 'Parent') {
            // Find ALL children associated with this parent's email
            const myApps = await TenantApplication.find({ parentEmail: new RegExp('^' + req.user.email.trim() + '$', 'i') });
            const additionalIds = myApps.map(a => a.linkedStudentId ? a.linkedStudentId.toString() : null).filter(id => id);
            
            // Merge all IDs together so the parent sees messages sent to ANY of their children
            myValidIds = [...new Set([...myValidIds, ...additionalIds])];

            query = {
                $or: [
                    { senderId: { $in: myValidIds } },
                    { targetId: { $in: myValidIds } }, 
                    { targetRole: 'Broadcast_Parents' }
                ]
            };
        } else if (['Teacher', 'Staff'].includes(req.user.role)) {
            query = {
                $or: [
                    { senderId: req.user.id },
                    { targetId: req.user.id }, 
                    { targetRole: 'Broadcast_Staff' }
                ]
            };
        } else if (['Admin', 'Super Admin', 'Principal', 'Bursar', 'Assistant Admin', 'Assistant Bursar'].includes(req.user.role)) {
            query = {
                $or: [
                    { targetId: req.user.role }, 
                    { targetId: 'Admin' }, 
                    { senderId: req.user.id },
                    { targetRole: 'Broadcast_Parents' },
                    { targetRole: 'Broadcast_Staff' }
                ]
            };
        } else if (req.user.role === 'Student') {
            // 🚀 THE FIX: LOCK DOWN THE STUDENT BACKEND QUERY
            const myApp = await TenantApplication.findOne({ linkedStudentId: req.user.id });
            const myClass = myApp ? myApp.targetClass : null;
            
            query = {
                $or: [
                    { targetId: req.user.id }, 
                    { targetRole: 'Broadcast - All' },
                    { targetRole: 'Broadcast - Students' },
                    ...(myClass ? [{ targetRole: `Broadcast - ${myClass}` }] : [])
                ]
            };
        }

        const messages = await TenantMessage.find(query).sort({ updatedAt: -1 }).lean();
        
        // 🚀 THE FIX: Calculate Unread Badge Count perfectly on the backend
        let unreadCount = 0;
        const processedMessages = messages.map(m => {
            let isUnread = false;
            
            if (myValidIds.includes(m.senderId) && !m.isReadBySender) isUnread = true;
            else if (myValidIds.includes(m.targetId) && !m.isReadByTarget) isUnread = true;
            else if (m.targetId === 'Admin' && ['Admin', 'Super Admin', 'Principal', 'Bursar', 'Assistant Admin'].includes(req.user.role) && !m.isReadByTarget) isUnread = true;
            else if (m.targetId === req.user.role && !m.isReadByTarget) isUnread = true;
            
            if (isUnread) unreadCount++;
            
            // Attach the exact unread status to the message so the frontend doesn't have to guess!
            return { ...m, _isUnread: isUnread };
        });

        res.json({ unreadCount, messages: processedMessages });
    } catch (error) { res.status(500).json({ error: "Failed to fetch messages." }); }
});

// 2. GET CONTACT DIRECTORY (The Strict Communication Corridors)
app.get('/api/v1/messages/contacts', verifyToken, async (req, res) => {
    try {
        const TenantUser = req.tenantDb.model('User', userSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        let contacts = [];

        // Professional Standard Contacts
        const adminContacts = [
            { id: 'Admin', name: 'Front Desk & Administration', role: 'Admin' },
            { id: 'Principal', name: 'Office of the Principal', role: 'Principal' },
            { id: 'Bursar', name: 'Bursary & Accounts', role: 'Bursar' }
        ];

        // 🚀 SAAS FREEMIUM SPLIT: Check if they are on the Basic Plan
        const TenantSubscription = req.tenantDb.model('Subscription', subscriptionSchema);
        const sub = await TenantSubscription.findOne() || { planTier: 'Premium' };
        
        if (sub.planTier === 'Basic') {
            let basicContacts = [];
            // Only Admins get the Broadcast options. Parents and Teachers get an empty array!
            if (['Admin', 'Super Admin', 'Principal', 'Bursar'].includes(req.user.role)) {
                basicContacts.push({ id: 'Broadcast_Parents', name: 'GLOBAL MEMO: All Parents', role: 'Broadcast' });
                basicContacts.push({ id: 'Broadcast_Staff', name: 'GLOBAL MEMO: All Staff', role: 'Broadcast' });
            }
            return res.json(basicContacts);
        }

        if (req.user.role === 'Parent') {
            contacts.push(...adminContacts);
            const apps = await TenantApplication.find({ parentEmail: new RegExp('^' + req.user.email.trim() + '$', 'i'), status: 'Admitted' });
            
            if (apps.length > 0) {
                const classes = apps.map(a => a.targetClass);
                const formMasters = await TenantUser.find({ formClass: { $in: classes }, accountStatus: 'Active' });
                
                formMasters.forEach(t => {
                    contacts.push({ id: t._id.toString(), name: t.fullName, role: `Form Master (${t.formClass})` });
                });
            }
        } 
        else if (['Teacher', 'Staff'].includes(req.user.role)) {
            contacts.push(...adminContacts);
            
            const allStaff = await TenantUser.find({ role: { $in: ['Teacher', 'Staff'] }, accountStatus: 'Active' });
            allStaff.forEach(s => {
                if (s._id.toString() !== req.user.id) {
                    let rLabel = s.jobTitle || 'Staff';
                    if (s.formClass) rLabel = `Form Master (${s.formClass})`;
                    contacts.push({ id: s._id.toString(), name: s.fullName, role: rLabel });
                }
            });

            if (req.user.formClass && req.user.formClass.trim() !== "") {
                const apps = await TenantApplication.find({ targetClass: req.user.formClass, status: 'Admitted' });
                
                const parentMap = {};
                apps.forEach(a => {
                    if (!a.linkedStudentId) return;
                    const email = a.parentEmail.toLowerCase().trim();
                    if (!parentMap[email]) {
                        parentMap[email] = {
                            id: a.linkedStudentId.toString(),
                            name: a.parentName || 'Parent/Guardian',
                            children: []
                        };
                    }
                    // 🚀 THE FIX: Use Full Name + System ID instead of just First Name
                    parentMap[email].children.push(`${a.studentName} [${a.systemId || 'Pending'}]`);
                });

                Object.values(parentMap).forEach(p => {
                    const childNames = p.children.join(' & ');
                    contacts.push({ id: p.id, name: p.name, role: `Parent of ${childNames}` }); 
                });
            }
        } 
        else {
            contacts.push({ id: 'Broadcast_Parents', name: 'GLOBAL MEMO: All Parents', role: 'Broadcast' });
            contacts.push({ id: 'Broadcast_Staff', name: 'GLOBAL MEMO: All Staff', role: 'Broadcast' });
            
            const allUsers = await TenantUser.find({ role: { $nin: ['Student', 'Applicant', 'Parent'] }, accountStatus: 'Active' });
            allUsers.forEach(u => {
                if (u._id.toString() !== req.user.id) {
                    let rLabel = u.jobTitle || u.role;
                    if (u.formClass) rLabel = `Form Master (${u.formClass})`;
                    contacts.push({ id: u._id.toString(), name: u.fullName, role: rLabel });
                }
            });

            const allApps = await TenantApplication.find({ status: 'Admitted' });
            const parentMap = {};
            allApps.forEach(a => {
                if (!a.linkedStudentId) return;
                const email = a.parentEmail.toLowerCase().trim();
                if (!parentMap[email]) {
                    parentMap[email] = { id: a.linkedStudentId.toString(), name: a.parentName || 'Parent/Guardian', children: [] };
                }
                // 🚀 THE FIX: Use Full Name + System ID
                parentMap[email].children.push(`${a.studentName} [${a.systemId || 'Pending'}]`);
            });

            Object.values(parentMap).forEach(p => {
                const childNames = p.children.join(' & ');
                contacts.push({ id: p.id, name: p.name, role: `Parent of ${childNames}` }); 
            });
        }

        const uniqueContacts = Array.from(new Map(contacts.map(item => [item.id, item])).values());
        res.json(uniqueContacts);
    } catch (e) { res.status(500).json({error: "Failed to fetch directory."}); }
});

// 3. COMPOSE NEW THREAD
app.post('/api/v1/messages', verifyToken, async (req, res) => {
    try {
        const TenantMessage = req.tenantDb.model('Message', messageSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantSubscription = req.tenantDb.model('Subscription', subscriptionSchema);
        
        const { subject, message, targetId, targetName, targetRole } = req.body;
        if (!subject || !message || !targetId) return res.status(400).json({ error: "Missing fields." });

        // 🚀 SAAS FREEMIUM SPLIT: Block Direct Messages on Basic Plan
        const sub = await TenantSubscription.findOne() || { planTier: 'Premium' };
        if (sub.planTier === 'Basic') {
            if (!targetId.startsWith('Broadcast_') || !['Admin', 'Super Admin', 'Principal', 'Bursar'].includes(req.user.role)) {
                return res.status(403).json({ error: "SaaS Restriction: Direct Messaging is only available on Advance and Elite plans. Please upgrade." });
            }
        }

        if (targetId.startsWith('Broadcast_') && !['Admin', 'Super Admin', 'Principal'].includes(req.user.role)) {
            return res.status(403).json({ error: "Only admins can broadcast." });
        }

        let finalSenderRole = req.user.role;
        if (req.user.role === 'Parent') {
            const apps = await TenantApplication.find({ parentEmail: new RegExp('^' + req.user.email.trim() + '$', 'i'), status: 'Admitted' });
            if (apps.length > 0) {
                // 🚀 THE FIX: Use Full Name + System ID
                const childNames = apps.map(a => `${a.studentName} [${a.systemId || 'Pending'}]`).join(' & ');
                finalSenderRole = `Parent of ${childNames}`;
            }
        } else if (req.user.formClass) {
            finalSenderRole = `Form Master (${req.user.formClass})`;
        }

        const newMsg = new TenantMessage({
            senderId: req.user.id, senderName: req.user.name, senderRole: finalSenderRole,
            targetId, targetName, targetRole, subject, message,
            isReadByTarget: false, isReadBySender: true
        });

        await newMsg.save();
        res.status(201).json({ success: true, message: "Message sent!" });
    } catch (error) { res.status(500).json({ error: "Failed to send message." }); }
});

// 4. REPLY & MARK AS READ
app.post('/api/v1/messages/:id/reply', verifyToken, async (req, res) => {
    try {
        const TenantMessage = req.tenantDb.model('Message', messageSchema);
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const { message, markAsReadOnly } = req.body;

        const thread = await TenantMessage.findById(req.params.id);
        if (!thread) return res.status(404).json({ error: "Thread not found." });

        if (markAsReadOnly) {
            if (thread.senderId === req.user.id || (req.user.role === 'Parent' && thread.senderRole.startsWith('Parent'))) thread.isReadBySender = true;
            else thread.isReadByTarget = true;
            await thread.save();
            return res.json({ success: true });
        }

        // 🚀 SAAS FREEMIUM SPLIT: Block Replies on Basic Plan
        const TenantSubscription = req.tenantDb.model('Subscription', subscriptionSchema);
        const sub = await TenantSubscription.findOne() || { planTier: 'Premium' };
        if (sub.planTier === 'Basic') {
            return res.status(403).json({ error: "SaaS Restriction: Replies are disabled on the Foundation plan. Please contact the school directly." });
        }

        if (!message) return res.status(400).json({ error: "Reply empty." });

        let finalSenderRole = req.user.role;
        if (req.user.role === 'Parent') {
            const apps = await TenantApplication.find({ parentEmail: new RegExp('^' + req.user.email.trim() + '$', 'i'), status: 'Admitted' });
            if (apps.length > 0) {
                // 🚀 THE FIX: Use Full Name + System ID
                const childNames = apps.map(a => `${a.studentName} [${a.systemId || 'Pending'}]`).join(' & ');
                finalSenderRole = `Parent of ${childNames}`;
            }
        } else if (req.user.formClass) {
            finalSenderRole = `Form Master (${req.user.formClass})`;
        }

        thread.replies.push({ senderId: req.user.id, senderName: req.user.name, senderRole: finalSenderRole, message });

        if (thread.senderId === req.user.id) {
            thread.isReadBySender = true; thread.isReadByTarget = false;
        } else {
            thread.isReadByTarget = true; thread.isReadBySender = false;
        }

        await thread.save();
        res.json({ success: true, message: "Reply sent!" });
    } catch (error) { res.status(500).json({ error: "Failed to reply." }); }
});

// 🚀 SMART CONSOLIDATED NOTIFICATION ROUTE
app.post('/api/v1/admin/blast-debtors-internal', verifyAdmin, async (req, res) => {
    try {
        const TenantMessage = req.tenantDb.model('Message', messageSchema);
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
        const { debtors } = req.body;
        
        const settings = await TenantSettings.findOne() || {};
        const schoolName = settings.schoolName || 'School Administration';
        
        // 1. Group debtors by parentEmail
        const parentMap = {};

        debtors.forEach(d => {
            const email = d.parentEmail;
            if (!email || !d.studentId) return;
            
            if (!parentMap[email]) {
                parentMap[email] = { 
                    studentId: d.studentId, // Used as the destination for the portal message
                    totalDebt: 0, 
                    childrenData: [] 
                };
            }
            parentMap[email].totalDebt += d.balance;
            parentMap[email].childrenData.push({
                name: d.studentName,
                debt: d.balance,
                title: d.title
            });
        });

        // 2. Build the smart message for each parent
        let sentCount = 0;
        for (const email in parentMap) {
            const p = parentMap[email];
            
            // Build detailed breakdown
            let breakdownText = p.childrenData.map(c => 
                `\n- ${c.name}: ₦${c.debt.toLocaleString()} (${c.title})`
            ).join('');

            const msg = `Dear Parent, we hope this message finds you well.\n\nThis is a friendly reminder of the outstanding balances for your children:\n${breakdownText}\n\nTotal Outstanding: ₦${p.totalDebt.toLocaleString()}.\n\nPlease settle these balances at your earliest convenience to ensure your children continue to enjoy uninterrupted school facilities. Thank you for your partnership.\n\nRegards,\n${schoolName}`;

            await sendSystemMessage(
                req.tenantDb, 
                p.studentId, 
                'Parent', 
                'Parent', 
                'Payment Reminder: Outstanding School Fees', 
                msg
            );
            sentCount++;
        }
        
        res.json({ success: true, message: `Successfully sent ${sentCount} consolidated notifications.` });
    } catch (err) {
        console.error("Blast Error:", err);
        res.status(500).json({ error: "Failed to send reminders." });
    }
});

// ==========================================
// 11. FRONTEND UI ROUTES
// ==========================================
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, '..', 'public', 'index.html')); }); 
app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')); });
app.get('/teacher', (req, res) => { res.sendFile(path.join(__dirname, '..', 'public', 'teacher.html')); });
app.get('/apply', (req, res) => { res.sendFile(path.join(__dirname, '..', 'public', 'apply.html')); });
app.get('/student', (req, res) => { res.sendFile(path.join(__dirname, '..', 'public', 'student.html')); });
app.get('/applicant', (req, res) => { res.sendFile(path.join(__dirname, '..', 'public', 'applicant.html')); }); // 🚀 THE FIX
app.get('/parent', (req, res) => { res.sendFile(path.join(__dirname, '..', 'public', 'parent.html')); }); 
app.get('/cbt', (req, res) => { res.sendFile(path.join(__dirname, '..', 'public', 'cbt.html')); }); // 🚀 The new CBT route, but with correct path!
app.get('/verify/:id', (req, res) => { res.sendFile(path.join(__dirname, '..', 'public', 'verify.html')); });
app.get('/verify-staff/:id', (req, res) => { res.sendFile(path.join(__dirname, '..', 'public', 'verify-staff.html')); });
app.get('/verify-result/:id', (req, res) => { res.sendFile(path.join(__dirname, '..', 'public', 'verify-result.html')); });
// Add this exact line to your index.js
app.get('/verify-transcript', (req, res) => { 
    res.sendFile(path.join(__dirname, '..', 'public', 'verify-transcript.html')); 
});

// 🚀 ROUTE: Admin Edit Student Profile (With Smart Email Sync & SaaS Tenant Fix)
app.put('/api/v1/applications/:id', verifyAdmin, async (req, res) => {
    try {
        // 🚀 SAAS FIX: Bind to the specific school's database!
        const TenantApplication = req.tenantDb.model('Application', applicationSchema);
        const TenantUser = req.tenantDb.model('User', userSchema);

        const app = await TenantApplication.findById(req.params.id);
        if (!app) return res.status(404).json({ error: "Student not found" });

        // 🚀 THE FIX: Smart Email Synchronization
        const oldEmail = app.parentEmail || "";
        if (req.body.parentEmail && req.body.parentEmail.trim().toLowerCase() !== oldEmail.toLowerCase()) {
            const newEmail = req.body.parentEmail.trim().toLowerCase();
            
            // 1. Update the parent's actual login account so they aren't locked out!
            const parentUser = await TenantUser.findOne({ email: new RegExp('^' + oldEmail.trim() + '$', 'i'), role: 'Parent' });
            if (parentUser) {
                parentUser.email = newEmail;
                await parentUser.save();
            }
            
            // 2. Automatically update ALL siblings sharing this email so the family stays grouped
            await TenantApplication.updateMany(
                { parentEmail: new RegExp('^' + oldEmail.trim() + '$', 'i') },
                { $set: { parentEmail: newEmail } }
            );
            
            app.parentEmail = newEmail;
        }

        // Update the rest of the permitted fields
        if (req.body.studentName) app.studentName = req.body.studentName;
        if (req.body.parentPhone) app.parentPhone = req.body.parentPhone;
        if (req.body.targetClass) app.targetClass = req.body.targetClass;
        if (req.body.studentType) app.studentType = req.body.studentType;
        if (req.body.dateOfBirth) app.dateOfBirth = req.body.dateOfBirth;
        if (req.body.gender) app.gender = req.body.gender;
        if (req.body.religion) app.religion = req.body.religion;
        if (req.body.systemId) app.systemId = req.body.systemId;

        await app.save();

        // 🔒 THE BLACK BOX: Track Student Core Bio-data Edits
        logSystemAction(req, 'ADMINISTRATION', `Edited core profile data for student: ${app.studentName}`);

        res.json({ success: true, message: "Profile updated successfully! Login credentials synced.", application: app });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error updating profile." });
    }
});

// 🚀 3. NEW ROUTE: Parent Portal Secure Profile Update
// 🚀 3. NEW ROUTE: Parent Portal Secure Profile Update
app.put('/api/v1/parent/update-child/:studentId', verifyToken, async (req, res) => {
    try {
        // Ensure only parents can use this endpoint
        if (req.user.role !== 'Parent') return res.status(403).json({ error: "Unauthorized" });

        const { parentEmail, parentPhone, passportPhoto } = req.body;
        
        const app = await Application.findOne({ linkedStudentId: req.params.studentId });
        if (!app) return res.status(404).json({ error: "Student record not found." });

        // ☁️ CLOUDINARY INTERCEPTOR: Catch the updated photo from the parent
        let securePhotoUrl = passportPhoto;
        if (passportPhoto) {
            securePhotoUrl = await uploadToCloudinary(passportPhoto, 'student_passports');
        }

        if (parentEmail) app.parentEmail = parentEmail;
        if (parentPhone) app.parentPhone = parentPhone;
        if (securePhotoUrl) app.passportPhoto = securePhotoUrl; // 🚀 Save the tiny cloud URL

        await app.save();

        // Sync the photo to the User model as well so the portal matches
        if (securePhotoUrl) {
            await User.findByIdAndUpdate(req.params.studentId, { photo: securePhotoUrl });
        }

        res.json({ message: "Profile & Photo updated successfully!" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error updating profile." });
    }
});

// =====================================================================
// 👑 MASTER PLATFORM API ROUTES (SUPER ADMIN ONLY)
// =====================================================================

// 🚀 TEMPORARY SEED ROUTE: Run this ONCE to populate vertex_master
app.get('/api/v1/master/seed', async (req, res) => {
    try {
        // 1. Clear out any old buggy records
        await Tenant.deleteMany({}); 

        // 2. Define the exact schools with their new SUBDOMAINS
        const testTenants = [
            {
                schoolName: "Vertex Demo (Foundation)",
                adminEmail: "admin@foundation.com",
                subdomain: "foundation", // 🚀 THIS IS THE KEY TO THE NEW ENGINE
                dbName: "school_foundation",
                planTier: "Basic",
                status: "Active"
            },
            {
                schoolName: "Vertex Demo (Advance)",
                adminEmail: "admin@advance.com",
                subdomain: "advance",
                dbName: "school_advance",
                planTier: "Standard",
                status: "Active"
            },
            {
                schoolName: "Vertex Demo (Elite)",
                adminEmail: "admin@elite.com",
                subdomain: "elite",
                dbName: "school_elite",
                planTier: "Premium",
                status: "Active"
            }
        ];

        // 3. Inject them into the Master Database
        await Tenant.insertMany(testTenants);
        
        res.json({ 
            success: true, 
            message: "Master Database Seeded Successfully with Subdomains!",
            data: testTenants 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to seed Master DB." });
    }
});

// 🚀 SAAS PLATFORM: Global KPI Aggregator (Counts students across all databases)
app.get('/api/v1/master/dashboard-stats', async (req, res) => {
    try {
        const tenants = await Tenant.find({ status: 'Active' });
        const MasterInvoice = masterDb.model('MasterInvoice');
        
        let totalStudents = 0;
        let totalRevenue = 0;

        for (let t of tenants) {
            // Count students
            const targetDb = getTenantDB(t.dbName);
            const TargetApp = targetDb.model('Application', applicationSchema);
            const count = await TargetApp.countDocuments({ status: 'Admitted' });
            totalStudents += count;
        }

        // Aggregate Paid Revenue from Master Ledger
        const paidResult = await MasterInvoice.aggregate([
            { $match: { status: 'Paid' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        totalRevenue = paidResult.length > 0 ? paidResult[0].total : 0;

        res.json({ totalStudents, totalRevenue, totalSchools: tenants.length });
    } catch (e) { res.status(500).json({ error: "KPI update failed" }); }
});

app.get('/api/v1/master/billing/upgrades', async (req, res) => {
    try {
        // Define or access the UpgradeRequest model
        const upgradeSchema = new mongoose.Schema({
            tenantId: mongoose.Schema.Types.ObjectId,
            requestedPlan: String,
            status: { type: String, default: 'Pending' },
            createdAt: { type: Date, default: Date.now }
        });
        
        // Use masterDb connection (as defined at the top of your file)
        const UpgradeRequest = masterDb.models.UpgradeRequest || masterDb.model('UpgradeRequest', upgradeSchema);
        
        const requests = await UpgradeRequest.find({ status: 'Pending' });
        res.json(requests);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch upgrades." });
    }
});

// 1. Fetch all registered schools
// 🚀 UPDATED: Now fetches the tenant AND their live student count
app.get('/api/v1/master/tenants', async (req, res) => {
    try {
        const tenants = await Tenant.find().sort({ createdAt: -1 }).lean();
        
        // Loop through and attach the student count to each tenant object
        for(let t of tenants) {
            try {
                const db = getTenantDB(t.dbName);
                const App = db.model('Application', applicationSchema);
                t.studentCount = await App.countDocuments({ status: 'Admitted' });
            } catch(e) { 
                t.studentCount = 0; // If DB is unreachable, return 0
            }
        }
        res.json(tenants);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch schools." });
    }
});

// 2. Register a new school (Auto-Provisions their entire database!)
app.post('/api/v1/master/tenants', async (req, res) => {
    try {
        const { schoolName, adminEmail, dbName, subdomain, planTier } = req.body;

        // 1. Check if this subdomain is already taken
        const existingSubdomain = await Tenant.findOne({ subdomain });
        if (existingSubdomain) return res.status(400).json({ error: "Subdomain is already in use by another school." });

        // 2. Save the school to your Master Dashboard Ledger
        const newTenant = new Tenant({ schoolName, adminEmail, dbName, subdomain, planTier, status: 'Active' });
        await newTenant.save();

        // 🚀 3. THE MAGIC: JUMP INTO THE NEW DATABASE AND BUILD IT
        const targetDb = getTenantDB(dbName);
        
        const TargetUser = targetDb.model('User', userSchema);
        const TargetSettings = targetDb.model('Settings', settingsSchema);
        const TargetSub = targetDb.model('Subscription', subscriptionSchema);

        // Check if we are linking an old test database. If it's new, it will be empty.
        const existingAdmin = await TargetUser.findOne({ role: 'Super Admin' });
        
        // If no admin exists, this is a BRAND NEW school. We must create their login.
        if (!existingAdmin) {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash('AdminPass2026!', salt);

            await TargetUser.create({
                email: adminEmail,
                password: hashedPassword,
                fullName: 'System Owner',
                role: 'Super Admin',
                accountStatus: 'Active',
                systemId: 'SYS/ADM/001'
            });
        }

        // Initialize their Settings with their actual school name
        const existingSettings = await TargetSettings.findOne();
        if (!existingSettings) {
            await TargetSettings.create({ 
                schoolName: schoolName, 
                schoolShortName: schoolName.substring(0, 10).toUpperCase() 
            });
        }

        // Lock in their Subscription Plan
        const existingSub = await TargetSub.findOne();
        if (!existingSub) {
            await TargetSub.create({ planTier: planTier, accountStatus: 'Active' });
        } else {
            existingSub.planTier = planTier;
            await existingSub.save();
        }

        await sendMasterAlert({
    to: adminEmail,
    subject: `Welcome to Syncra - Your Platform is Ready!`,
    html: `
        <div style="font-family:sans-serif; padding:20px; border:1px solid #e2e8f0; border-radius:12px;">
            <h2 style="color:#4f46e5;">Welcome, ${schoolName}!</h2>
            <p>Your school platform is officially provisioned and ready for use.</p>
            <div style="background:#f1f5f9; padding:15px; border-radius:8px; margin:20px 0;">
                <p><strong>Portal URL:</strong> <a href="https://${subdomain}.vertexnextgen.com.ng">${subdomain}.vertexnextgen.com.ng</a></p>
                <p><strong>Initial Password:</strong> AdminPass2026!</p>
            </div>
            <p>Please log in and update your security settings immediately.</p>
        </div>`
});

        res.status(201).json({ 
            success: true, 
            message: `School database deployed!\n\nGive the owner these details:\nURL: ${subdomain}.vertexnextgen.com\nEmail: ${adminEmail}\nPass: AdminPass2026!` 
        });

    } catch (error) {
        console.error("Provisioning Error:", error);
        res.status(500).json({ error: "Failed to provision the new school database." });
    }
});

// 3. CROSS-DATABASE INJECTION & FULL TENANT EDIT
app.put('/api/v1/master/tenants/:id/manage', async (req, res) => {
    try {
        const { planTier, status, schoolName, subdomain, dbName, adminEmail } = req.body;
        
        // 1. Find the school in the Master DB
        const tenant = await Tenant.findById(req.params.id);
        if (!tenant) return res.status(404).json({ error: "School not found in Master DB." });

        // 2. Update Master Record with all allowed fields
        if (schoolName) tenant.schoolName = schoolName;
        if (subdomain) tenant.subdomain = subdomain.toLowerCase().trim();
        if (dbName) tenant.dbName = dbName.trim();
        if (adminEmail) tenant.adminEmail = adminEmail.trim();
        if (planTier) tenant.planTier = planTier;
        if (status) tenant.status = status;
        
        await tenant.save();

        // 🚀 3. THE SAAS CROSS-DATABASE INJECTION
        const targetDb = getTenantDB(tenant.dbName);
        
        const subSchema = new mongoose.Schema({ planTier: String, accountStatus: String }, { strict: false });
        const TargetSubscription = targetDb.model('Subscription', subSchema, 'subscriptions'); 

        // Force update their SaaS lock document inside their database
        await TargetSubscription.findOneAndUpdate(
            {}, 
            { $set: { planTier: tenant.planTier, accountStatus: tenant.status } }, 
            { upsert: true }
        );

        res.json({ success: true, message: `Successfully updated ${tenant.schoolName}'s profile and subscription!` });
    } catch (error) {
        console.error("Master Injection Error:", error);
        res.status(500).json({ error: "Failed to apply SaaS updates." });
    }
});

// =====================================================================
// 👑 MASTER PLATFORM BILLING (SaaS Subscription Engine via Paystack)
// =====================================================================

// IMPORTANT: Set up your Paystack Plans in your Paystack Dashboard and paste the Plan Codes in your .env file
// PLAN_BASIC_CODE=PLN_xxxx
// PLAN_STANDARD_CODE=PLN_xxxx
// PLAN_PREMIUM_CODE=PLN_xxxx

app.post('/api/v1/master/billing/generate-link', async (req, res) => {
    try {
        const { tenantId, adminEmail, planTier } = req.body;
        
        // 1. Get the correct Paystack Plan Code based on the requested tier
        let planCode = "";
        if (planTier === 'Basic') planCode = process.env.PLAN_BASIC_CODE;
        else if (planTier === 'Standard') planCode = process.env.PLAN_STANDARD_CODE;
        else if (planTier === 'Premium') planCode = process.env.PLAN_PREMIUM_CODE;

        if (!planCode) {
            return res.status(400).json({ error: "Paystack Plan Codes are not configured in the server .env file." });
        }

        // 2. Initialize a Transaction via Paystack API specifically linking to a Subscription Plan
        const https = require('https');
        const params = JSON.stringify({
            email: adminEmail,
            amount: 5000 * 100, // This initial charge amount is ignored because we are attaching a plan. The plan's amount overrides this.
            plan: planCode,
            metadata: {
                tenantId: tenantId,
                type: "saas_subscription"
            }
        });

        const options = {
            hostname: 'api.paystack.co',
            port: 443,
            path: '/transaction/initialize',
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.MASTER_PAYSTACK_SECRET}`,
                'Content-Type': 'application/json'
            }
        };

        const reqPaystack = https.request(options, resPaystack => {
            let data = '';
            resPaystack.on('data', (chunk) => { data += chunk; });
            resPaystack.on('end', () => {
                const response = JSON.parse(data);
                if (response.status) {
                    res.json({ success: true, authorizationUrl: response.data.authorization_url });
                } else {
                    res.status(400).json({ error: "Paystack Error: " + response.message });
                }
            });
        }).on('error', error => {
            res.status(500).json({ error: "Failed to connect to Paystack." });
        });

        reqPaystack.write(params);
        reqPaystack.end();

    } catch (error) {
        console.error("Billing Link Error:", error);
        res.status(500).json({ error: "Failed to generate billing link." });
    }
});

// 🚀 GET CURRENT DYNAMIC RATES
app.get('/api/v1/master/billing/rates', async (req, res) => {
    try {
        let config = await BillingSettings.findOne();
        if (!config) { config = new BillingSettings(); await config.save(); }
        res.json(config);
    } catch (err) { res.status(500).json({error: "Failed to load rates"}); }
});

// 🚀 UPDATE DYNAMIC RATES
app.put('/api/v1/master/billing/rates', async (req, res) => {
    try {
        const { Basic, Standard, Premium } = req.body;
        let config = await BillingSettings.findOne();
        if (!config) config = new BillingSettings();
        
        config.rates = { Basic: Number(Basic), Standard: Number(Standard), Premium: Number(Premium) };
        config.lastUpdated = Date.now();
        await config.save();
        
        res.json({ success: true, message: "Global pricing updated successfully!" });
    } catch (err) { res.status(500).json({error: "Failed to update rates"}); }
});

// 🚀 CALCULATE PER-STUDENT DEBT AND GENERATE INVOICE
app.post('/api/v1/master/billing/generate-school-invoice', async (req, res) => {
    try {
        const { tenantId } = req.body;
        const tenant = await Tenant.findById(tenantId);
        if (!tenant) return res.status(404).json({ error: "School not found." });

        // 1. Fetch rates dynamically from the Master DB
        const billingConfig = await BillingSettings.findOne() || { rates: { Basic: 500, Standard: 600, Premium: 700 }};
        const ratePerStudent = billingConfig.rates[tenant.planTier] || 500;

        // 2. Count active students in this specific school's DB
        const targetDb = getTenantDB(tenant.dbName);
        const TargetApp = targetDb.model('Application', applicationSchema);
        const studentCount = await TargetApp.countDocuments({ status: 'Admitted' });

        const totalAmount = studentCount * ratePerStudent;

        // 3. Generate the Invoice
        const inv = new MasterInvoice({ 
            tenantId, 
            schoolName: tenant.schoolName, 
            amount: totalAmount, 
            studentCount,
            rateUsed: ratePerStudent
        });
        await inv.save();

        res.json({ success: true, totalAmount, studentCount, rateUsed: ratePerStudent, invoiceId: inv._id });
    } catch (err) {
        console.error("Billing Generation Error:", err);
        res.status(500).json({ error: "Failed to generate billing." });
    }
});

// 🚀 1. GET PRICING RATES
app.get('/api/v1/master/billing/rates', async (req, res) => {
    try {
        let config = await BillingSettings.findOne() || { rates: { Basic: 500, Standard: 600, Premium: 700 }};
        res.json(config);
    } catch(err) { res.status(500).json({ error: "Failed to load rates" }); }
});

// 🚀 2. UPDATE PRICING RATES
app.put('/api/v1/master/billing/rates', async (req, res) => {
    try {
        const { Basic, Standard, Premium } = req.body;
        await BillingSettings.findOneAndUpdate({}, 
            { rates: { Basic, Standard, Premium }, lastUpdated: Date.now() }, 
            { upsert: true }
        );
        res.json({ success: true, message: "Global pricing updated!" });
    } catch(err) { res.status(500).json({ error: "Update failed" }); }
});

// 🚀 3. GENERATE SCHOOL INVOICE
app.post('/api/v1/master/billing/generate-school-invoice', async (req, res) => {
    try {
        const { tenantId } = req.body;
        const tenant = await Tenant.findById(tenantId);
        if (!tenant) return res.status(404).json({ error: "School not found." });

        const billingConfig = await BillingSettings.findOne() || { rates: { Basic: 500, Standard: 600, Premium: 700 }};
        const ratePerStudent = billingConfig.rates[tenant.planTier] || 500;

        const targetDb = getTenantDB(tenant.dbName);
        const TargetApp = targetDb.model('Application', applicationSchema);
        const studentCount = await TargetApp.countDocuments({ status: 'Admitted' });

        const totalAmount = studentCount * ratePerStudent;
        const inv = new MasterInvoice({ 
            tenantId, 
            schoolName: tenant.schoolName, 
            amount: totalAmount, 
            studentCount,
            rateUsed: ratePerStudent
        });
        await inv.save();

        res.json({ success: true, totalAmount, studentCount, rateUsed: ratePerStudent, invoiceId: inv._id });
    } catch (err) {
        res.status(500).json({ error: "Failed to generate billing." });
    }
});

// 🚀 4. FETCH LEDGER
app.get('/api/v1/master/billing/ledger', async (req, res) => {
    try {
        const ledgers = await MasterInvoice.find().sort({ createdAt: -1 });
        res.json(ledgers);
    } catch(err) { res.status(500).json({ error: "Failed to fetch ledger." }); }
});



// 🚀 5. MARK PAID
app.put('/api/v1/master/billing/mark-paid/:id', async (req, res) => {
    try {
        const MasterInvoice = masterDb.model('MasterInvoice');
        const inv = await MasterInvoice.findById(req.params.id);
        const tenant = await Tenant.findById(inv.tenantId);
        
        await MasterInvoice.findByIdAndUpdate(req.params.id, { status: 'Paid', paidAt: new Date() });
        
        // 🚀 SMART NOTIFICATION: Connects to the school's specific database and notifies them
        const tenantDb = getTenantDB(tenant.dbName);
        await sendSystemMessage(
            tenantDb, 
            'Admin', 
            'School Admin', 
            'Admin', 
            '💳 Payment Confirmed', 
            `Vertex Nextgen has confirmed your payment of ₦${inv.amount.toLocaleString()}. Your account ledger for this billing batch is now marked as PAID.`
        );

        res.json({ success: true });
    } catch(err) { res.status(500).json({ error: "Update failed." }); }
});

app.get('/api/v1/master/billing/total-received', async (req, res) => {
    try {
        const MasterInvoice = masterDb.model('MasterInvoice');
        const result = await MasterInvoice.aggregate([
            { $match: { status: 'Paid' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        res.json({ total: result.length > 0 ? result[0].total : 0 });
    } catch(e) { res.status(500).json({error: "Failed to fetch revenue"}); }
});

app.put('/api/v1/master/billing/approve-upgrade/:id', async (req, res) => {
    try {
        const UpgradeRequest = masterDb.model('UpgradeRequest');
        const reqDoc = await UpgradeRequest.findById(req.params.id);
        const tenant = await Tenant.findById(reqDoc.tenantId);

        // 1. Update the Plan in Master Ledger
        tenant.planTier = reqDoc.requestedPlan;
        await tenant.save();

        // 2. Cross-Database Sync: Update the subscription in the school's DB
        const targetDb = getTenantDB(tenant.dbName);
        const TargetSubscription = targetDb.model('Subscription', subscriptionSchema, 'subscriptions');
        await TargetSubscription.findOneAndUpdate({}, { $set: { planTier: reqDoc.requestedPlan } }, { upsert: true });

        // 3. Mark request as approved
        reqDoc.status = 'Approved';
        await reqDoc.save();

        res.json({ success: true, message: `Successfully upgraded ${tenant.schoolName} to ${reqDoc.requestedPlan}` });
    } catch(err) { res.status(500).json({ error: "Approval failed." }); }
});

// --- VERCEL COMPATIBLE BOOT SEQUENCE ---
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => { console.log(`Backend Server running on http://localhost:${PORT}`); });
}

// ==========================================
// 🏫 SCHOOL STORE & INVENTORY ENGINE
// ==========================================
app.get('/api/v1/inventory', verifyToken, requireFeature('schoolStore'), async (req, res) => {
    try {
        const TenantInventory = req.tenantDb.model('InventoryItem', inventorySchema);
        const inventory = await TenantInventory.find().sort({ itemName: 1 }).lean();
        res.json(inventory);
    } catch (error) { res.status(500).json({ error: "Error loading inventory." }); }
});

app.post('/api/v1/inventory', verifyAdmin, requireFeature('schoolStore'), async (req, res) => {
    try {
        const TenantInventory = req.tenantDb.model('InventoryItem', inventorySchema);
        const newItem = new TenantInventory(req.body);
        await newItem.save();
        res.status(201).json({ success: true, message: "Item added to inventory!" });
    } catch(e) { res.status(500).json({ error: "Failed to add item." }); }
});

app.put('/api/v1/inventory/:id/sell', verifyAdmin, requireFeature('schoolStore'), async (req, res) => {
    try {
        const TenantInventory = req.tenantDb.model('InventoryItem', inventorySchema);
        const TenantTransaction = req.tenantDb.model('Transaction', transactionSchema);
        const { buyerName, quantityToSell, session, term } = req.body;
        
        const item = await TenantInventory.findById(req.params.id);
        if (!item || item.quantity < quantityToSell) return res.status(400).json({error: "Not enough stock available."});
        
        item.quantity -= quantityToSell;
        await item.save();

        const totalCost = item.price * quantityToSell;
        const trans = new TenantTransaction({
            name: buyerName || "Walk-in Buyer",
            amount: totalCost,
            type: 'Income',
            description: `Store Sale: ${quantityToSell}x ${item.itemName}`,
            session, term
        });
        await trans.save();

        // 🛡️ AUDIT TRAIL: Log Store Sale
        logSystemAction(req, 'FINANCE', `School Store Sale: Sold ${quantityToSell}x ${item.itemName} to ${buyerName || 'Walk-in Buyer'} for ₦${totalCost.toLocaleString()}`);

        res.json({ success: true, message: `Sold ${quantityToSell}x ${item.itemName} for ₦${totalCost.toLocaleString()}` });
    } catch(e) { res.status(500).json({ error: "Failed to process sale." }); }
});

// ==========================================
// 🚀 MISSING SAAS ROUTES (STORE & FINANCIAL AUDIT)
// ==========================================

app.get('/api/v1/admin/financial-audit', verifyAdmin, requireFeature('financialAudit'), async (req, res) => {
    try {
        const TenantTransaction = req.tenantDb.model('Transaction', transactionSchema);
        const { session, term, feeType } = req.query;
        
        let query = {};
        if (session && session !== 'All') query.session = session;
        
        // 🚀 SMART SAAS FIX: Fuzzy matching
        if (term && term !== 'Entire Session (All Terms)') {
            const cleanTerm = term.replace(/ term/i, '').trim();
            query.term = new RegExp('^' + cleanTerm, 'i');
        }
        
        if (feeType && feeType !== 'All') query.description = { $regex: feeType, $options: 'i' };

        const transactions = await TenantTransaction.find(query).sort({ date: -1 }).lean();
        
        let totalIncome = 0; let totalExpenses = 0;
        transactions.forEach(t => {
            if (t.type === 'Income') totalIncome += t.amount;
            if (t.type === 'Expense') totalExpenses += t.amount;
        });

        res.json({ totalIncome, totalExpenses, netRevenue: totalIncome - totalExpenses, transactions });
    } catch (error) { res.status(500).json({ error: "Error analyzing records." }); }
});

// 🚀 SAAS AUTOMATED EXPIRATION REMINDER (Runs daily at 8:00 AM)
cron.schedule('0 8 * * *', async () => {
    console.log("⏰ Running Daily Subscription Expiration Check...");
    
    try {
        const today = new Date();
        const sevenDaysFromNow = new Date();
        sevenDaysFromNow.setDate(today.getDate() + 7);

        // Find all schools expiring in exactly 7 days
        const expiringSchools = await Tenant.find({
            nextBillingDate: {
                $gte: new Date(sevenDaysFromNow.setHours(0,0,0,0)),
                $lte: new Date(sevenDaysFromNow.setHours(23,59,59,999))
            },
            status: 'Active'
        });

        for (const school of expiringSchools) {
            console.log(`🔔 Sending expiration alert to: ${school.schoolName}`);
            
            await sendMasterAlert({
                to: school.adminEmail,
                subject: `⚠️ Subscription Expiration Notice: ${school.schoolName}`,
                html: `
                    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
                        <h2 style="color: #f59e0b;">Subscription Expiring Soon</h2>
                        <p>Dear ${school.schoolName} Admin,</p>
                        <p>This is a friendly reminder that your subscription to the Vertex Nextgen platform expires in <strong>7 days</strong> (${new Date(school.nextBillingDate).toLocaleDateString()}).</p>
                        <p>To ensure your school continues to enjoy uninterrupted services, please process your renewal invoice via the Master Portal.</p>
                        <br>
                        <a href="https://master.vertexnextgen.com.ng" style="background:#4f46e5; color:white; padding:12px 20px; border-radius:8px; text-decoration:none; font-weight:bold;">Go to Master Portal</a>
                    </div>`
            });
        }
    } catch (err) {
        console.error("Cron Job Error:", err);
    }
});

// 🚀 DAILY AUTO-SYNC: Updates student counts every morning at 1:00 AM
cron.schedule('0 1 * * *', async () => {
    console.log("📊 Starting Daily Student Count Sync...");
    const tenants = await Tenant.find({ status: 'Active' });
    
    for (let t of tenants) {
        try {
            const targetDb = getTenantDB(t.dbName);
            const TargetApp = targetDb.model('Application', applicationSchema);
            const count = await TargetApp.countDocuments({ status: 'Admitted' });
            
            // Update the cache in the Master DB
            await Tenant.findByIdAndUpdate(t._id, { activeStudentCount: count });
        } catch (err) {
            console.error(`Sync failed for ${t.schoolName}:`, err);
        }
    }
});

// Export app BEFORE defining the mailer function to avoid cycles
module.exports = app;

// ==========================================
// 12. SaaS DYNAMIC MAILER ENGINE
// ==========================================
const nodemailer = require('nodemailer');

// 🚀 SAAS FIX: Pass 'req' into the function so it knows which database to use!
async function sendSchoolEmail(req, mailOptions) {
    try {
        // 🚀 SAAS FIX: Bind to the specific school's database
        const TenantSettings = req.tenantDb.model('Settings', settingsSchema);
        const settings = await TenantSettings.findOne();

        if (!settings || !settings.smtpUser || !settings.smtpPass) {
            console.log("⚠️ Email Skipped: SMTP settings not configured in School Settings.");
            return false;
        }

        const transporter = nodemailer.createTransport({
            host: settings.smtpHost,
            port: settings.smtpPort,
            secure: Number(settings.smtpPort) === 465, 
            auth: { user: settings.smtpUser, pass: settings.smtpPass }
        });

        mailOptions.from = `"${settings.smtpSender}" <${settings.smtpUser}>`;
        
        // 1. Send the email
        await transporter.sendMail(mailOptions);
        
        // 🛑 WINDOWS CRASH FIX: We removed transporter.close(); 
        // Nodemailer will clean itself up automatically. Forcing it closed causes the UV_HANDLE_CLOSING crash on Windows.
        
        console.log(`✅ Email delivered to: ${mailOptions.to}`);
        return true;
    } catch (err) {
        console.error("🚨 Mailer Error:", err);
        return false;
    }
}

// 🚀 SAAS PLATFORM MAILER: Guaranteed delivery using Global .env variables
async function sendMasterAlert(mailOptions) {
    try {
        if (!process.env.MASTER_SMTP_USER || !process.env.MASTER_SMTP_PASS) {
            console.log("⚠️ Master Alert Skipped: Missing MASTER_SMTP credentials in .env file.");
            return false;
        }

        const transporter = nodemailer.createTransport({
            host: process.env.MASTER_SMTP_HOST || "smtp.gmail.com",
            port: Number(process.env.MASTER_SMTP_PORT) || 465,
            secure: true, 
            auth: { 
                user: process.env.MASTER_SMTP_USER, 
                pass: process.env.MASTER_SMTP_PASS 
            }
        });

        mailOptions.from = `"Vertex SaaS Platform" <${process.env.MASTER_SMTP_USER}>`;
        
        await transporter.sendMail(mailOptions);
        
        console.log(`✅ Master Sales Alert delivered to: ${mailOptions.to}`);
        return true;
    } catch (err) {
        console.error("🚨 Master Mailer Error:", err);
        return false;
    }
}