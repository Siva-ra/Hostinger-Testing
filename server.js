const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const mysql = require("mysql2/promise");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
require("dotenv").config();
const { exec } = require("child_process");
const pdfPoppler = require("pdf-poppler");

const app = express();

/* ===== MIDDLEWARE ===== */
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

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

/* ===== FIXED ADMIN EMAIL ===== */
const ADMIN_EMAIL = "innovation@effetechnology.in";

/* ===== 3D MODEL MULTER STORAGE ===== */
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});



//updated code for multer to only accept .glb and .gltf files
const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();

    if (ext === ".glb" || ext === ".gltf") {
      cb(null, true);
    } else {
      cb(new Error("Only GLB or GLTF files are allowed"));
    }
  }
});


/* ===== DOCUMENT MULTER STORAGE ===== */
const documentStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const documentFolder = "uploads/documents";

    if (!fs.existsSync(documentFolder)) {
      fs.mkdirSync(documentFolder, { recursive: true });
    }

    cb(null, documentFolder);
  },

  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const documentUpload = multer({
  storage: documentStorage,
  fileFilter: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();

    if (ext === ".pdf" || ext === ".ppt" || ext === ".pptx") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, PPT, PPTX files are allowed"));
    }
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

    //updated code for hashing password using bcryptjs
   const hashedPassword = await bcrypt.hash(password, 10);

   const role =
    email === ADMIN_EMAIL
     ? "admin"
     : "intern";

   const [result] = await db.query(
     `INSERT INTO users 
     (email, username, password_hash, is_verified, role) 
      VALUES (?, ?, ?, ?, ?)`,
    [
     email,
     username,
     hashedPassword,
     0,
     role
    ]
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

    //updated code for login to return user details along with role
    return res.json({
  success: true,
  user: {
    id: user.id,
    username: user.username,
    email: user.email,
    role:
      user.email === ADMIN_EMAIL
        ? "admin"
        : user.role
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

/* =====================================================
   VIDEO MANAGER
===================================================== */

/* ===== SAVE VIDEO ===== */
app.post("/save-video", async (req, res) => {
  try {
    const { video_name, video_link } = req.body;

    if (!video_name || !video_link) {
      return res.json({
        success: false,
        message: "Missing fields"
      });
    }

    const [rows] = await db.query(
      "SELECT id FROM videos WHERE video_name = ?",
      [video_name]
    );

    if (rows.length > 0) {
      await db.query(
        "UPDATE videos SET video_link = ? WHERE video_name = ?",
        [video_link, video_name]
      );

      return res.json({
        success: true,
        message: "Video updated"
      });
    }

    await db.query(
      "INSERT INTO videos (video_name, video_link) VALUES (?, ?)",
      [video_name, video_link]
    );

    res.json({
      success: true,
      message: "Video saved"
    });

  } catch (err) {
    console.error("SAVE VIDEO ERROR:", err.message);

    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/* ===== DELETE VIDEO ===== */
app.post("/delete-video", async (req, res) => {
  try {
    const { video_name } = req.body;

    if (!video_name) {
      return res.json({
        success: false,
        message: "Video name missing"
      });
    }

    await db.query(
      "DELETE FROM videos WHERE video_name = ?",
      [video_name]
    );

    res.json({
      success: true,
      message: "Video deleted"
    });

  } catch (err) {
    console.error("DELETE VIDEO ERROR:", err.message);

    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/* ===== GET VIDEOS ===== */

app.get("/get-videos", async (req, res) => {
try {

const [rows] =
await db.query(
"SELECT * FROM videos"
);

res.json(rows);

}
catch (err) {

console.log(err);

res.status(500).json({
success:false,
message:err.message
});

}
});

/* ===== UPLOAD OR REPLACE 3D MODEL ===== */
app.post("/upload-model", upload.single("model"), async (req, res) => {
  try {
    const slot_number = req.body.slot_number;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded"
      });
    }

    const modelName = req.file.originalname;
    const modelPath = "uploads/" + req.file.filename;

    const [rows] = await db.query(
      "SELECT * FROM models WHERE slot_number = ?",
      [slot_number]
    );

    if (rows.length > 0) {
      const oldPath = rows[0].model_path;
      const fullOldPath = path.join(__dirname, oldPath);

      if (fs.existsSync(fullOldPath)) {
        fs.unlinkSync(fullOldPath);
      }

      await db.query(
        "UPDATE models SET model_name = ?, model_path = ? WHERE slot_number = ?",
        [modelName, modelPath, slot_number]
      );
    } else {
      await db.query(
        "INSERT INTO models (slot_number, model_name, model_path) VALUES (?, ?, ?)",
        [slot_number, modelName, modelPath]
      );
    }

    res.json({
      success: true,
      message: "Model uploaded successfully",
      slot_number: slot_number,
      model_name: modelName,
      model_path: modelPath
    });

  } catch (err) {
    console.error("UPLOAD MODEL ERROR:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/* ===== GET ALL 3D MODELS ===== */
app.get("/get-models", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM models ORDER BY slot_number"
    );

    res.json(rows);

  } catch (err) {
    console.error("GET MODELS ERROR:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/* ===== DELETE 3D MODEL ===== */
app.delete("/delete-model/:slot", async (req, res) => {
  try {
    const slot = req.params.slot;

    const [rows] = await db.query(
      "SELECT * FROM models WHERE slot_number = ?",
      [slot]
    );

    if (rows.length === 0) {
      return res.json({
        success: false,
        message: "Model not found"
      });
    }

    const oldPath = rows[0].model_path;
    const fullOldPath = path.join(__dirname, oldPath);

    if (fs.existsSync(fullOldPath)) {
      fs.unlinkSync(fullOldPath);
    }

    await db.query(
      "DELETE FROM models WHERE slot_number = ?",
      [slot]
    );

    res.json({
      success: true,
      message: "Model deleted"
    });

  } catch (err) {
    console.error("DELETE MODEL ERROR:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});


/* ================= PLAYER PROGRESS ================= */

/* ===== SAVE PLAYER PROGRESS ===== */
app.post("/save-progress", async (req, res) => {
  try {
    const { user_id, current_level } = req.body;

    if (!user_id || current_level === undefined)
    {
      return res.status(400).json({
        success: false,
        message: "Missing user_id or current_level"
      });
    }

    await db.query(
      `
      INSERT INTO player_progress
      (user_id, current_level)

      VALUES (?, ?)

      ON DUPLICATE KEY UPDATE
      current_level = VALUES(current_level)
      `,
      [
        user_id,
        current_level
      ]
    );

    return res.json({
      success: true,
      message: "Progress saved successfully",
      current_level: current_level
    });

  }
  catch (err)
  {
    console.error(
      "SAVE PROGRESS ERROR:",
      err.message
    );

    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/* ===== GET PLAYER PROGRESS ===== */
app.get("/get-progress/:userId", async (req, res) => {
  try {

    const userId =
      req.params.userId;

    const [rows] =
      await db.query(
        `
        SELECT current_level
        FROM player_progress
        WHERE user_id = ?
        `,
        [userId]
      );

    if (rows.length === 0)
    {
      return res.json({
        success: true,
        current_level: 1
      });
    }

    return res.json({
      success: true,
      current_level:
        rows[0].current_level
    });

  }
  catch (err)
  {
    console.error(
      "GET PROGRESS ERROR:",
      err.message
    );

    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/* ===== GET USERS ===== */

app.get("/get-users", async (req, res) => {

  try {

    const [users] = await db.query(
      `
      SELECT
      id,
      email,
      username,
      role
      FROM users
      `
    );

    res.json({
      success: true,
      users: users
    });

  }
  catch (err) {

    console.log(err);

    res.status(500).json({
      success: false,
      message: err.message
    });

  }

});

/* ===== UPDATE ROLE ===== */

app.post("/update-role", async (req, res) => {

  try {

    const { user_id, role } = req.body;

    await db.query(
      `
      UPDATE users
      SET role = ?
      WHERE id = ?
      `,
      [role, user_id]
    );

    res.json({
      success: true,
      message: "Role updated"
    });

  }
  catch (err) {

    console.log(err);

    res.status(500).json({
      success: false,
      message: err.message
    });

  }

});



/* ===== CONVERT DOCUMENT TO IMAGE ===== */
async function convertDocumentToImage(filePath, fileType, slotNumber) {
  const previewFolder = "uploads/document_previews";

  if (!fs.existsSync(previewFolder)) {
    fs.mkdirSync(previewFolder, { recursive: true });
  }

  const previewName = "slot_" + slotNumber + "_" + Date.now();

  if (fileType === ".pdf") {
    const options = {
      format: "png",
      out_dir: previewFolder,
      out_prefix: previewName,
      page: 1
    };

    await pdfPoppler.convert(filePath, options);

    return previewFolder + "/" + previewName + "-1.png";
  }

  if (fileType === ".ppt" || fileType === ".pptx") {
    const tempPdfFolder = "uploads/temp_pdf";

    if (!fs.existsSync(tempPdfFolder)) {
      fs.mkdirSync(tempPdfFolder, { recursive: true });
    }

    await new Promise((resolve, reject) => {
      const command =
        `libreoffice --headless --convert-to pdf --outdir "${tempPdfFolder}" "${filePath}"`;

      exec(command, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    const baseName = path.basename(filePath, path.extname(filePath));
    const convertedPdfPath = path.join(tempPdfFolder, baseName + ".pdf");

    const options = {
      format: "png",
      out_dir: previewFolder,
      out_prefix: previewName,
      page: 1
    };

    await pdfPoppler.convert(convertedPdfPath, options);

    if (fs.existsSync(convertedPdfPath)) {
      fs.unlinkSync(convertedPdfPath);
    }

    return previewFolder + "/" + previewName + "-1.png";
  }

  return null;
}

/* ===== UPLOAD OR REPLACE DOCUMENT ===== */
app.post("/upload-document", documentUpload.single("document"), async (req, res) => {
  try {
    const slot_number = req.body.slot_number;

    if (!slot_number) {
      return res.status(400).json({
        success: false,
        message: "Slot number missing"
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No document uploaded"
      });
    }

    const fileName = req.file.originalname;
    const filePath = "uploads/documents/" + req.file.filename;
    const fullFilePath = path.join(__dirname, filePath);
    const fileType = path.extname(req.file.originalname).toLowerCase();

    const previewPath = await convertDocumentToImage(
      fullFilePath,
      fileType,
      slot_number
    );

    const [rows] = await db.query(
      "SELECT * FROM documents WHERE slot_number = ?",
      [slot_number]
    );

    if (rows.length > 0) {
      const oldPath = rows[0].file_path;
      const oldPreview = rows[0].preview_path;

      if (oldPath) {
        const fullOldPath = path.join(__dirname, oldPath);
        if (fs.existsSync(fullOldPath)) fs.unlinkSync(fullOldPath);
      }

      if (oldPreview) {
        const fullOldPreview = path.join(__dirname, oldPreview);
        if (fs.existsSync(fullOldPreview)) fs.unlinkSync(fullOldPreview);
      }

      await db.query(
        "UPDATE documents SET file_name = ?, file_path = ?, file_type = ?, preview_path = ? WHERE slot_number = ?",
        [fileName, filePath, fileType, previewPath, slot_number]
      );
    } else {
      await db.query(
        "INSERT INTO documents (slot_number, file_name, file_path, file_type, preview_path) VALUES (?, ?, ?, ?, ?)",
        [slot_number, fileName, filePath, fileType, previewPath]
      );
    }

    res.json({
      success: true,
      message: "Document uploaded successfully",
      slot_number: slot_number,
      file_name: fileName,
      file_path: filePath,
      file_type: fileType,
      preview_path: previewPath,
      preview_url:
        "https://lightgreen-cheetah-775075.hostingersite.com/" + previewPath
    });

  } catch (err) {
    console.error("UPLOAD DOCUMENT ERROR:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/* ===== GET ALL DOCUMENTS ===== */
app.get("/get-documents", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM documents ORDER BY slot_number"
    );

    res.json(rows);

  } catch (err) {
    console.error("GET DOCUMENTS ERROR:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/* ===== VIEW DOCUMENT BY SLOT ===== */
app.get("/view-document/:slot", async (req, res) => {
  try {
    const slot = req.params.slot;

    const [rows] = await db.query(
      "SELECT * FROM documents WHERE slot_number = ?",
      [slot]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Document not found"
      });
    }

    res.json({
      success: true,
      file_name: rows[0].file_name,
      file_path: rows[0].file_path,
      file_type: rows[0].file_type,
      preview_path: rows[0].preview_path,
      url:
        "https://lightgreen-cheetah-775075.hostingersite.com/" +
        rows[0].file_path,
      preview_url:
        "https://lightgreen-cheetah-775075.hostingersite.com/" +
        rows[0].preview_path
    });

  } catch (err) {
    console.error("VIEW DOCUMENT ERROR:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/* ===== DELETE DOCUMENT ===== */
app.delete("/delete-document/:slot", async (req, res) => {
  try {
    const slot = req.params.slot;

    const [rows] = await db.query(
      "SELECT * FROM documents WHERE slot_number = ?",
      [slot]
    );

    if (rows.length === 0) {
      return res.json({
        success: false,
        message: "Document not found"
      });
    }

    const oldPath = rows[0].file_path;
    const oldPreview = rows[0].preview_path;

    if (oldPath) {
      const fullOldPath = path.join(__dirname, oldPath);
      if (fs.existsSync(fullOldPath)) fs.unlinkSync(fullOldPath);
    }

    if (oldPreview) {
      const fullOldPreview = path.join(__dirname, oldPreview);
      if (fs.existsSync(fullOldPreview)) fs.unlinkSync(fullOldPreview);
    }

    await db.query(
      "DELETE FROM documents WHERE slot_number = ?",
      [slot]
    );

    res.json({
      success: true,
      message: "Document deleted"
    });

  } catch (err) {
    console.error("DELETE DOCUMENT ERROR:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
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