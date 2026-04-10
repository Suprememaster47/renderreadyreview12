/**
 * ---------------------------------------------------------------------
 * MERGED SERVER.JS - STABLE PRODUCTION VERSION
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
import axios from "axios";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import { createRequire } from "module";

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
const userController    = require("./controllers/user.cjs");
const passportConfig    = require('./config/passport.cjs');
const { flash }         = require("./config/flash.cjs");
const { morganLogger }  = require("./config/morgan.cjs");

/** --------------------------
 * CONSTANTS & ENV
 * -------------------------- */
const IS_PRODUCTION  = process.env.NODE_ENV === 'production';
const secureTransfer = IS_PRODUCTION || process.env.BASE_URL?.startsWith("https") || false;
const ADMIN_PATH     = `/${(process.env.ADMIN_PATH || 'electric-puffin-vault-12').trim().replace(/^\//, '')}`;
// Using a local folder ensures the build persists from the Build Step to the Run Step on Render
const BUNDLE_DIR     = path.join(__dirname, 'adminjs-build-output');

/** --------------------------
 * MONGOOSE MODELS
 * -------------------------- */
const Review = mongoose.models.Review || mongoose.model("Review", new mongoose.Schema({
    name: String, stars: { type: Number, min: 1, max: 5 }, review_text: String,
    profile_pic: { type: String, default: "https://imgs.search.brave.com/placeholder.png" },
    createdAt: { type: Date, default: Date.now }
}), "reviews");

const Contact = mongoose.models.Contact || mongoose.model("Contact", new mongoose.Schema({
    fullName: { type: String, required: true }, email: String, phone: { type: String, required: true },
    message: { type: String, required: true }, messageNumber: Number, createdAt: { type: Date, default: Date.now }
}), "contact");

const Response = mongoose.models.Response || mongoose.model('Response', new mongoose.Schema({
    sessionId: String, message: String, timestamp: { type: Date, default: Date.now }
}));

const Analytics = mongoose.models.Analytics || mongoose.model('Analytics', new mongoose.Schema({
    path: String, source: { type: String, default: 'direct' }, timestamp: { type: Date, default: Date.now }
}));

const LastLoggedIn = mongoose.models.LastLoggedIn || mongoose.model('LastLoggedIn', new mongoose.Schema({
    email: String, loginAt: { type: Date, default: Date.now }
}), 'lastloggedin');

/** --------------------------
 * CUSTOM SANITIZATION (Replaces express-mongo-sanitize)
 * -------------------------- */
const sanitizeData = (obj) => {
    if (obj instanceof Object) {
        for (const key in obj) {
            if (key.startsWith('$')) {
                delete obj[key];
            } else {
                sanitizeData(obj[key]);
            }
        }
    }
    return obj;
};

const customSanitizer = (req, res, next) => {
    req.body = sanitizeData(req.body);
    req.params = sanitizeData(req.params);
    // We don't touch req.query directly to avoid the "getter" crash
    next();
};

const n8nPost = (payload) => axios.post(process.env.N8N_WEBHOOK_URL, payload, {
    headers: { "x-hydro-sweep-auth": process.env.N8N_AUTH_SECRET || "" }, timeout: 25000
});

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
app.use(customSanitizer); // Use our safe custom sanitizer

/** --------------------------
 * BOOTSTRAP FUNCTION
 * -------------------------- */
async function startServer() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB Connected ✅");

    const SESSION_SECRET = (process.env.SESSION_SECRET || 'hydro-sweep-admin-secret-32-chars').trim();

    // ── AdminJS Setup ────────────────────────────────────────────────────────
    const adminOptions = {
        resources: [Review, Response, Contact, Analytics, LastLoggedIn],
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
                const [viewsToday, leadsCount, lastLogin] = await Promise.all([
                    Analytics.countDocuments({ timestamp: { $gte: startOfToday } }),
                    Contact.countDocuments(),
                    LastLoggedIn.findOne().sort({ loginAt: -1 }).lean(),
                ]);
                return { viewsToday, leadsCount, lastLogin: lastLogin?.loginAt };
            }
        },
    };

    // Bundle config
    adminOptions.env = { NODE_ENV: IS_PRODUCTION ? 'production' : 'development' };
    adminOptions.bundler = { bundleDir: BUNDLE_DIR };

    const admin = new AdminJS(adminOptions);

    if (process.env.BUILD_ADMINJS === 'true') {
        console.log("🛠️  Generating AdminJS bundle for Render...");
        if (!fs.existsSync(BUNDLE_DIR)) fs.mkdirSync(BUNDLE_DIR, { recursive: true });
        await admin.initialize();
        console.log("✅ AdminJS bundle generated. Exiting build process.");
        process.exit(0);
    }

    // In production, we assume the bundle was already generated during the build step
    await admin.initialize();
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

    app.use(ADMIN_PATH, adminRouter);

    // ── Main App Middleware ──────────────────────────────────────────────────
    app.use(session({
        resave: true, saveUninitialized: false, secret: SESSION_SECRET,
        name: "startercookie", cookie: { maxAge: 1209600000, secure: secureTransfer },
        store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
    }));

    app.use(passport.initialize());
    app.use(passport.session());
    app.use(flash);

    app.use((req, res, next) => {
        const bypass = ["/api/upload", "/ai/togetherai-camera", "/send-to-n8n", ADMIN_PATH];
        if (bypass.some(p => req.originalUrl.startsWith(p))) return next();
        lusca.csrf()(req, res, next);
    });

    app.use((req, res, next) => {
        res.locals.user = req.user;
        res.locals.messages = req.flash ? req.flash() : {};
        next();
    });

    // ── Routes ───────────────────────────────────────────────────────────────
    app.get("/", (req, res) => {
        const indexPath = path.join(__dirname, "public", "index.html");
        fs.readFile(indexPath, 'utf8', (err, data) => {
            if (err) return res.status(500).send("Server Error");
            res.send(data.replace(/<%= RECAPTCHA_SITE_KEY %>|YOUR_RECAPTCHA_SITE_KEY_HERE/g, process.env.RECAPTCHA_SITE_KEY || ''));
        });
    });

    app.get("/login", userController.getLogin);
    app.post("/login", userController.postLogin);
    app.get("/logout", userController.logout);

    app.post("/send-to-n8n", async (req, res) => {
        try {
            const resp = await n8nPost(req.body);
            res.json({ reply: resp.data.reply || resp.data });
        } catch (e) {
            res.status(500).json({ error: "Communication Error" });
        }
    });

    app.use("/", express.static(path.join(__dirname, "public")));

    const server = app.listen(app.get("port"), () => {
        console.log(`🚀 Server running on port ${app.get("port")}`);
    });

    const wss = new WebSocketServer({ server });
    wss.on("connection", (ws) => {
        ws.on("message", async (raw) => {
            try {
                const data = JSON.parse(raw.toString());
                const resp = await n8nPost(data);
                ws.send(JSON.stringify({ reply: resp.data.reply || resp.data }));
            } catch (e) {
                ws.send(JSON.stringify({ error: "Internal Error" }));
            }
        });
    });
}

startServer().catch(err => {
    console.error("Startup Error:", err);
    process.exit(1);
});

export default app;
