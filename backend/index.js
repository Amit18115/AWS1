const express = require('express');
const common = require("oci-common");
const core = require("oci-core");
const os = require("oci-objectstorage");
const multer = require('multer'); // להוספה: npm install multer
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
app.use(express.json());

const provider = new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();

const WORKER_INSTANCE_ID = process.env.WORKER_INSTANCE_ID;
const INPUT_BUCKET = "render_input_bucket";
const OUTPUT_BUCKET = "render_output_bucket";
const NAMESPACE = "axamiken9q9h";

const computeClient = new core.ComputeClient({ authenticationDetailsProvider: provider });
const storageClient = new os.ObjectStorageClient({ authenticationDetailsProvider: provider });

// נתיב לקבלת הקובץ והתחלת הרינדור
app.post('/render', upload.single('blend_file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });

        const filename = req.file.originalname;
        console.log(`Uploading ${filename} to OCI...`);

        // 1. העלאת הקובץ ל-Input Bucket
        await storageClient.putObject({
            namespaceName: NAMESPACE,
            bucketName: INPUT_BUCKET,
            putObjectBody: req.file.buffer,
            objectName: filename
        });

        // 2. הדלקת ה-Worker
        console.log(`Starting Worker for rendering...`);
        await computeClient.instanceAction({
            instanceId: WORKER_INSTANCE_ID,
            action: "START"
        });

        // החזרת תשובה ל-Frontend כדי שיתחיל לבדוק סטטוס (Polling)
        res.json({ 
            status: "Processing", 
            filename: filename,
            message: "File uploaded and worker starting" 
        });
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// נתיב בדיקת הסטטוס נשאר דומה
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
            output_image_url: `https://objectstorage.il-jerusalem-1.oraclecloud.com/n/${NAMESPACE}/b/${OUTPUT_BUCKET}/o/${renderedName}` 
        });
    } catch (error) {
        if (error.statusCode === 404) {
            res.json({ status: "Processing" });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

const PORT = 80;
app.get('/health', (req, res) => {
    res.json({ status: 'OK', team: 'Amit, Roni, Shir, Yarin, Nir' });
});
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));