/**
 * ---------------------------------------------------------------------
 * MERGED SERVER.JS
 * Main Project (N8N Chatbot + Reviews + Pug + Contact)
 * + AdminJS Secure Dashboard (Analytics Fixes & Independent Session)
 * ---------------------------------------------------------------------
 *
 * RENDER PRODUCTION FIX — EPHEMERAL FILESYSTEM:
 *
 *  Render's filesystem is read-only at the project root. Any .adminjs/
 *  folder written during the build step is LOST when the dyno restarts.
 *  The solution is to write the AdminJS component bundle into /tmp at
 *  startup (which IS writable at runtime), then serve it as a static
 *  route so the browser can load components.bundle.js correctly.
 *
 *  Key settings:
 *   • ADMIN_BUNDLE_PATH env var (default: /tmp/adminjs-bundles)
 *   • AdminJS env forced to { NODE_ENV: 'development' } — this tells
 *     AdminJS's ComponentLoader to actually RUN the bundler even when
 *     the global NODE_ENV is 'production'. Without this the bundler
 *     skips and components.bundle.js is never generated.
 *   • express.static path EXACTLY matches the bundlePath so the browser
 *     request for /ADMIN_PATH/frontend/assets/components.bundle.js
 *     resolves to /tmp/adminjs-bundles/components.bundle.js.
 *   • AdminJS mounts BEFORE body parsers, session, CSRF.
 *   • CSRF bypass uses req.originalUrl (not req.path).
 *   • Admin session is isolated from the main app session.
 *   • IP whitelist skipped when ALLOWED_IP is blank.
 *   • Admin cookie sameSite:'none' on HTTPS (required for Render).
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
 * RATE LIMITERS
 * -------------------------- */
const strictLimiter  = rateLimit({ windowMs: 60 * 60 * 1000, max: parseInt(process.env.RATE_LIMIT_STRICT, 10) || 5 });
const loginLimiter   = rateLimit({ windowMs: 60 * 60 * 1000, max: parseInt(process.env.RATE_LIMIT_LOGIN, 10) || 10 });
const reviewLimiter  = rateLimit({ windowMs: 60 * 60 * 1000, max: parseInt(process.env.RATE_LIMIT_REVIEW, 10) || 20 });

const contactFormLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, max: 10,
    message: { error: "Too many messages. Please try again later." }
});

const chatbotLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: "You're chatting a bit too fast! Please wait a few seconds before your next message."
    }
});

const IS_PRODUCTION  = process.env.NODE_ENV === 'production';
const secureTransfer = IS_PRODUCTION || process.env.BASE_URL?.startsWith("https") || false;

// ADMIN_PATH: strip any accidental leading slash from env var, then prepend one.
// Render env var should be:  ADMIN_PATH=electric-puffin-vault-12  (no slash)
const ADMIN_PATH = `/${(process.env.ADMIN_PATH || 'electric-puffin-vault-12').trim().replace(/^\//, '')}`;

// BUNDLE PATH: /tmp is always writable on Render at runtime.
// Override via ADMIN_BUNDLE_PATH env var if needed.
const BUNDLE_PATH = (process.env.ADMIN_BUNDLE_PATH || '/tmp/adminjs-bundles').trim();

/** --------------------------
 * MONGOOSE MODELS
 * -------------------------- */
const reviewSchema = new mongoose.Schema({
    name: String, stars: { type: Number, min: 1, max: 5 }, review_text: String,
    profile_pic: { type: String, default: "https://imgs.search.brave.com/pbruKhRTdtOMZ06961RdlA7ykd9NKAsJilAOtY79yHk/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9wbmdm/cmUuY29tL3dwLWNv/bnRlbnQvdXBsb2Fk/cy8xMDAwMTE3OTc1/LTEtMzAweDI3NS5w/bmc" },
    createdAt: { type: Date, default: Date.now }
});
const Review = mongoose.models.Review || mongoose.model("Review", reviewSchema, "reviews");

const contactSchema = new mongoose.Schema({
    fullName: { type: String, required: true }, email: { type: String, required: false },
    phone: { type: String, required: true }, message: { type: String, required: true },
    messageNumber: { type: Number }, createdAt: { type: Date, default: Date.now }
});
const Contact = mongoose.models.Contact || mongoose.model("Contact", contactSchema, "contact");

const responseSchema = new mongoose.Schema({
    sessionId: String, sender: String, message: String, meta: { type: mongoose.Schema.Types.Mixed }, timestamp: { type: Date, default: Date.now }
});
const Response = mongoose.models.Response || mongoose.model('Response', responseSchema);

const alertSchema = new mongoose.Schema({
    ip: String, userAgent: String, pathAttempted: String, timestamp: { type: Date, default: Date.now }
});
const Alert = mongoose.models.Alert || mongoose.model('Alert', alertSchema);

// ── Analytics: one document = one unique visitor session ─────────────────────
const analyticsSchema = new mongoose.Schema({
    path:      { type: String },
    source:    { type: String, default: 'direct' },
    timestamp: { type: Date,   default: Date.now  },
});
const Analytics = mongoose.models.Analytics || mongoose.model('Analytics', analyticsSchema);

const lastLoggedInSchema = new mongoose.Schema({
    email: String, loginAt: { type: Date, default: Date.now },
});
const LastLoggedIn = mongoose.models.LastLoggedIn || mongoose.model('LastLoggedIn', lastLoggedInSchema, 'lastloggedin');

/** --------------------------
 * HELPER FUNCTIONS
 * -------------------------- */
function detectSource(userAgent = '') {
    const ua = userAgent.toLowerCase();
    if (ua.includes('instagram')) return 'instagram';
    if (ua.includes('tiktok') || ua.includes('musical_ly') || ua.includes('bytedance')) return 'tiktok';
    if (ua.includes('fban') || ua.includes('fbav') || ua.includes('facebook') || ua.includes('[fb')) return 'facebook';
    return 'direct';
}

async function verifyRecaptchaToken(token, remoteip) {
    const secret = process.env.RECAPTCHA_SECRET_KEY;
    if (!secret) throw new Error('RECAPTCHA_SECRET_KEY not set');
    const params = new URLSearchParams();
    params.append('secret', secret);
    params.append('response', token);
    if (remoteip) params.append('remoteip', remoteip);
    const resp = await axios.post('https://www.google.com/recaptcha/api/siteverify', params);
    return resp.data;
}

function n8nPost(payload) {
    if (!process.env.N8N_WEBHOOK_URL) throw new Error("N8N_WEBHOOK_URL is not set");
    return axios.post(process.env.N8N_WEBHOOK_URL, payload, {
        headers: { "x-hydro-sweep-auth": process.env.N8N_AUTH_SECRET || "" },
        timeout: 25000
    });
}

const maskName = (name) => {
    if (!name) return "Anonymous";
    const str = String(name).trim();
    if (str.length <= 2) return str;
    return str.substring(0, 2) + "*".repeat(str.length - 2);
};

// ── AdminJS IP Whitelist ──────────────────────────────────────────────────────
// Leave ALLOWED_IP blank on Render — Cloudflare sits in front so your real IP
// never arrives. The secret URL path is sufficient protection.
const ipWhitelist = (req, res, next) => {
    const allowed = (process.env.ALLOWED_IP || '').trim();
    if (!allowed) return next();

    const clientIp = (req.ips && req.ips.length > 0) ? req.ips[0] : (req.ip || '');
    const isLocal  = ['::1', '127.0.0.1', '::ffff:127.0.0.1'].includes(clientIp)
        || clientIp.startsWith('::ffff:127.');

    if (isLocal || clientIp === allowed) return next();

    console.warn(`[AdminJS] Blocked IP: ${clientIp}`);
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

// trust proxy must be set before AdminJS mounts so req.ips is populated
app.set("trust proxy", 1);

app.use(morganLogger());
app.use(compression());
app.disable("x-powered-by");

/** --------------------------
 * ADMINJS SETUP
 * -------------------------- */
async function buildAndMountAdminJS() {
    const SESSION_SECRET = (process.env.SESSION_SECRET || 'hydro-sweep-admin-secret-32-chars').trim();
    const ADMIN_EMAIL    = (process.env.ADMIN_EMAIL    || '').trim();
    const ADMIN_PASS     = (process.env.ADMIN_PASSWORD || '').trim();

    // Ensure the bundle output directory exists and is writable.
    // On Render this will be /tmp/adminjs-bundles which survives the whole
    // process lifetime (but NOT across redeploys — that's fine, we bundle
    // fresh on every startup which takes ~5s).
    fs.mkdirSync(BUNDLE_PATH, { recursive: true });
    console.log(`📁 AdminJS bundle path: ${BUNDLE_PATH}`);

    const admin = new AdminJS({
        resources: [Review, Response, Contact, Alert, Analytics, LastLoggedIn],
        rootPath: ADMIN_PATH,
        loginPath: `${ADMIN_PATH}/login`,
        logoutPath: `${ADMIN_PATH}/logout`,
        componentLoader,

        // CRITICAL: Force 'development' here regardless of global NODE_ENV.
        // This tells AdminJS's ComponentLoader to actually RUN the Webpack
        // bundler and write components.bundle.js into bundleDir.
        // Without this, when NODE_ENV=production the bundler silently skips
        // and components.bundle.js is never generated → 404 + MIME error.
        env: { NODE_ENV: 'development' },

        // Point AdminJS at the writable /tmp directory for output.
        // This must EXACTLY match the express.static path registered below.
        bundleDir: BUNDLE_PATH,

        branding: { companyName: 'Hydro Sweep Services', withMadeWithLove: false },
        dashboard: {
            component: Components.Dashboard,
            handler: async () => {
                const now = new Date();

                const startOfToday = new Date(now);
                startOfToday.setHours(0, 0, 0, 0);

                const start7Days = new Date(now);
                start7Days.setDate(now.getDate() - 7);
                start7Days.setHours(0, 0, 0, 0);

                const start30Days = new Date(now);
                start30Days.setDate(now.getDate() - 30);
                start30Days.setHours(0, 0, 0, 0);

                const start24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

                const sourceAggregation = (matchStage) => Analytics.aggregate([
                    { $match: matchStage },
                    { $group: { _id: '$source', count: { $sum: 1 } } },
                ]);

                const pathAggregation = () => Analytics.aggregate([
                    { $group: { _id: '$path', count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                ]);

                const [
                    viewsToday,
                    views7Days,
                    views30Days,
                    viewsAllTime,
                    leadsCount,
                    botAlerts24h,
                    recentContacts,
                    serviceBreakdown,
                    sourcesToday,
                    sources7Days,
                    sources30Days,
                    sourcesAllTime,
                    viewsByPath,
                    lastLogin,
                ] = await Promise.all([
                    Analytics.countDocuments({ timestamp: { $gte: startOfToday } }),
                    Analytics.countDocuments({ timestamp: { $gte: start7Days } }),
                    Analytics.countDocuments({ timestamp: { $gte: start30Days } }),
                    Analytics.countDocuments(),
                    Contact.countDocuments(),
                    Alert.countDocuments({ timestamp: { $gte: start24Hours } }),
                    Contact.find()
                        .sort({ createdAt: -1 })
                        .limit(5)
                        .select('fullName email phone message createdAt')
                        .lean(),
                    Contact.aggregate([
                        { $group: { _id: '$message', count: { $sum: 1 } } },
                        { $sort: { count: -1 } },
                    ]),
                    sourceAggregation({ timestamp: { $gte: startOfToday } }),
                    sourceAggregation({ timestamp: { $gte: start7Days } }),
                    sourceAggregation({ timestamp: { $gte: start30Days } }),
                    sourceAggregation({}),
                    pathAggregation(),
                    LastLoggedIn.findOne().sort({ loginAt: -1 }).lean(),
                ]);

                const normaliseSources = (arr) => {
                    const map = { instagram: 0, tiktok: 0, facebook: 0, direct: 0 };
                    arr.forEach(({ _id, count }) => { if (_id in map) map[_id] = count; });
                    return map;
                };

                return {
                    viewsToday,
                    views7Days,
                    views30Days,
                    viewsAllTime,
                    leadsCount,
                    botAlerts24h,
                    recentContacts,
                    serviceBreakdown,
                    sourcesToday:   normaliseSources(sourcesToday),
                    sources7Days:   normaliseSources(sources7Days),
                    sources30Days:  normaliseSources(sources30Days),
                    sourcesAllTime: normaliseSources(sourcesAllTime),
                    viewsByPath,
                    lastLogin: lastLogin ? lastLogin.loginAt : null,
                };
            }
        },
    });

    // This triggers the Webpack bundle. Because env.NODE_ENV is forced to
    // 'development' above, AdminJS will write components.bundle.js into
    // BUNDLE_PATH (/tmp/adminjs-bundles) before the server accepts traffic.
    await admin.initialize();
    console.log(`✅ AdminJS bundle written to ${BUNDLE_PATH}`);

    // CRITICAL: The express.static path here MUST exactly match bundleDir above.
    // AdminJS generates a URL like /ADMIN_PATH/frontend/assets/components.bundle.js
    // This middleware maps that URL to the file at BUNDLE_PATH/components.bundle.js.
    // If these two paths differ even slightly you get 404 + MIME type 'text/html'.
    app.use(`${ADMIN_PATH}/frontend`, express.static(BUNDLE_PATH));
    console.log(`📦 AdminJS static assets served: ${ADMIN_PATH}/frontend → ${BUNDLE_PATH}`);

    const cookiePwd = SESSION_SECRET.padEnd(32, '0').substring(0, 32);

    const adminRouter = AdminJSExpress.buildAuthenticatedRouter(admin, {
        authenticate: async (email, password) => {
            if (email?.trim() === ADMIN_EMAIL && password?.trim() === ADMIN_PASS) {
                try {
                    await LastLoggedIn.findOneAndUpdate(
                        {},
                        { email, loginAt: new Date() },
                        { upsert: true, new: true }
                    );
                } catch (e) {
                    console.error('Failed to save last login:', e);
                }
                return { email };
            }
            return null;
        },
        cookieName: 'adminjs-session',
        cookiePassword: cookiePwd,
    }, null, {
        resave: false,
        saveUninitialized: true,
        secret: SESSION_SECRET,
        name: 'adminjs-sid',
        cookie: {
            httpOnly: true,
            // sameSite:'none' required on HTTPS — the browser blocks the cookie
            // during AdminJS's login redirect unless this is set.
            sameSite: secureTransfer ? 'none' : 'lax',
            secure: secureTransfer,
            maxAge: 86400000,
        },
        store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
    });

    app.use(ADMIN_PATH, ipWhitelist, adminRouter);
    console.log(`✅ AdminJS mounted at ${ADMIN_PATH}`);
}

/** --------------------------
 * MAIN APP INITIALIZATION
 * -------------------------- */
async function startServer() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Mongoose Connected ✅");

    // AdminJS mounts FIRST — before body parsers and main session middleware —
    // so its internal request handling (login POST, API calls, asset serving)
    // runs without interference from the main app stack.
    await buildAndMountAdminJS();

    // ── Body Parsers (skip for AdminJS routes) ────────────────────────────────
    // Use req.originalUrl — req.path can be stripped by nested routers and may
    // not contain the ADMIN_PATH prefix for subroutes.
    app.use((req, res, next) => {
        if (req.originalUrl.startsWith(ADMIN_PATH)) return next();
        express.json()(req, res, (err) => {
            if (err) return next(err);
            express.urlencoded({ extended: true })(req, res, (err) => {
                if (err) return next(err);
                if (req.body) mongoSanitize.sanitize(req.body);
                if (req.query) mongoSanitize.sanitize(req.query);
                if (req.params) mongoSanitize.sanitize(req.params);
                next();
            });
        });
    });

    // ── Global App Session ────────────────────────────────────────────────────
    app.use(session({
        resave: true,
        saveUninitialized: false,
        secret: process.env.SESSION_SECRET || 'dev-secret',
        name: "startercookie",
        cookie: { maxAge: 1209600000, secure: secureTransfer },
        store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
    }));

    app.use(passport.initialize());
    app.use(passport.session());
    app.use(flash);

    // ── CSRF Protection ───────────────────────────────────────────────────────
    // req.originalUrl ensures all AdminJS paths are bypassed including internal
    // API calls like /ADMIN_PATH/api/dashboard which lusca would otherwise block.
    app.use((req, res, next) => {
        if (
            req.originalUrl === "/api/upload" ||
            req.originalUrl === "/ai/togetherai-camera" ||
            req.originalUrl.startsWith("/api/") ||
            req.originalUrl === "/send-to-n8n" ||
            req.originalUrl.startsWith(ADMIN_PATH)
        ) return next();
        lusca.csrf()(req, res, next);
    });

    app.use(lusca.xframe("SAMEORIGIN"));
    app.use(lusca.xssProtection(true));

    app.use((req, res, next) => {
        res.locals.user = req.user;
        res.locals.messages = req.flash ? req.flash() : {};
        next();
    });

    // /js/lib static — safe early, not a tracked page
    app.use("/js/lib", express.static(path.join(__dirname, "node_modules/chart.js/dist")));
    app.locals.GOOGLE_ANALYTICS_ID = process.env.GOOGLE_ANALYTICS_ID || null;

    /** --------------------------
     * SECURITY ROUTES
     * -------------------------- */
    app.all(['/admin', '/admin/'], async (req, res) => {
        try {
            await Alert.create({ ip: req.ip, userAgent: req.headers['user-agent'], pathAttempted: req.originalUrl });
        } catch (e) {}
        res.status(403).send('Forbidden');
    });

    // ── trackViews: ONE analytics record per unique visitor session ───────────
    const trackViews = async (req, res, next) => {
        try {
            if (!req.session.viewTracked) {
                req.session.viewTracked = true;
                await Analytics.create({
                    path:   req.path,
                    source: detectSource(req.headers['user-agent']),
                });
            }
        } catch (e) {
            console.error('Analytics write error:', e.message);
        }
        next();
    };

    /** --------------------------
     * PUBLIC ROUTES
     *
     * CRITICAL ORDER — tracked HTML routes MUST come BEFORE
     * app.use("/", express.static(...)) otherwise express.static
     * intercepts the file silently and trackViews never runs.
     * -------------------------- */

    // Root — inject reCAPTCHA key then track
    app.get("/", trackViews, (req, res) => {
        const indexPath = path.join(__dirname, "public", "index.html");
        fs.readFile(indexPath, 'utf8', (err, data) => {
            if (err) return res.status(500).send("Server Error");
            res.send(data.replace(/<%= RECAPTCHA_SITE_KEY %>|YOUR_RECAPTCHA_SITE_KEY_HERE/g, process.env.RECAPTCHA_SITE_KEY || ''));
        });
    });

    // Tracked HTML pages — ABOVE express.static so trackViews fires first
    app.get("/home.html",    trackViews, (req, res) => res.sendFile(path.join(__dirname, "public", "home.html")));
    app.get("/about.html",   trackViews, (req, res) => res.sendFile(path.join(__dirname, "public", "about.html")));
    app.get("/pricing.html", trackViews, (req, res) => res.sendFile(path.join(__dirname, "public", "pricing.html")));
    app.get("/contact.html", trackViews, (req, res) => res.sendFile(path.join(__dirname, "public", "contact.html")));

    // express.static AFTER tracked routes — still serves CSS/JS/images/fonts
    app.use("/", express.static(path.join(__dirname, "public")));

    app.get("/login",   userController.getLogin);
    app.post("/login",  loginLimiter, userController.postLogin);
    app.get("/logout",  userController.logout);
    app.get("/signup",  userController.getSignup);
    app.post("/signup", loginLimiter, userController.postSignup);

    app.get("/account",                    passportConfig.isAuthenticated, userController.getAccount);
    app.post("/account/profile",           passportConfig.isAuthenticated, userController.postUpdateProfile);
    app.post("/account/password",          passportConfig.isAuthenticated, userController.postUpdatePassword);
    app.post("/account/delete",            passportConfig.isAuthenticated, userController.postDeleteAccount);
    app.get("/account/unlink/:provider",   passportConfig.isAuthenticated, userController.getOauthUnlink);

    app.get("/home",     homeController.index);
    app.get("/contact",  strictLimiter, contactController.getContact);
    app.post("/contact", contactController.postContact);
    app.get("/api",      apiController.getApi);
    app.get("/ai",       aiController.getAi);

    app.get('/recaptcha-site-key', (req, res) => res.json({ site_key: process.env.RECAPTCHA_SITE_KEY }));

    app.post("/api/contact", contactFormLimiter, async (req, res) => {
        try {
            const { fullName, email, phone, message } = req.body;
            if (!fullName || !phone || !message) return res.status(400).json({ success: false, message: "All fields are required." });
            if (fullName.length > 100 || message.length > 500) return res.status(400).json({ success: false, message: "Input too long." });

            const lastContact = await Contact.findOne().sort({ messageNumber: -1 });
            const nextNumber  = (lastContact?.messageNumber) ? lastContact.messageNumber + 1 : 1;

            await new Contact({ fullName, email: email || null, phone, message, messageNumber: nextNumber }).save();
            res.json({ success: true, message: `Message #${nextNumber} saved successfully!`, messageNumber: nextNumber });
        } catch (err) {
            console.error("Contact API Error:", err);
            res.status(500).json({ success: false, message: "Database error" });
        }
    });

    app.post("/api/submit_review", reviewLimiter, async (req, res) => {
        try {
            const { name, stars, review_text, profile_pic } = req.body;
            const recaptcha_token = req.body['g-recaptcha-response'] || req.body.recaptcha_token;

            if (!name || !stars || !review_text) return res.json({ success: false, message: 'All fields required' });
            if (!recaptcha_token) return res.json({ success: false, message: 'Please complete the CAPTCHA' });

            const verification = await verifyRecaptchaToken(recaptcha_token, req.ip);
            if (!verification.success) return res.json({ success: false, message: 'CAPTCHA failed verification' });

            await new Review({ name, stars: parseInt(stars), review_text, profile_pic: profile_pic || undefined }).save();
            res.json({ success: true, message: "Review saved successfully" });
        } catch (err) {
            console.error(err);
            res.json({ success: false, message: err.message });
        }
    });

    app.get('/api/reviews', async (req, res) => {
        try {
            const page  = parseInt(req.query.page) || 1;
            const limit = 5;
            const totalReviews = await Review.countDocuments();
            const reviews      = await Review.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
            const maskedReviews = reviews.map(r => ({ ...r.toObject(), name: maskName(r.name) }));
            res.json({ reviews: maskedReviews, total_pages: Math.ceil(totalReviews / limit), total_reviews: totalReviews });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/stats', async (req, res) => {
        try {
            const stats = await Review.aggregate([{ $group: { _id: null, avgStars: { $avg: "$stars" }, total: { $sum: 1 } } }]);
            const avgStars     = stats[0]?.avgStars ? parseFloat(stats[0].avgStars.toFixed(1)) : 0;
            const totalReviews = stats[0]?.total || 0;
            res.json({ avgStars, totalReviews });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /** --------------------------
     * CHATBOT MONGO SETUP & ROUTES
     * -------------------------- */
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    let responsesCollection = null;

    try {
        await mongoClient.connect();
        responsesCollection = mongoClient.db("test").collection("responses");
        await responsesCollection.createIndex({ sessionId: 1, timestamp: -1 });
        console.log("Chatbot Mongo Connected ✅");
    } catch (error) {
        console.error("Chatbot Mongo Error:", error);
    }

    async function saveMessage({ sessionId, sender, message, meta = {} }) {
        if (!responsesCollection) return;
        await responsesCollection.insertOne({ sessionId, sender, message, meta, timestamp: new Date() });
    }

    app.post("/send-to-n8n", chatbotLimiter, async (req, res) => {
        const { message, sessionId } = req.body;
        if (!message) return res.status(400).json({ error: "No message" });
        try {
            await saveMessage({ sessionId, sender: "user", message });
            const resp  = await n8nPost({ message, sessionId });
            const reply = typeof resp.data === "string" ? resp.data : resp.data.reply || JSON.stringify(resp.data);
            await saveMessage({ sessionId, sender: "bot", message: reply });
            res.json({ reply });
        } catch (err) {
            console.error("n8n HTTP error:", err.message);
            if (err.code === "ECONNABORTED" || err.message.includes("timeout")) {
                return res.status(503).json({ error: "The assistant is waking up, please try again in a moment." });
            }
            res.status(500).json({ error: "n8n error" });
        }
    });

    /** --------------------------
     * HTTP SERVER + WEBSOCKETS
     * -------------------------- */
    app.use((req, res) => res.status(404).send("Page Not Found"));
    if (!IS_PRODUCTION) app.use(errorHandler());

    const server = app.listen(app.get("port"), () => {
        console.log(`🚀 Server running at http://localhost:${app.get("port")}`);
        console.log(`🛡️  Admin panel → http://localhost:${app.get("port")}${ADMIN_PATH}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`📦 AdminJS bundle path: ${BUNDLE_PATH}`);
    });

    const wss = new WebSocketServer({ server });
    wss.on("connection", (ws) => {
        ws.on("message", async (raw) => {
            try {
                const { message, sessionId } = JSON.parse(raw.toString());
                await saveMessage({ sessionId, sender: "user", message });
                const resp  = await n8nPost({ message, sessionId });
                const reply = typeof resp.data === "string" ? resp.data : resp.data.reply || JSON.stringify(resp.data);
                await saveMessage({ sessionId, sender: "bot", message: reply });
                ws.send(JSON.stringify({ reply, sessionId }));
            } catch (err) {
                console.error("WebSocket n8n error:", err.message);
                if (err.code === "ECONNABORTED" || err.message.includes("timeout")) {
                    ws.send(JSON.stringify({ reply: "The assistant is waking up, please try again in a moment." }));
                } else {
                    ws.send(JSON.stringify({ error: "WS Error" }));
                }
            }
        });
    });

    process.on("SIGINT", async () => {
        await mongoose.disconnect();
        server.close(() => process.exit(0));
    });
}

startServer();

export default app;
