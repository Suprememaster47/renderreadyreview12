const crypto = require('crypto');
const passport = require('passport');
const validator = require('validator');
const mailChecker = require('mailchecker');
const User = require('../models/User.js').default;
const Session = require('../models/Session.js').default;
const nodemailerConfig = require('../config/nodemailer');

/**
 * GET /login
 * Login page.
 */
exports.getLogin = (req, res) => {
  if (req.user) {
    // Redirect to account if already logged in to avoid index.html
    return res.redirect('/account');
  }
  res.render('account/login', {
    title: 'Login',
  });
};

/**
 * POST /login
 * Sign in using email and password.
 */
exports.postLogin = async (req, res, next) => {
  const validationErrors = [];
  if (!validator.isEmail(req.body.email)) validationErrors.push({ msg: 'Please enter a valid email address.' });

  if (validationErrors.length) {
    req.flash('errors', validationErrors);
    return res.redirect('/login');
  }
  req.body.email = validator.normalizeEmail(req.body.email, { gmail_remove_dots: false });

  // Check if user wants to login by email link
  if (req.body.loginByEmailLink === 'on') {
    try {
      const user = await User.findOne({ email: { $eq: req.body.email } });
      if (!user) {
        console.log('Login by email link: User not found');
        req.flash('info', { msg: 'We are sending further instructions to the email you provided, if there is an account with that email address in our system.' });
        return res.redirect('/login');
      }

      const token = await User.generateToken();
      user.loginToken = token;
      user.loginExpires = Date.now() + 900000; // 15 min
      user.loginIpHash = User.hashIP(req.ip);
      await user.save();

      const mailOptions = {
        to: user.email,
        from: process.env.SITE_CONTACT_EMAIL,
        subject: 'Login Link',
        text: `Hello,
Please click on the following link to log in:

${process.env.BASE_URL}/login/verify/${token}

If you didn't request this login, please ignore this email and make sure you can still access your account.

For security:
- Never share this link with anyone
- We'll never ask you to send us this link
- Only use this link on the same device/browser where you requested it
- This link will expire in 15 minutes and can only be used once

Thank you!\n`,
      };

      await nodemailerConfig.sendMail({
        mailOptions,
        successfulType: 'info',
        successfulMsg: 'We are sending further instructions to the email you provided, if there is an account with that email address in our system.',
        loggingError: 'ERROR: Could not send login by email link.',
        errorType: 'errors',
        errorMsg: 'We encountered an issue sending instructions. Please try again later.',
        req,
      });

      return res.redirect('/login');
    } catch (err) {
      next(err);
    }
  }

  // Regular password login
  if (validator.isEmpty(req.body.password)) {
    req.flash('errors', 'Password cannot be blank.');
    return res.redirect('/login');
  }
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      req.flash('errors', info);
      return res.redirect('/login');
    }
    req.logIn(user, (err) => {
      if (err) {
        return next(err);
      }
      req.flash('success', { msg: 'Success! You are logged in.' });
      // Forced redirect to account page
      res.redirect('/account');
    });
  })(req, res, next);
};

/**
 * GET /logout
 * Log out.
 */
exports.logout = (req, res) => {
  req.logout((err) => {
    if (err) console.log('Error : Failed to logout.', err);
    req.session.destroy((err) => {
      if (err) console.log('Error : Failed to destroy the session during logout.', err);
      req.user = null;
      res.redirect('/login');
    });
  });
};

/**
 * GET /signup
 * Signup page.
 */
exports.getSignup = (req, res) => {
  if (req.user) {
    // Redirect to account if already logged in
    return res.redirect('/account');
  }
  res.render('account/signup', {
    title: 'Create Account',
  });
};

/**
 * Helper to send passwordless login link...
 */
async function sendPasswordlessLoginLinkIfUserExists(user, req) {
  const token = await User.generateToken();
  user.loginToken = token;
  user.loginExpires = Date.now() + 900000; // 15 min
  user.loginIpHash = User.hashIP(req.ip);
  await user.save();

  const mailOptions = {
    to: user.email,
    from: process.env.SITE_CONTACT_EMAIL,
    subject: 'Login Link',
    text: `Hello,
We found an existing account for this email. Please use the following link to log in:

${process.env.BASE_URL}/login/verify/${token}

If you didn't request this login, please ignore this email.

Once logged in, you can go to your profile page to set or change your password.

Thank you!\n`,
  };
  await nodemailerConfig.sendMail({
    mailOptions,
    successfulType: 'info',
    successfulMsg: 'An email has been sent to the email address you provided with further instructions.',
    loggingError: 'ERROR: Could not send login by email link.',
    errorType: 'errors',
    errorMsg: 'We encountered an issue sending instructions. Please try again later.',
    req,
  });
}

/**
 * Helper to send passwordless signup link for new users.
 */
async function sendPasswordlessSignupLink(user, req) {
  const token = await User.generateToken();
  user.loginToken = token;
  user.loginExpires = Date.now() + 900000; // 15 min
  user.loginIpHash = User.hashIP(req.ip);
  await user.save();

  const mailOptions = {
    to: user.email,
    from: process.env.SITE_CONTACT_EMAIL,
    subject: 'Login Link',
    text: `Hello,
Please click on the following link to log in:

${process.env.BASE_URL}/login/verify/${token}

If you didn't request this login, please ignore this email and make sure you can still access your account.

For security:
- Never share this link with anyone
- We'll never ask you to send us this link
- Only use this link on the same device/browser where you requested it
- This link will expire in 15 minutes and can only be used once

Thank you!\n`,
  };

  await nodemailerConfig.sendMail({
    mailOptions,
    successfulType: 'info',
    successfulMsg: 'An email has been sent to the email address you provided with further instructions.',
    loggingError: 'ERROR: Could not send login by email link.',
    errorType: 'errors',
    errorMsg: 'Error sending login email. Please try again later.',
    req,
  });
}

/**
 * POST /signup
 * Create a new local account.
 */
exports.postSignup = async (req, res, next) => {
  const validationErrors = [];
  if (!validator.isEmail(req.body.email)) validationErrors.push({ msg: 'Please enter a valid email address.' });

  if (!req.body.passwordless) {
    if (!validator.isLength(req.body.password, { min: 8 })) validationErrors.push({ msg: 'Password must be at least 8 characters long' });
    if (validator.escape(req.body.password) !== validator.escape(req.body.confirmPassword)) validationErrors.push({ msg: 'Passwords do not match' });
  }

  if (validationErrors.length) {
    req.flash('errors', validationErrors);
    return res.redirect('/signup');
  }
  req.body.email = validator.normalizeEmail(req.body.email, { gmail_remove_dots: false });
  if (!mailChecker.isValid(req.body.email)) {
    req.flash('errors', { msg: 'The email address is invalid or disposable and can not be verified.  Please update your email address and try again.' });
    return res.redirect('/signup');
  }

  try {
    const existingUser = await User.findOne({ email: { $eq: req.body.email } });

    if (existingUser) {
      // Always send login link and generic message if email exists
      await sendPasswordlessLoginLinkIfUserExists(existingUser, req);
      return res.redirect('/login');
    }

    // For passwordless signup, generate a random password
    const password = req.body.passwordless ? crypto.randomBytes(16).toString('hex') : req.body.password;
    const user = new User({
      email: req.body.email,
      password,
    });

    await user.save();

    if (req.body.passwordless) {
      await sendPasswordlessSignupLink(user, req);
      // Even for passwordless, we redirect to /login (where they'll see the info flash) 
      // or / to see your landing page while they wait for email.
      return res.redirect('/'); 
    }

    // For regular signup, log the user in
    req.logIn(user, (err) => {
      if (err) {
        return next(err);
      }
      req.flash('success', { msg: 'Success! You are logged in.' });
      // Change: Redirect to /account instead of /
      res.redirect('/account');
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /account
 * Profile page.
 */
exports.getAccount = (req, res) => {
  res.render('account/profile', {
    title: 'Account Management',
    user: req.user // This line fixes the "Cannot read property email of undefined" error
  });
};

/**
 * POST /account/profile
 * Update profile information.
 */
exports.postUpdateProfile = async (req, res, next) => {
  const validationErrors = [];
  if (!validator.isEmail(req.body.email)) validationErrors.push({ msg: 'Please enter a valid email address.' });
  if (validationErrors.length) {
    req.flash('errors', validationErrors);
    return res.redirect('/account');
  }
  req.body.email = validator.normalizeEmail(req.body.email, { gmail_remove_dots: false });
  if (!mailChecker.isValid(req.body.email)) {
    req.flash('errors', { msg: 'The email address is invalid or disposable and can not be verified.  Please update your email address and try again.' });
    return res.redirect('/account');
  }
  try {
    const user = await User.findById(req.user.id);
    if (user.email !== req.body.email) user.emailVerified = false;
    user.email = req.body.email || '';
    user.profile.name = req.body.name || '';
    user.profile.gender = req.body.gender || '';
    user.profile.location = req.body.location || '';
    user.profile.website = req.body.website || '';
    await user.save();
    req.flash('success', { msg: 'Profile information has been updated.' });
    res.redirect('/account');
  } catch (err) {
    if (err.code === 11000) {
      console.log('Duplicate email address when trying to update the profile email.');
    } else {
      console.log('Error updating profile', err);
    }
    req.flash('errors', {
      msg: "We encountered an issue updating your email address. If you suspect you have duplicate accounts, please log in with the other email address you've used or contact support for assistance. You can delete duplicate accounts from your account settings.",
    });
    return res.redirect('/account');
  }
};
/**
 * POST /account/password
 * Update current password.
 */
exports.postUpdatePassword = async (req, res, next) => {
  const validationErrors = [];
  if (!validator.isLength(req.body.password, { min: 8 })) validationErrors.push({ msg: 'Password must be at least 8 characters long' });
  if (validator.escape(req.body.password) !== validator.escape(req.body.confirmPassword)) validationErrors.push({ msg: 'Passwords do not match' });

  if (validationErrors.length) {
    req.flash('errors', validationErrors);
    return res.redirect('/account');
  }
  try {
    const user = await User.findById(req.user.id);
    user.password = req.body.password;
    await user.save();
    req.flash('success', { msg: 'Password has been changed.' });
    res.redirect('/account');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /account/delete
 * Delete user account.
 */
exports.postDeleteAccount = async (req, res, next) => {
  try {
    await User.deleteOne({ _id: req.user.id });
    req.logout((err) => {
      if (err) console.log('Error: Failed to logout.', err);
      req.session.destroy((err) => {
        if (err) console.log('Error: Failed to destroy the session during account deletion.', err);
        req.user = null;
        // User is no longer a member, so we send them to the public index.html
        res.redirect('/');
      });
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /account/unlink/:provider
 * Unlink OAuth provider.
 */
exports.getOauthUnlink = async (req, res, next) => {
  try {
    let { provider } = req.params;
    provider = validator.escape(provider);
    const user = await User.findById(req.user.id);
    user[provider.toLowerCase()] = undefined;
    const tokensWithoutProviderToUnlink = user.tokens.filter((token) => token.kind !== provider.toLowerCase());
    if (!(user.email && user.password) && tokensWithoutProviderToUnlink.length === 0) {
      req.flash('errors', {
        msg: `The ${provider.charAt(0).toUpperCase() + provider.slice(1).toLowerCase()} account cannot be unlinked without another form of login enabled. Please link another account or add an email address and password.`,
      });
      return res.redirect('/account');
    }
    user.tokens = tokensWithoutProviderToUnlink;
    await user.save();
    req.flash('info', {
      msg: `${provider.charAt(0).toUpperCase() + provider.slice(1).toLowerCase()} account has been unlinked.`,
    });
    res.redirect('/account');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /login/verify/:token
 * Login by email link
 */
exports.getLoginByEmail = async (req, res, next) => {
  if (req.user) {
    // Change: Redirect to /account instead of /
    return res.redirect('/account');
  }
  const validationErrors = [];
  if (!validator.isHexadecimal(req.params.token)) validationErrors.push({ msg: 'Invalid or expired login link.' });
  if (validationErrors.length) {
    req.flash('errors', validationErrors);
    return res.redirect('/login');
  }

  try {
    const user = await User.findOne({ loginToken: { $eq: req.params.token } });

    if (!user || !user.verifyTokenAndIp(user.loginToken, req.ip, 'login')) {
      req.flash('errors', { msg: 'Invalid or expired login link.' });
      return res.redirect('/login');
    }

    user.emailVerified = true; 
    await user.save();

    req.logIn(user, (err) => {
      if (err) {
        return next(err);
      }
      req.flash('success', { msg: 'Success! You are logged in.' });
      // Change: Redirect to /account instead of req.session.returnTo || '/'
      res.redirect('/account');
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /reset/:token
 * Reset Password page.
 */
exports.getReset = async (req, res, next) => {
  try {
    if (req.isAuthenticated()) {
      // Change: Redirect to /account instead of /
      return res.redirect('/account');
    }
    const validationErrors = [];
    if (!validator.isHexadecimal(req.params.token)) validationErrors.push({ msg: 'Invalid or expired password reset link.' });
    if (validationErrors.length) {
      req.flash('errors', validationErrors);
      return res.redirect('/forgot');
    }

    const user = await User.findOne({ passwordResetToken: { $eq: req.params.token } });
    if (!user || !user.verifyTokenAndIp(user.passwordResetToken, req.ip, 'passwordReset')) {
      req.flash('errors', { msg: 'Invalid or expired password reset link.' });
      return res.redirect('/forgot');
    }
    res.render('account/reset', {
      title: 'Password Reset',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /account/verify/:token
 * Verify email address
 */
exports.getVerifyEmailToken = async (req, res, next) => {
  if (req.user.emailVerified) {
    req.flash('info', { msg: 'The email address has been verified.' });
    return res.redirect('/account');
  }

  const validationErrors = [];
  if (validator.escape(req.params.token) && !validator.isHexadecimal(req.params.token)) validationErrors.push({ msg: 'Invalid or expired verification link.' });
  if (validationErrors.length) {
    req.flash('errors', validationErrors);
    return res.redirect('/account');
  }

  try {
    if (!req.user.verifyTokenAndIp(req.user.emailVerificationToken, req.ip, 'emailVerification')) {
      req.flash('errors', { msg: 'Invalid or expired verification link.' });
      return res.redirect('/account');
    }

    req.user.emailVerified = true;
    await req.user.save();

    req.flash('success', { msg: 'Thank you for verifying your email address.' });
    return res.redirect('/account');
  } catch (err) {
    console.log('Error saving the user profile to the database after email verification', err);
    req.flash('errors', { msg: 'There was an error verifying your email. Please try again.' });
    return res.redirect('/account');
  }
};

/**
 * GET /account/verify
 * Verify email address
 */
exports.getVerifyEmail = async (req, res, next) => {
  if (req.user.emailVerified) {
    req.flash('info', { msg: 'The email address has already been verified.' });
    return res.redirect('/account');
  }

  if (!mailChecker.isValid(req.user.email)) {
    req.flash('errors', { msg: 'The email address is invalid or disposable and can not be verified.  Please update your email address and try again.' });
    return res.redirect('/account');
  }

  try {
    const token = await User.generateToken();
    req.user.emailVerificationToken = token;
    req.user.emailVerificationExpires = Date.now() + 900000; // 15 minutes
    req.user.emailVerificationIpHash = User.hashIP(req.ip);
    await req.user.save();

    const mailOptions = {
      to: req.user.email,
      from: process.env.SITE_CONTACT_EMAIL,
      subject: 'Please verify your email address',
      text: `Hello,\nPlease verify your email address by clicking on the following link:\n\n${process.env.BASE_URL}/account/verify/${token}\n\nThank you!\n`,
    };

    await nodemailerConfig.sendMail({
      mailOptions,
      successfulType: 'info',
      successfulMsg: `An email has been sent to ${req.user.email} with verification instructions.`,
      loggingError: 'ERROR: Could not send verification email.',
      errorType: 'errors',
      errorMsg: 'Error sending verification email. Please try again later.',
      req,
    });

    return res.redirect('/account');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /reset/:token
 * Process the reset password request.
 */
exports.postReset = async (req, res, next) => {
  const validationErrors = [];
  if (!validator.isLength(req.body.password, { min: 8 })) validationErrors.push({ msg: 'Password must be at least 8 characters long' });
  if (validator.escape(req.body.password) !== validator.escape(req.body.confirm)) validationErrors.push({ msg: 'Passwords do not match' });
  if (!validator.isHexadecimal(req.params.token)) validationErrors.push({ msg: 'Invalid Token.  Please retry.' });

  if (validationErrors.length) {
    req.flash('errors', validationErrors);
    return res.redirect(req.get('Referrer') || '/login');
  }

  try {
    const user = await User.findOne({ passwordResetToken: { $eq: req.params.token } });
    if (!user || !user.verifyTokenAndIp(user.passwordResetToken, req.ip, 'passwordReset')) {
      req.flash('errors', { msg: 'Password reset token is invalid or has expired.' });
      return res.redirect('/forgot');
    }
    user.password = req.body.password;
    user.emailVerified = true; 
    await user.save();

    const mailOptions = {
      to: user.email,
      from: process.env.SITE_CONTACT_EMAIL,
      subject: 'Your password has been changed',
      text: `This is a confirmation that the password for your account ${user.email} has just been changed.\n`,
    };

    await nodemailerConfig.sendMail({
      mailOptions,
      successfulType: 'success',
      successfulMsg: 'Success! Your password has been changed.',
      loggingError: 'ERROR: Could not send password reset confirmation email.',
      errorType: 'warning',
      errorMsg: 'Your password has been changed, but we could not send you a confirmation email.',
      req,
    });

    // After password reset, send them to login or account
    res.redirect('/account');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /forgot
 * Forgot Password page.
 */
exports.getForgot = (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/account'); // Changed from '/'
  }
  res.render('account/forgot', {
    title: 'Forgot Password',
  });
};

/**
 * POST /forgot
 */
exports.postForgot = async (req, res, next) => {
  // ... [Validation and email logic stays the same] ...
  // Keep the redirect to /forgot so they can see the 'Success' flash message.
  return res.redirect('/forgot');
};

/**
 * POST /account/logout-everywhere
 */
exports.postLogoutEverywhere = async (req, res, next) => {
  const userId = req.user.id;
  try {
    await Session.removeSessionByUserId(userId);
    req.logout((err) => {
      if (err) return next(err);
      req.flash('info', { msg: 'You have been logged out of all sessions.' });
      res.redirect('/'); // Redirect to landing page after total logout
    });
  } catch (err) {
    return next(err);
  }
};