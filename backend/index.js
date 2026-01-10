const express = require("express");
const common = require("oci-common");
const core = require("oci-core");
const os = require("oci-objectstorage");
const multer = require("multer");
const cors = require("cors");

const app = express();
app.use(express.json());

// לדמו/פיתוח זה בסדר. בהמשך אפשר לצמצם לדומיין של הפרונטנד.
app.use(cors());

const PORT = Number(process.env.PORT || 80);

const NAMESPACE = process.env.OCI_NAMESPACE || "axamiken9q9h";
const INPUT_BUCKET = process.env.INPUT_BUCKET || "render_input_bucket";
const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET || "render_output_bucket";

// חשוב: לא להשאיר OCID קשיח שיכול להיות שגוי.
// אם לא מגיע WORKER_ID, ננסה WORKER_INSTANCE_ID. אם גם לא - נכשיל ברור.
const WORKER_ID = process.env.WORKER_ID || process.env.WORKER_INSTANCE_ID;
if (!WORKER_ID) {
  throw new Error("Missing WORKER_ID (or WORKER_INSTANCE_ID) environment variable");
}

console.log("CONFIG:", { PORT, NAMESPACE, INPUT_BUCKET, OUTPUT_BUCKET, WORKER_ID });

const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  try {
    console.log("Starting OCI Identity initialization...");
    const provider = await new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();

    const computeClient = new core.ComputeClient({ authenticationDetailsProvider: provider });
    const storageClient = new os.ObjectStorageClient({ authenticationDetailsProvider: provider });

    console.log("OCI Identity & Clients: SUCCESS");

    // בריאות
    app.get("/health", (req, res) => {
      res.json({ status: "OK", team: "Amit, Roni, Shir, Yarin, Nir" });
    });

    // =========================================================
    // 1) Upload .blend + ensure worker running
    // =========================================================
    app.post("/render", upload.single("blend_file"), async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });

        const filename = req.file.originalname;
        console.log(`Action: Uploading ${filename} to OCI...`);

        await storageClient.putObject({
          namespaceName: NAMESPACE,
          bucketName: INPUT_BUCKET,
          putObjectBody: req.file.buffer,
          objectName: filename,
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

        // מחזירים גם את השם של הפלט הצפוי כדי שהפרונטנד יוכל לבנות URL
        const baseName = filename.replace(/\.blend$/i, "");
        const renderedName = `rendered_${baseName}.png`;

        res.json({ status: "Started", filename, renderedName });
      } catch (error) {
        console.error("DETAILED ERROR:", error);
        res.status(500).json({ error: error.message });
      }
    });

    // =========================================================
    // 2) Status (רק בדיקה אם קיים) + אפשר להחזיר גם URL
    // =========================================================
    app.get("/status/:filename", async (req, res) => {
      const filename = req.params.filename;
      const baseName = filename.replace(/\.blend$/i, "");
      const renderedName = `rendered_${baseName}.png`;

      try {
        console.log(`Checking for rendered file: ${renderedName}`);

        // אם האובייקט קיים - נקבל תשובה (stream). לא חייבים לקרוא אותו כאן.
        await storageClient.getObject({
          namespaceName: NAMESPACE,
          bucketName: OUTPUT_BUCKET,
          objectName: renderedName,
        });

        res.setHeader("Cache-Control", "no-store");
        res.json({
          status: "Completed",
          renderedName,
          // הפרונטנד יכול להשתמש בזה כדי לשים img src
          imageUrl: `/api/output/${encodeURIComponent(renderedName)}`,
        });
      } catch (error) {
        if (error.statusCode === 404) {
          res.setHeader("Cache-Control", "no-store");
          return res.json({ status: "Processing", renderedName });
        }
        res.status(500).json({ error: error.message });
      }
    });

    // =========================================================
    // 3) Option 2: Proxy endpoint שמחזיר PNG מה-Output bucket
    // =========================================================
    app.get("/api/output/:objectName", async (req, res) => {
      try {
        const objectName = req.params.objectName;

        const response = await storageClient.getObject({
          namespaceName: NAMESPACE,
          bucketName: OUTPUT_BUCKET,
          objectName,
        });

        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "no-store");

        // response.value זה stream
        response.value.pipe(res);
      } catch (error) {
        if (error.statusCode === 404) return res.status(404).json({ ok: false, error: "Not found" });
        res.status(500).json({ ok: false, error: error.message });
      }
    });

    app.listen(PORT, () => {
      console.log("=========================================");
      console.log(`CONTROLLER RUNNING ON PORT: ${PORT}`);
      console.log("=========================================");
    });
  } catch (criticalError) {
    console.error("FATAL ERROR:", criticalError.message);
    process.exit(1);
  }
}

startServer();
