const express = require("express");
const bcrypt = require("bcryptjs");

module.exports = (db, transporter) => {
  const router = express.Router();

  /* ===============================
     SEND OTP
  =============================== */
  router.post("/send-otp", async (req, res) => {
    try {
      let { email } = req.body;

      if (!email) {
        return res.json({ success: false, message: "Email required" });
      }

      email = email.toLowerCase().trim();

      const [userRows] = await db.promise().query(
        "SELECT id FROM users WHERE email=?",
        [email]
      );

      if (userRows.length === 0) {
        return res.json({ success: false, message: "Email not found" });
      }

      const userId = userRows[0].id;

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      // delete old OTPs
      await db.promise().query(
        "DELETE FROM otps WHERE user_id=?",
        [userId]
      );

      // insert new OTP
      await db.promise().query(
        "INSERT INTO otps (user_id, otp, expires_at) VALUES (?,?,?)",
        [userId, otp, expiresAt]
      );

      // send email
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Reset Password OTP",
        text: `Your OTP is ${otp}. It expires in 5 minutes.`
      });

      res.json({ success: true, message: "OTP sent successfully" });

    } catch (err) {
      console.error("SEND OTP ERROR:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

  /* ===============================
     RESET PASSWORD
  =============================== */
  router.post("/reset-password", async (req, res) => {
    try {
      let { email, otp, newPassword } = req.body;

      if (!email || !otp || !newPassword) {
        return res.json({ success: false, message: "Missing fields" });
      }

      email = email.toLowerCase().trim();

      const [userRows] = await db.promise().query(
        "SELECT id FROM users WHERE email=?",
        [email]
      );

      if (userRows.length === 0) {
        return res.json({ success: false, message: "User not found" });
      }

      const userId = userRows[0].id;

      const [otpRows] = await db.promise().query(
        "SELECT * FROM otps WHERE user_id=? AND otp=? AND expires_at > NOW()",
        [userId, otp]
      );

      if (otpRows.length === 0) {
        return res.json({ success: false, message: "Invalid or expired OTP" });
      }

      const hashed = await bcrypt.hash(newPassword, 10);

      await db.promise().query(
        "UPDATE users SET password_hash=? WHERE id=?",
        [hashed, userId]
      );

      await db.promise().query(
        "DELETE FROM otps WHERE user_id=?",
        [userId]
      );

      res.json({ success: true, message: "Password reset successful" });

    } catch (err) {
      console.error("RESET ERROR:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });

  return router;
};