/**
 * ---------------------------------------------------------------------
 * MERGED SERVER.JS - PRODUCTION READY
 * ---------------------------------------------------------------------
 */
import 'dotenv/config';
import path from "path";
import fs from "fs";
import express from "express";
import compression from "compression";
import session from "express-session";
import errorHandler from "errorhandler";
import lusca from "lusca";
import MongoStore from "connect-mongo";
import mongoose from "mongoose";
import passport from "passport";
import rateLimit from "express-rate-limit";
import axios from "axios";
import { WebSocketServer } from "ws";
import { MongoClient } from "mongodb";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import mongoSanitize from "express-mongo-sanitize";

// ── AdminJS imports ──────────────────────────────────────────────────────────
import { AdminJS, ComponentLoader } from 'adminjs';
import AdminJSExpress from '@adminjs/express';
import * as AdminJSMongoose from '@adminjs/mongoose';

AdminJS.registerAdapter(AdminJSMongoose.default || AdminJSMongoose);

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── AdminJS Component Loader ─────────────────────────────────────────────────
const componentLoader = new ComponentLoader();
const Components = {
    Dashboard: componentLoader.add('Dashboard', path.join(__dirname, './components/Dashboard.jsx')),
};

/** --------------------------
 * CONTROLLERS & CONFIG
 * -------------------------- */
const homeController    = require("./controllers/home.cjs");
const userController    = require("./controllers/user.cjs");
const apiController     = require("./controllers/api.cjs");
const aiController      = require("./controllers/ai.cjs");
const contactController = require("./controllers/contact.cjs");

const passportConfig = require('./config/passport.cjs');
const { flash }        = require("./config/flash.cjs");
const { morganLogger } = require("./config/morgan.cjs");

/** --------------------------
 * CONSTANTS & ENV
 * -------------------------- */
const IS_PRODUCTION  = process.env.NODE_ENV === 'production';
const secureTransfer = IS_PRODUCTION || process.env.BASE_URL?.startsWith("https") || false;
const ADMIN_PATH     = `/${(process.env.ADMIN_PATH || 'electric-puffin-vault-12').trim().replace(/^\//, '')}`;
const BUNDLE_DIR     = '/tmp/adminjs';

/** --------------------------
 * RATE LIMITERS
 * -------------------------- */
const strictLimiter  = rateLimit({ windowMs: 60 * 60 * 1000, max: parseInt(process.env.RATE_LIMIT_STRICT, 10) || 5 });
const loginLimiter   = rateLimit({ windowMs: 60 * 60 * 1000, max: parseInt(process.env.RATE_LIMIT_LOGIN, 10) || 10 });
const reviewLimiter  = rateLimit({ windowMs: 60 * 60 * 1000, max: parseInt(process.env.RATE_LIMIT_REVIEW, 10) || 20 });
const contactFormLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: { error: "Too many messages." } });
const chatbotLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 15, message: { error: "Chatting too fast!" } });

/** --------------------------
 * MONGOOSE MODELS
 * -------------------------- */
const Review = mongoose.models.Review || mongoose.model("Review", new mongoose.Schema({
    name: String, stars: { type: Number, min: 1, max: 5 }, review_text: String,
    profile_pic: { type: String, default: "https://imgs.search.brave.com/pbruKhRTdtOMZ06961RdlA7ykd9NKAsJilAOtY79yHk/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9wbmdm/cmUuY29tL3dwLWNv/bnRlbnQvdXBsb2Fk/cy8xMDAwMTE3OTc1/LTEtMzAweDI3NS5w/bmc" },
    createdAt: { type: Date, default: Date.now }
}), "reviews");

const Contact = mongoose.models.Contact || mongoose.model("Contact", new mongoose.Schema({
    fullName: { type: String, required: true }, email: String, phone: { type: String, required: true },
    message: { type: String, required: true }, messageNumber: Number, createdAt: { type: Date, default: Date.now }
}), "contact");

const Response = mongoose.models.Response || mongoose.model('Response', new mongoose.Schema({
    sessionId: String, sender: String, message: String, meta: mongoose.Schema.Types.Mixed, timestamp: { type: Date, default: Date.now }
}));

const Alert = mongoose.models.Alert || mongoose.model('Alert', new mongoose.Schema({
    ip: String, userAgent: String, pathAttempted: String, timestamp: { type: Date, default: Date.now }
}));

const Analytics = mongoose.models.Analytics || mongoose.model('Analytics', new mongoose.Schema({
    path: String, source: { type: String, default: 'direct' }, timestamp: { type: Date, default: Date.now }
}));

const LastLoggedIn = mongoose.models.LastLoggedIn || mongoose.model('LastLoggedIn', new mongoose.Schema({
    email: String, loginAt: { type: Date, default: Date.now }
}), 'lastloggedin');

/** --------------------------
 * HELPERS
 * -------------------------- */
const detectSource = (ua = '') => {
    const l = ua.toLowerCase();
    if (l.includes('instagram')) return 'instagram';
    if (l.includes('tiktok')) return 'tiktok';
    if (l.includes('facebook')) return 'facebook';
    return 'direct';
};

const maskName = (name) => {
    if (!name) return "Anonymous";
    const str = String(name).trim();
    return str.length <= 2 ? str : str.substring(0, 2) + "*".repeat(str.length - 2);
};

const n8nPost = (payload) => axios.post(process.env.N8N_WEBHOOK_URL, payload, {
    headers: { "x-hydro-sweep-auth": process.env.N8N_AUTH_SECRET || "" }, timeout: 25000
});

async function verifyRecaptchaToken(token, remoteip) {
    const params = new URLSearchParams({ secret: process.env.RECAPTCHA_SECRET_KEY, response: token });
    if (remoteip) params.append('remoteip', remoteip);
    const resp = await axios.post('https://www.google.com/recaptcha/api/siteverify', params);
    return resp.data;
}

const ipWhitelist = (req, res, next) => {
    const allowed = (process.env.ALLOWED_IP || '').trim();
    if (!allowed) return next();
    const clientIp = req.ips?.[0] || req.ip || '';
    if (['::1', '127.0.0.1'].includes(clientIp) || clientIp === allowed) return next();
    res.status(404).send('Not Found');
};

/** --------------------------
 * EXPRESS APP SETUP
 * -------------------------- */
const app = express();
app.set("host", "0.0.0.0");
app.set("port", process.env.PORT || 8080);
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");
app.set("trust proxy", 1);

app.use(morganLogger());
app.use(compression());
app.disable("x-powered-by");
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(mongoSanitize());

/** --------------------------
 * BOOTSTRAP FUNCTION
 * -------------------------- */
async function startServer() {
    // 1. Database Connection
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB Connected ✅");

    // 2. AdminJS Mount
    const SESSION_SECRET = (process.env.SESSION_SECRET || 'hydro-sweep-admin-secret-32-chars').trim();
    const admin = new AdminJS({
        resources: [Review, Response, Contact, Alert, Analytics, LastLoggedIn],
        rootPath: ADMIN_PATH,
        loginPath: `${ADMIN_PATH}/login`,
        logoutPath: `${ADMIN_PATH}/logout`,
        componentLoader,
        branding: { companyName: 'Hydro Sweep Services', withMadeWithLove: false },
        dashboard: {
            component: Components.Dashboard,
            handler: async () => {
                const now = new Date();
                const startOfToday = new Date(now).setHours(0,0,0,0);
                const start7Days = new Date(now).setDate(now.getDate() - 7);
                
                const [viewsToday, viewsAllTime, leadsCount, recentContacts, lastLogin] = await Promise.all([
                    Analytics.countDocuments({ timestamp: { $gte: startOfToday } }),
                    Analytics.countDocuments(),
                    Contact.countDocuments(),
                    Contact.find().sort({ createdAt: -1 }).limit(5).lean(),
                    LastLoggedIn.findOne().sort({ loginAt: -1 }).lean(),
                ]);

                return { viewsToday, viewsAllTime, leadsCount, recentContacts, lastLogin: lastLogin?.loginAt };
            }
        },
    });

    // Asset serving fix for Render
    if (IS_PRODUCTION) {
        admin.options.env = { NODE_ENV: 'development' }; 
        admin.options.bundler = { bundleDir: BUNDLE_DIR };
    }

    await admin.initialize();
    
    // Serve the actual bundled assets from /tmp
    app.use(`${ADMIN_PATH}/frontend/assets`, express.static(BUNDLE_DIR));

    const adminRouter = AdminJSExpress.buildAuthenticatedRouter(admin, {
        authenticate: async (email, password) => {
            if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
                await LastLoggedIn.findOneAndUpdate({}, { email, loginAt: new Date() }, { upsert: true });
                return { email };
            }
            return null;
        },
        cookieName: 'adminjs-session',
        cookiePassword: SESSION_SECRET.padEnd(32, '0').substring(0, 32),
    }, null, {
        resave: false, saveUninitialized: true, secret: SESSION_SECRET, name: 'adminjs-sid',
        cookie: { httpOnly: true, sameSite: secureTransfer ? 'none' : 'lax', secure: secureTransfer, maxAge: 86400000 },
        store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
    });

    app.use(ADMIN_PATH, ipWhitelist, adminRouter);

    // 3. Main App Session & Passport
    app.use(session({
        resave: true, saveUninitialized: false, secret: SESSION_SECRET,
        name: "startercookie", cookie: { maxAge: 1209600000, secure: secureTransfer },
        store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
    }));

    app.use(passport.initialize());
    app.use(passport.session());
    app.use(flash);

    // 4. CSRF & Security
    app.use((req, res, next) => {
        const bypass = ["/api/upload", "/ai/togetherai-camera", "/send-to-n8n", ADMIN_PATH];
        if (bypass.some(path => req.originalUrl.startsWith(path))) return next();
        lusca.csrf()(req, res, next);
    });

    app.use((req, res, next) => {
        res.locals.user = req.user;
        res.locals.messages = req.flash ? req.flash() : {};
        next();
    });

    // 5. Analytics Middleware
    const trackViews = async (req, res, next) => {
        if (!req.session.viewTracked) {
            req.session.viewTracked = true;
            Analytics.create({ path: req.path, source: detectSource(req.headers['user-agent']) }).catch(() => {});
        }
        next();
    };

    // 6. Routes
    app.get("/", trackViews, (req, res) => {
        const indexPath = path.join(__dirname, "public", "index.html");
        fs.readFile(indexPath, 'utf8', (err, data) => {
            if (err) return res.status(500).send("Server Error");
            res.send(data.replace(/<%= RECAPTCHA_SITE_KEY %>|YOUR_RECAPTCHA_SITE_KEY_HERE/g, process.env.RECAPTCHA_SITE_KEY || ''));
        });
    });

    app.get("/login", userController.getLogin);
    app.post("/login", loginLimiter, userController.postLogin);
    app.get("/logout", userController.logout);
    app.get("/signup", userController.getSignup);
    app.post("/signup", loginLimiter, userController.postSignup);
    app.get("/contact", strictLimiter, contactController.getContact);
    app.post("/api/contact", contactFormLimiter, async (req, res) => {
        const { fullName, phone, message } = req.body;
        const last = await Contact.findOne().sort({ messageNumber: -1 });
        const nextNum = (last?.messageNumber || 0) + 1;
        await new Contact({ ...req.body, messageNumber: nextNum }).save();
        res.json({ success: true, messageNumber: nextNum });
    });

    app.get('/api/reviews', async (req, res) => {
        const reviews = await Review.find().sort({ createdAt: -1 }).limit(5);
        res.json({ reviews: reviews.map(r => ({ ...r.toObject(), name: maskName(r.name) })) });
    });

    app.post("/send-to-n8n", chatbotLimiter, async (req, res) => {
        const { message, sessionId } = req.body;
        const resp = await n8nPost({ message, sessionId });
        res.json({ reply: resp.data.reply || resp.data });
    });

    app.use("/", express.static(path.join(__dirname, "public")));
    app.use((req, res) => res.status(404).send("Page Not Found"));

    // 7. Start Listening
    const server = app.listen(app.get("port"), () => {
        console.log(`🚀 Server running on port ${app.get("port")}`);
    });

    const wss = new WebSocketServer({ server });
    wss.on("connection", (ws) => {
        ws.on("message", async (raw) => {
            const { message, sessionId } = JSON.parse(raw.toString());
            const resp = await n8nPost({ message, sessionId });
            ws.send(JSON.stringify({ reply: resp.data.reply || resp.data }));
        });
    });
}

startServer().catch(err => {
    console.error("Critical Startup Error:", err);
    process.exit(1);
});

export default app;
