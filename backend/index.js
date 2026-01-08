const express = require('express');
const common = require("oci-common");
const core = require("oci-core");
const os = require("oci-objectstorage");
const multer = require('multer');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// --- הגדרות קבועות ---
const PORT = 80;
const NAMESPACE = "axamiken9q9h";
const INPUT_BUCKET = "render_input_bucket";
const OUTPUT_BUCKET = "render_output_bucket";

// זיהוי ה-Worker - עדיפות למשתנה סביבה, אם לא קיים משתמש ב-ID הישיר
const WORKER_ID = process.env.WORKER_INSTANCE_ID || "ocid1.instance.oc1.il-jerusalem-1.anwxiljr77u4iqicq2bcsrra6lcssdqf6jzbswlc6pnqvf37fmn5grdpfffa";

const upload = multer({ storage: multer.memoryStorage() });

/**
 * פונקציה ראשית לאתחול השרת והחיבור לאורקל
 */
async function startServer() {
    try {
        console.log("Starting OCI Identity initialization...");

        // שימוש ב-Builder מבטיח שהזהות נטענת במלואה לפני יצירת הקליינטים
        const provider = await new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
        
        // יצירת הקליינטים עם ה-Provider המאומת
        const computeClient = new core.ComputeClient({ authenticationDetailsProvider: provider });
        const storageClient = new os.ObjectStorageClient({ authenticationDetailsProvider: provider });

        console.log("OCI Identity & Clients: SUCCESS");

        // --- נתיבי API ---

        // בדיקת סטטוס וצוות
        app.get('/health', (req, res) => {
            res.json({ 
                status: 'OK', 
                team: 'Amit, Roni, Shir, Yarin, Nir',
                worker_monitored: WORKER_ID 
            });
        });

        // העלאת קובץ והפעלה
        app.post('/render', upload.single('blend_file'), async (req, res) => {
            try {
                if (!req.file) return res.status(400).json({ error: "No file uploaded" });

                const filename = req.file.originalname;
                console.log(`[${new Date().toISOString()}] Action: Uploading ${filename}`);

                // 1. העלאה ל-Object Storage
                await storageClient.putObject({
                    namespaceName: NAMESPACE,
                    bucketName: INPUT_BUCKET,
                    putObjectBody: req.file.buffer,
                    objectName: filename
                });

                // 2. הפעלת ה-Worker
                console.log(`[${new Date().toISOString()}] Action: Starting Worker ${WORKER_ID}`);
                await computeClient.instanceAction({
                    instanceId: WORKER_ID,
                    action: "START"
                });

                res.json({ 
                    status: "Started", 
                    file: filename,
                    message: "Upload successful, worker is booting up" 
                });
            } catch (error) {
                console.error("Internal Render Error:", error.message);
                res.status(500).json({ error: error.message });
            }
        });

        // בדיקת תוצאת רינדור
        app.get('/status/:filename', async (req, res) => {
            const filename = req.params.filename;
            const baseName = filename.substring(0, filename.lastIndexOf('.'));
            const renderedName = `rendered_${baseName}.png`;

            try {
                await storageClient.headObject({
                    namespaceName: NAMESPACE,
                    bucketName: OUTPUT_BUCKET,
                    objectName: renderedName
                });

                res.json({ 
                    status: "Completed", 
                    url: `https://objectstorage.il-jerusalem-1.oraclecloud.com/n/${NAMESPACE}/b/${OUTPUT_BUCKET}/o/${renderedName}` 
                });
            } catch (error) {
                if (error.statusCode === 404) {
                    res.json({ status: "Processing" });
                } else {
                    res.status(500).json({ error: error.message });
                }
            }
        });

        // הפעלת השרת
        app.listen(PORT, () => {
            console.log(`=========================================`);
            console.log(`SERVER RUNNING ON PORT: ${PORT}`);
            console.log(`MONITORING WORKER: ${WORKER_ID}`);
            console.log(`=========================================`);
        });

    } catch (criticalError) {
        console.error("FATAL ERROR during startup:", criticalError.message);
        process.exit(1);
    }
}

// הפעלה
startServer();