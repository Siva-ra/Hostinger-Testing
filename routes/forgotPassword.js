const express = require("express");
const bcrypt = require("bcryptjs");

module.exports = (db, transporter) => {
  const router = express.Router();

  /* ===============================
     SEND OTP
=============================== */
router.post("/send-otp", async (req, res) => {

  console.log("========== SEND OTP START ==========");
  console.log("Request Body:", req.body);

  try {

    let { email } = req.body;

    console.log("Received Email:", email);

    if (!email) {
      console.log("❌ Email missing");
      return res.json({
        success: false,
        message: "Email required"
      });
    }

    email = email.toLowerCase().trim();

    console.log("Formatted Email:", email);

    console.log("Searching user...");

    const [userRows] = await db.query(
      "SELECT id FROM users WHERE email=?",
      [email]
    );

    console.log("Users Found:", userRows.length);

    if (userRows.length === 0) {
      console.log("❌ Email not found");
      return res.json({
        success: false,
        message: "Email not found"
      });
    }

    const userId = userRows[0].id;

    console.log("User ID:", userId);

    console.log("Generating OTP...");

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    console.log("Generated OTP:", otp);
    console.log("Expires At:", expiresAt);

    console.log("Deleting old OTP...");

    await db.query(
      "DELETE FROM otps WHERE user_id=?",
      [userId]
    );

    console.log("Old OTP deleted");

    console.log("Saving new OTP...");

    await db.query(
      "INSERT INTO otps (user_id, otp, expires_at) VALUES (?,?,?)",
      [userId, otp, expiresAt]
    );

    console.log("New OTP saved");

    console.log("Sending Email...");

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Reset Password OTP",
      text: `Your OTP is ${otp}. It expires in 5 minutes.`
    });

    console.log("✅ Email Sent Successfully");
    console.log("Recipient:", email);

    console.log("========== SEND OTP END ==========");

    res.json({
      success: true,
      message: "OTP sent successfully"
    });

  } catch (err) {

    console.error("🔥 SEND OTP ERROR:", err.message);
    console.error(err.stack);

    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});


/* ===============================
     RESET PASSWORD
=============================== */
router.post("/reset-password", async (req, res) => {

  console.log("========== RESET PASSWORD START ==========");
  console.log("Request Body:", req.body);

  try {

    let { email, otp, newPassword } = req.body;

    console.log("Email:", email);
    console.log("Entered OTP:", otp);

    if (!email || !otp || !newPassword) {
      console.log("❌ Missing Fields");

      return res.json({
        success: false,
        message: "Missing fields"
      });
    }

    email = email.toLowerCase().trim();

    console.log("Formatted Email:", email);

    console.log("Searching user...");

    const [userRows] = await db.query(
      "SELECT id FROM users WHERE email=?",
      [email]
    );

    console.log("Users Found:", userRows.length);

    if (userRows.length === 0) {
      console.log("❌ User not found");

      return res.json({
        success: false,
        message: "User not found"
      });
    }

    const userId = userRows[0].id;

    console.log("User ID:", userId);

    console.log("Checking OTP...");

    const [otpRows] = await db.query(
      "SELECT * FROM otps WHERE user_id=? AND otp=? AND expires_at > NOW()",
      [userId, otp]
    );

    console.log("Matching OTP Rows:", otpRows.length);

    if (otpRows.length === 0) {
      console.log("❌ Invalid or Expired OTP");

      return res.json({
        success: false,
        message: "Invalid or expired OTP"
      });
    }

    console.log("Hashing New Password...");

    const hashed = await bcrypt.hash(newPassword, 10);

    console.log("Password Hashed");

    console.log("Updating Password...");

    await db.query(
      "UPDATE users SET password_hash=? WHERE id=?",
      [hashed, userId]
    );

    console.log("Password Updated");

    console.log("Deleting Used OTP...");

    await db.query(
      "DELETE FROM otps WHERE user_id=?",
      [userId]
    );

    console.log("OTP Deleted");

    console.log("========== RESET PASSWORD END ==========");

    res.json({
      success: true,
      message: "Password reset successful"
    });

  } catch (err) {

    console.error("🔥 RESET PASSWORD ERROR:", err.message);
    console.error(err.stack);

    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});
return router;
};