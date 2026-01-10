const express = require('express');
const common = require("oci-common");
const core = require("oci-core");
const os = require("oci-objectstorage");
const multer = require('multer');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// --- הגדרות מתוך ENV (במקום קבועות) ---
const PORT = Number(process.env.PORT || 80);

const NAMESPACE = process.env.OCI_NAMESPACE || "axamiken9q9h";
const INPUT_BUCKET = process.env.INPUT_BUCKET || "render_input_bucket";
const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET || "render_output_bucket";
const WORKER_ID = process.env.WORKER_ID || "ocid1.instance.oc1.il-jerusalem-1.anwxiljr77u4iqics3ywelpxv7gfd32jn72tdc2nasup6yrq5oszwrvgcnla";

// לוג אחד בתחילת הריצה כדי לוודא שלא “נעלם” ENV בגלל sudo
console.log("CONFIG:", { PORT, NAMESPACE, INPUT_BUCKET, OUTPUT_BUCKET, WORKER_ID });

const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  try {
    console.log("Starting OCI Identity initialization...");
    const provider = await new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();

    const computeClient = new core.ComputeClient({ authenticationDetailsProvider: provider });
    const storageClient = new os.ObjectStorageClient({ authenticationDetailsProvider: provider });

    console.log("OCI Identity & Clients: SUCCESS");

    // בדיקת בריאות המערכת
    app.get('/health', (req, res) => {
      res.json({ status: 'OK', team: 'Amit, Roni, Shir, Yarin, Nir' });
    });

    // נתיב 1: העלאת קובץ והפעלת ה-Worker
    app.post('/render', upload.single('blend_file'), async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });
        const filename = req.file.originalname;

        console.log(`Action: Uploading ${filename} to OCI...`);

        await storageClient.putObject({
          namespaceName: NAMESPACE,
          bucketName: INPUT_BUCKET,
          putObjectBody: req.file.buffer,
          objectName: filename
        });

        console.log("Checking worker state...");

        const inst = await computeClient.getInstance({ instanceId: WORKER_ID });
        const state = inst.instance.lifecycleState;
        console.log("Worker state:", state);

        if (state === "STOPPED") {
          console.log("Worker is stopped → starting it");
          await computeClient.instanceAction({ instanceId: WORKER_ID, action: "START" });
        } else {
          console.log("Worker already running → no action needed");
        }

        res.json({ status: "Started", filename: filename });
      } catch (error) {
        console.error("DETAILED ERROR:", error);
        res.status(500).json({ error: error.message });
      }
    });

    // נתיב 2: בדיקת סטטוס והחזרת התמונה כ-Base64 (נשאר, רק תיקון chunk כפול)
    app.get('/status/:filename', async (req, res) => {
      const filename = req.params.filename;
      const baseName = filename.substring(0, filename.lastIndexOf('.'));
      const renderedName = `rendered_${baseName}.png`;

      try {
        console.log(`Checking for rendered file: ${renderedName}`);
        const response = await storageClient.getObject({
          namespaceName: NAMESPACE,
          bucketName: OUTPUT_BUCKET,
          objectName: renderedName
        });

        // המרת ה-Stream ל-Base64 (תיקון: לא לדחוף chunk פעמיים)
        const chunks = [];
        for await (const chunk of response.value) {
          chunks.push(chunk);
        }
        const base64Image = Buffer.concat(chunks).toString('base64');

        res.setHeader("Cache-Control", "no-store");
        res.json({
          status: "Completed",
          image_base64: base64Image
        });

      } catch (error) {
        if (error.statusCode === 404) {
          res.setHeader("Cache-Control", "no-store");
          res.json({ status: "Processing" });
        } else {
          res.status(500).json({ error: error.message });
        }
      }
    });

    // ============================
    // חדש: Option 2 - Proxy לתמונה
    // ============================
    app.get('/api/output/:objectName', async (req, res) => {
  const objectName = req.params.objectName;

  try {
    const response = await storageClient.getObject({
      namespaceName: NAMESPACE,
      bucketName: OUTPUT_BUCKET,
      objectName
    });

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");

    // OCI SDK אצלך לא מחזיר Node stream => קוראים את זה ל-Buffer ידנית
    const chunks = [];
    for await (const chunk of response.value) {
      chunks.push(chunk);
    }
    const buf = Buffer.concat(chunks);

    res.status(200).send(buf);

  } catch (error) {
    console.error("api/output error:", {
      message: error.message,
      statusCode: error.statusCode,
      serviceCode: error.serviceCode,
      opcRequestId: error.opcRequestId,
      targetService: error.targetService,
      operationName: error.operationName,
      objectName

        res.setHeader("Cache-Control", "no-store");
        res.json({
          status: "Completed",
          image_base64: base64Image
        });

      } catch (error) {
        if (error.statusCode === 404) {
          res.setHeader("Cache-Control", "no-store");
          res.json({ status: "Processing" });
        } else {
          res.status(500).json({ error: error.message });
        }
      }
    });

    // ============================
    // חדש: Option 2 - Proxy לתמונה
    // ============================
    app.get('/api/output/:objectName', async (req, res) => {
  const objectName = req.params.objectName;

  try {
    const response = await storageClient.getObject({
      namespaceName: NAMESPACE,
      bucketName: OUTPUT_BUCKET,
      objectName
    });

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");

    // OCI SDK אצלך לא מחזיר Node stream => קוראים את זה ל-Buffer ידנית
    const chunks = [];
    for await (const chunk of response.value) {
      chunks.push(chunk);
    }
    const buf = Buffer.concat(chunks);

    res.status(200).send(buf);

  } catch (error) {
    console.error("api/output error:", {
      message: error.message,
      statusCode: error.statusCode,
      serviceCode: error.serviceCode,
      opcRequestId: error.opcRequestId,
      targetService: error.targetService,
      operationName: error.operationName,
     objectName
    });

    if (error.statusCode === 404) return res.status(404).json({ ok: false, error: "Not found" });
    if (error.statusCode === 403) return res.status(403).json({ ok: false, error: "Not authorized" });

    res.status(500).json({ ok: false, error: error.message });
  }
});

    app.listen(PORT, () => {
      console.log(`=========================================`);
      console.log(`CONTROLLER RUNNING ON PORT: ${PORT}`);
      console.log(`=========================================`);
    });

  } catch (criticalError) {
    console.error("FATAL ERROR:", criticalError.message);
    process.exit(1);
  }
}

startServer();
