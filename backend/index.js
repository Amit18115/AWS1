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
const WORKER_ID = process.env.WORKER_ID || "ocid1.instance.oc1.il-jerusalem-1.anwxiljr77u4iqicq2bcsrra6lcssdqf6jzbswlc6pnqvf37fmn5grdpfffa";

// לוג אחד בתחילת הריצה כדי לוודא שלא “נעלם” ENV בגלל sudo
console.log("CONFIG:", { PORT, NAMESPACE, INPUT_BUCKET, OUTPUT_BUCKET, WORKER_ID });

const upload = multer({ storage: multer.memoryStorage() });

// ... ממשיך אותו קוד שלך בדיוק


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
                
                console.log(`Action: Uploading ${filename} to OCI...`); // הדפסה לטרמינל
                
                await storageClient.putObject({
                    namespaceName: NAMESPACE,
                    bucketName: INPUT_BUCKET,
                    putObjectBody: req.file.buffer,
                    objectName: filename
                });

                console.log("Checking worker state...");

                const inst = await computeClient.getInstance({
                instanceId: WORKER_ID
                });

                const state = inst.instance.lifecycleState;
                console.log("Worker state:", state);

                if (state === "STOPPED") {
                console.log("Worker is stopped → starting it");
                await computeClient.instanceAction({
                    instanceId: WORKER_ID,
                    action: "START"
                });
                } else {
                console.log("Worker already running → no action needed");
                }


                res.json({ status: "Started", filename: filename });
            } catch (error) {
                console.error("DETAILED ERROR:", error); // זה מה שיגיד לנו מה הבעיה!
                res.status(500).json({ error: error.message });
            }
        });
        // נתיב 2: בדיקת סטטוס והחזרת התמונה כ-Base64
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

                // המרת ה-Stream ל-Base64
                const chunks = [];
                for await (const chunk of response.value) {
                    chunks.push(chunk);
                }
                const base64Image = Buffer.concat(chunks).toString('base64');

                res.json({ 
                    status: "Completed", 
                    image_base64: base64Image 
                });

            } catch (error) {
                if (error.statusCode === 404) {
                    res.json({ status: "Processing" });
                } else {
                    res.status(500).json({ error: error.message });
                }
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