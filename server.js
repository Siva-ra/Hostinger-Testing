const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const mysql = require("mysql2/promise");
require("dotenv").config();

const app = express();

/* ===== MIDDLEWARE ===== */
app.use(cors());
app.use(express.json());

/* ===== DATABASE ===== */
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  port: process.env.DB_PORT,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

/* ===== TEST DB CONNECTION ===== */
db.getConnection()
  .then((connection) => {
    console.log("✅ Database connected");
    connection.release();
  })
  .catch((err) => {
    console.error("❌ Database connection failed:", err.message);
  });

/* ===== MAIL CONFIG ===== */
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

/* ===== OTP FUNCTION ===== */
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/* ================= SIGNUP ================= */
app.post("/signup", async (req, res) => {
  try {
    let { email, username, password } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({
        success: false,
        message: "Missing fields"
      });
    }

    email = email.toLowerCase().trim();
    username = username.toLowerCase().trim();

    const [existing] = await db.query(
      "SELECT id FROM users WHERE email = ? OR username = ?",
      [email, username]
    );

    if (existing.length > 0) {
      return res.json({
        success: false,
        message: "User already exists"
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      `INSERT INTO users 
      (email, username, password_hash, is_verified, role) 
      VALUES (?, ?, ?, ?, ?)`,
      [email, username, hashedPassword, 0, "intern"]
    );

    const userId = result.insertId;

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await db.query(
      "INSERT INTO otps (user_id, otp, expires_at) VALUES (?, ?, ?)",
      [userId, otp, expiresAt]
    );

    let emailSent = true;

    try {
      await transporter.sendMail({
        from: `"OTP Service" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Your OTP Code",
        text: `Your OTP is ${otp}. It expires in 5 minutes.`
      });

      console.log("📧 Email sent to:", email);
    } catch (err) {
      console.error("❌ EMAIL FAILED:", err.message);
      emailSent = false;
    }

    return res.json({
      success: true,
      message: emailSent
        ? "Signup successful! OTP sent."
        : "Signup successful! OTP generated, but email failed."
    });

  } catch (err) {
    console.error("🔥 SIGNUP ERROR:", err.message);

    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/* ================= VERIFY OTP ================= */
app.post("/verifyotp", async (req, res) => {
  try {
    let { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Missing fields"
      });
    }

    email = email.toLowerCase().trim();

    const [users] = await db.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (users.length === 0) {
      return res.json({
        success: false,
        message: "User not found"
      });
    }

    const userId = users[0].id;

    const [otpRows] = await db.query(
      "SELECT * FROM otps WHERE user_id = ? AND otp = ? AND expires_at > NOW()",
      [userId, otp]
    );

    if (otpRows.length === 0) {
      return res.json({
        success: false,
        message: "OTP invalid or expired"
      });
    }

    await db.query(
      "UPDATE users SET is_verified = 1 WHERE id = ?",
      [userId]
    );

    //await db.query(
    //  "DELETE FROM otps WHERE user_id = ?",
    //  [userId]
   // );

    return res.json({
      success: true,
      message: "Account verified!"
    });

  } catch (err) {
    console.error("🔥 VERIFY ERROR:", err.message);

    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/* ================= LOGIN ================= */
app.post("/login", async (req, res) => {
  try {
    let { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Missing fields"
      });
    }

    username = username.toLowerCase().trim();

    const [rows] = await db.query(
      "SELECT * FROM users WHERE email = ? OR username = ?",
      [username, username]
    );

    if (rows.length === 0) {
      return res.json({
        success: false,
        message: "Invalid credentials"
      });
    }

    const user = rows[0];

    if (user.is_verified !== 1) {
      return res.json({
        success: false,
        message: "User not verified yet"
      });
    }

    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.json({
        success: false,
        message: "Invalid credentials"
      });
    }

    return res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });

  } catch (err) {
    console.error("🔥 LOGIN ERROR:", err.message);

    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/* ================= VIDEO SYSTEM ================= */
let videos = [
  { id: 1, title: "Video 1", url: "https://effetechnology.in/Andritz_videos/Welcome1.mp4", isActive: true },
  { id: 2, title: "Video 2", url: "https://effetechnology.in/Andritz_videos/Welcome2.mp4", isActive: true },
  { id: 3, title: "Video 3", url: "", isActive: false },
  { id: 4, title: "Video 4", url: "", isActive: false },
  { id: 5, title: "Video 5", url: "", isActive: false },
  { id: 6, title: "Video 6", url: "", isActive: false },
  { id: 7, title: "Video 7", url: "", isActive: false },
  { id: 8, title: "Video 8", url: "", isActive: false },
  { id: 9, title: "Video 9", url: "", isActive: false },
  { id: 10, title: "Video 10", url: "", isActive: false }
];

function normalizeRole(role) {
  return String(role || "").toLowerCase().trim();
}

function canViewAll(role) {
  return role === "manager" || role === "hr";
}

function canViewOnlyFive(role) {
  return role === "admin" || role === "intern" || role === "user";
}

function canManageVideos(role) {
  return role === "manager" || role === "hr";
}

/* ===== GET VIDEOS ===== */
app.get("/videos/:role", (req, res) => {
  const role = normalizeRole(req.params.role);

  if (canViewAll(role)) {
    return res.json(videos);
  }

  if (canViewOnlyFive(role)) {
    return res.json(videos.filter(video => video.id <= 5));
  }

  return res.status(403).json({
    message: "Access denied"
  });
});

/* ===== ADD VIDEO ===== */
app.post("/videos/add/:role", (req, res) => {
  const role = normalizeRole(req.params.role);
  const { url } = req.body;

  if (!canManageVideos(role)) {
    return res.status(403).json({
      message: "Only Manager and HR can add videos"
    });
  }

  if (!url || url.trim() === "") {
    return res.status(400).json({
      message: "Video URL required"
    });
  }

  const emptySlot = videos.find(video => video.isActive === false);

  if (!emptySlot) {
    return res.status(400).json({
      message: "All 10 video slots are full"
    });
  }

  emptySlot.url = url.trim();
  emptySlot.isActive = true;

  return res.json({
    success: true,
    message: "Video added",
    video: emptySlot
  });
});

/* ===== REMOVE VIDEO ===== */
app.delete("/videos/remove/:role/:id", (req, res) => {
  const role = normalizeRole(req.params.role);
  const id = Number(req.params.id);

  if (!canManageVideos(role)) {
    return res.status(403).json({
      message: "Only Manager and HR can remove videos"
    });
  }

  const video = videos.find(video => video.id === id);

  if (!video) {
    return res.status(404).json({
      message: "Video not found"
    });
  }

  video.url = "";
  video.isActive = false;

  return res.json({
    success: true,
    message: "Video removed",
    video
  });
});

/* ===== TEST ROUTE ===== */
app.get("/", (req, res) => {
  res.send("Server is working ✅");
});

/* ===== SERVER ===== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});